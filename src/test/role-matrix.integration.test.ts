import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient as UntypedSupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
import type { AppRole } from "@/shared/config";
import {
  addAvailability,
  addCourse,
  addGenerationJob,
  addMerge,
  addOverlap,
  addProfile,
  addStudentWithChoices,
  addTeacher,
  computeGroupingsFor,
  createAuthUser,
  createPlan,
  createSignedInUser,
  generationJobRow,
  placeCourse,
  registerPlan,
  shelveCourses,
  teardown,
  type SignedInUser,
} from "@/test/factories";
import { decodeAccessClaims, type AccessClaims } from "./access-claims";
import {
  classifyCall,
  probeRead,
  probeWrite,
  seesFixtureRows,
  type AccessOutcome,
  type FixtureRef,
  type PublicTable,
  type WriteAttempt,
} from "./access-probe";
import { connectPostgres, heldPrivileges } from "./postgres-client";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";
import {
  GRANTS,
  PRINCIPAL_NOTES,
  PROFILE_REKEY,
  PROFILE_WRITES,
  READS,
  RPCS,
  WRITES,
  type Principal,
  type ProfileOwner,
  type ProfileWriteOperation,
  type RepresentativeTable,
  type Rpc,
  type TableGrants,
  type WriteOperation,
} from "./role-matrix-expectations";

/**
 * The role matrix: every cell of `role-matrix-expectations.ts`, run live through real clients.
 *
 * Rows are proven through each principal's own client by the access probe, so RLS is in play; a
 * service-role suite cannot see it at all. Grants are proven from the catalog over `pg`, and so are
 * the role helpers in the `private` schema, which PostgREST does not expose. App roles live in rows
 * (`user_roles`) rather than Postgres roles, so only the first instrument will ever tell S-403's
 * admin, author and viewer apart.
 *
 * Today the matrix pins the posture S-403 replaces: anon is denied everywhere, and a signed-in user
 * without a role is allowed everywhere except other users' profile and role rows (the own-row
 * policies on `profiles` and `user_roles`, which S-403 keeps). S-403 flips the expectations first
 * (red), then its policy migration turns them green. That flip is the proof that this suite can
 * fail; the deny drill in the `give-integration-lane-a-signed-in-client-per-role` change folder
 * (`drill/`) shows it on today's schema.
 *
 * Each principal signs in once per file, never per test, which keeps the lane clear of GoTrue's
 * rate limits. Each write cell acts on a fresh target, so cells never depend on their order.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

/** Every principal but anon holds a session. S-403's roles join `noRole` here. */
type SignedInPrincipal = Exclude<Principal, "anon">;

/** The role each signed-in principal holds, which `own_app_role` must answer. */
const HELD_ROLES: Record<SignedInPrincipal, AppRole | null> = { noRole: null };

const PRINCIPALS = Object.keys(PRINCIPAL_NOTES) as Principal[];
const TABLES = Object.keys(READS) as PublicTable[];
const REPRESENTATIVES = Object.keys(WRITES) as RepresentativeTable[];
const OPERATIONS: WriteOperation[] = ["insert", "update", "delete"];
const PROFILE_OWNERS: ProfileOwner[] = ["own", "others"];
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];
const RPC_NAMES = Object.keys(RPCS) as Rpc[];

(hasEnv ? describe : describe.skip)("role matrix (local Supabase)", () => {
  let admin: SupabaseClient;
  let pg: Client;
  let signedIn: Record<SignedInPrincipal, SignedInUser>;
  let principals: Record<Principal, SupabaseClient>;
  let fixture: FixtureRef;

  // Anon holds no session, so it owns no row.
  const ownUserIdOf = (principal: Principal): string | null => (principal === "anon" ? null : signedIn[principal].id);

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
    signedIn = { noRole: await createSignedInUser(admin) };
    principals = {
      // The publishable key and no session: never signed in.
      anon: createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY),
      noRole: signedIn.noRole.client,
    };
    fixture = await buildFixture(admin);
  }, 30_000);

  afterAll(async () => {
    try {
      await teardown(admin);
    } finally {
      // Teardown throws one aggregated error; the socket must close either way.
      await pg.end();
    }
  });

  it("fixture: the service role sees a fixture row in every public table", async () => {
    const sightings = await Promise.all(
      TABLES.map(async (table) => ({ table, seen: await seesFixtureRows(admin, table, fixture) })),
    );
    expect(sightings.filter(({ seen }) => !seen).map(({ table }) => table)).toEqual([]);
  });

  it("catalog: grants and RLS on every public table are exactly as declared", async () => {
    const declared = Object.fromEntries(
      Object.entries(GRANTS).map(([table, grants]) => [table, { ...grants, rls: true }]),
    );

    // A table that is live but undeclared, or declared but gone, shows up as a key difference.
    expect(await livePosture(pg)).toEqual(declared);
  });

  it("catalog: private holds the role helpers, and only current_app_role is SECURITY DEFINER", async () => {
    expect(await privateFunctionSecurity(pg)).toEqual(PRIVATE_FUNCTIONS);
  });

  it("catalog: current_app_role pins an empty search_path, and its owner bypasses RLS", async () => {
    const { rows } = await pg.query<{ config: string[] | null; owner_bypasses_rls: boolean }>(
      `select p.proconfig as config, o.rolbypassrls as owner_bypasses_rls
         from pg_proc p
         join pg_roles o on o.oid = p.proowner
        where p.oid = 'private.current_app_role()'::regprocedure`,
    );
    // An owner without BYPASSRLS reads no rows: every human, authors included, would hold no role.
    expect(rows).toEqual([{ config: ['search_path=""'], owner_bypasses_rls: true }]);
  });

  it("catalog: only authenticated may execute the private helpers and own_app_role, never anon or PUBLIC", async () => {
    expect(await roleFunctionExecutors(pg)).toEqual({
      "private.can_edit()": ["authenticated"],
      "private.can_read()": ["authenticated"],
      "private.current_app_role()": ["authenticated"],
      "public.own_app_role()": ["authenticated"],
    });
  });

  it("Data API: the private schema is not exposed, so PostgREST refuses it (PGRST106)", async () => {
    // A signed-in client holds USAGE on `private` and EXECUTE on its helpers, so the exposed-schema
    // list is the only thing between it and a direct call.
    const client: UntypedSupabaseClient = principals.noRole;
    const { error } = await client.schema("private").rpc("current_app_role");
    expect(error?.code).toBe("PGRST106");
  });

  for (const principal of PRINCIPALS) {
    describe(`${principal} — ${PRINCIPAL_NOTES[principal]}`, () => {
      if (principal !== "anon") {
        it(`${principal} signs in with the role claim "authenticated"`, async () => {
          expect((await claimsOf(signedIn[principal])).role).toBe("authenticated");
        });

        it(`${principal} carries no app_metadata.machine_role — the token hook passes it through`, async () => {
          expect((await claimsOf(signedIn[principal])).app_metadata?.machine_role).toBeUndefined();
        });

        it(`${principal}'s token subject is its own user id`, async () => {
          expect((await claimsOf(signedIn[principal])).sub).toBe(signedIn[principal].id);
        });

        it(`${principal}'s own_app_role answers ${HELD_ROLES[principal] ?? "null"}`, async () => {
          expect(await principals[principal].rpc("own_app_role")).toMatchObject({
            error: null,
            data: HELD_ROLES[principal],
          });
        });
      }

      for (const table of TABLES) {
        const expected = READS[table][principal];
        it(`${principal} SELECT ${table} → ${expected}`, async () => {
          expect(await probeRead(principals[principal], table, fixture)).toBe(expected);
        });
      }

      for (const table of REPRESENTATIVES) {
        for (const operation of OPERATIONS) {
          const expected = WRITES[table][operation][principal];
          it(`${principal} ${operation.toUpperCase()} ${table} → ${expected}`, async () => {
            const attempt = await WRITE_PROBES[table][operation](admin, principals[principal], fixture.planId);
            expect(await probeWrite(attempt)).toBe(expected);
          });
        }
      }

      for (const owner of PROFILE_OWNERS) {
        for (const operation of PROFILE_OPERATIONS) {
          const expected = PROFILE_WRITES[owner][operation][principal];
          it(`${principal} ${operation.toUpperCase()} ${owner} profile → ${expected}`, async () => {
            const attempt = await PROFILE_WRITE_PROBES[owner][operation](
              admin,
              principals[principal],
              ownUserIdOf(principal),
            );
            expect(await probeWrite(attempt)).toBe(expected);
          });
        }
      }

      const rekeyExpected = PROFILE_REKEY[principal];
      it(`${principal} UPDATE own profile onto another user → ${rekeyExpected}`, async () => {
        const attempt = await profileRekeyProbe(admin, principals[principal], ownUserIdOf(principal));
        expect(await probeWrite(attempt)).toBe(rekeyExpected);
      });

      for (const rpc of RPC_NAMES) {
        const expected = RPCS[rpc][principal];
        it(`${principal} RPC ${rpc} → ${expected}`, async () => {
          expect(await RPC_PROBES[rpc](admin, principals[principal], fixture.planId)).toBe(expected);
        });
      }
    });
  }
});

type TablePosture = TableGrants & { rls: boolean };

/** Every public base table's table-level grants for anon and authenticated, and its RLS flag. */
const livePosture = async (pg: Client): Promise<Record<string, TablePosture>> => {
  const { rows } = await pg.query<{ relname: string; relrowsecurity: boolean }>(
    `select c.relname, c.relrowsecurity
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p')`,
  );
  // One table at a time: a pg Client runs one query at a time, and overlapping calls are deprecated (gone in pg@9).
  const entries = await rows.reduce<Promise<[string, TablePosture][]>>(
    async (done, { relname, relrowsecurity }) => [
      ...(await done),
      [
        relname,
        {
          anon: await heldPrivileges(pg, "anon", `public.${relname}`),
          authenticated: await heldPrivileges(pg, "authenticated", `public.${relname}`),
          rls: relrowsecurity,
        },
      ],
    ],
    Promise.resolve([]),
  );
  return Object.fromEntries(entries);
};

type FunctionSecurity = "definer" | "invoker";

/**
 * Every function in `private`, and whether it runs as its owner or its caller. `current_app_role`
 * is the repo's one recorded SECURITY DEFINER exception (its migration says why); the capability
 * wrappers run as the caller. A new helper fails the catalog check until it is declared here.
 */
const PRIVATE_FUNCTIONS: Record<string, FunctionSecurity> = {
  "private.can_edit()": "invoker",
  "private.can_read()": "invoker",
  "private.current_app_role()": "definer",
};

/** Every function in `private`, by schema-qualified signature, with how it runs. */
const privateFunctionSecurity = async (pg: Client): Promise<Record<string, FunctionSecurity>> => {
  const { rows } = await pg.query<{ signature: string; definer: boolean }>(
    `select ${QUALIFIED_SIGNATURE} as signature, p.prosecdef as definer
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'`,
  );
  return Object.fromEntries(rows.map(({ signature, definer }) => [signature, definer ? "definer" : "invoker"]));
};

/**
 * Which of anon, authenticated and PUBLIC may execute each function in `private`, and the app's
 * role read. Postgres gives PUBLIC EXECUTE on every new function, so a missed revoke shows up here.
 */
const roleFunctionExecutors = async (pg: Client): Promise<Record<string, string[]>> => {
  const { rows } = await pg.query<{ signature: string; executors: string[] }>(
    `select ${QUALIFIED_SIGNATURE} as signature,
            array(select r from unnest(array['anon', 'authenticated', 'public']) as r
                   where has_function_privilege(r, p.oid, 'EXECUTE') order by r) as executors
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private' or p.oid = 'public.own_app_role()'::regprocedure`,
  );
  return Object.fromEntries(rows.map(({ signature, executors }) => [signature, executors]));
};

// `schema.name(args)`, whatever the connection's search_path: `regprocedure` drops a visible schema.
const QUALIFIED_SIGNATURE = "format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))";

/** One RPC cell: the call as the principal, classified. */
type RpcProbe = (admin: SupabaseClient, client: SupabaseClient, planId: string) => Promise<AccessOutcome>;

const RPC_PROBES: Record<Rpc, RpcProbe> = {
  clone_plan: (admin, client, planId) => probeWrite(cloneProbe(admin, client, planId)),
  // A read: there is no effect to read back, so the call's own answer is the outcome. What it
  // answers is checked per principal, against `HELD_ROLES`.
  own_app_role: async (_admin, client) => classifyCall((await client.rpc("own_app_role")).error),
};

/** Builds one write cell's target with the service role, and returns the attempt and its read-back. */
type WriteProbeBuilder = (admin: SupabaseClient, client: SupabaseClient, planId: string) => Promise<WriteAttempt>;

/**
 * One fresh target per cell. INSERTs supply their own id, so the read-back knows what to look for
 * without asking the write for rows back. UPDATEs write a sentinel the read-back compares against.
 */
const WRITE_PROBES: Record<RepresentativeTable, Record<WriteOperation, WriteProbeBuilder>> = {
  plans: {
    insert: (admin, client) => {
      const id = randomUUID();
      // Registered before the attempt, so an allowed insert is still torn down.
      registerPlan(id);
      return Promise.resolve(
        insertProbe(admin, client, "plans", { id, name: `Factory Plan ${id}`, slot_grid_preset: "5x10" }),
      );
    },
    update: async (admin, client) =>
      updateProbe(admin, client, "plans", await createPlan(admin), "name", `Factory Plan ${randomUUID()}`),
    delete: async (admin, client) => deleteProbe(admin, client, "plans", await createPlan(admin)),
  },
  courses: {
    insert: (admin, client, planId) => {
      const id = randomUUID();
      const row = {
        id,
        plan_id: planId,
        cohort: "dp1" as const,
        name: `Probe ${id}`,
        level: "none",
        hours_per_week: 1,
      };
      return Promise.resolve(insertProbe(admin, client, "courses", row));
    },
    update: async (admin, client, planId) =>
      updateProbe(admin, client, "courses", await addProbeCourse(admin, planId), "color", "#5e771e"),
    delete: async (admin, client, planId) => deleteProbe(admin, client, "courses", await addProbeCourse(admin, planId)),
  },
  students: {
    insert: (admin, client, planId) =>
      Promise.resolve(
        insertProbe(admin, client, "students", {
          id: randomUUID(),
          plan_id: planId,
          cohort: "dp1",
          full_name: "Probe",
        }),
      ),
    update: async (admin, client, planId) =>
      updateProbe(
        admin,
        client,
        "students",
        await addProbeStudent(admin, planId),
        "full_name",
        `Probe ${randomUUID()}`,
      ),
    delete: async (admin, client, planId) =>
      deleteProbe(admin, client, "students", await addProbeStudent(admin, planId)),
  },
  placements: {
    // The board's write path is the `place_course` RPC, not a direct insert, so that is what's probed.
    insert: async (admin, client, planId) => {
      const courseId = await addProbeCourse(admin, planId);
      return {
        attempt: () =>
          client.rpc("place_course", {
            p_plan_id: planId,
            p_cohort: "dp1",
            p_course_id: courseId,
            p_day: 2,
            p_period: 2,
            p_week: "both",
            p_is_optional: false,
          }),
        effectLanded: async () =>
          readBack(await admin.from("placements").select("id").eq("course_id", courseId)).length > 0,
      };
    },
    // The factory places a course as not optional, so `true` is a change.
    update: async (admin, client, planId) =>
      updateProbe(admin, client, "placements", await addProbePlacement(admin, planId), "is_optional", true),
    delete: async (admin, client, planId) =>
      deleteProbe(admin, client, "placements", await addProbePlacement(admin, planId)),
  },
  // Each cell gets a plan of its own: a plan holds at most one queued or running job.
  generation_jobs: {
    insert: async (admin, client) =>
      insertProbe(admin, client, "generation_jobs", {
        id: randomUUID(),
        ...(await generationJobRow(await createPlan(admin))),
      }),
    update: async (admin, client) =>
      updateProbe(
        admin,
        client,
        "generation_jobs",
        await addFinishedJob(admin, await createPlan(admin)),
        "error",
        `probe ${randomUUID()}`,
      ),
    delete: async (admin, client) =>
      deleteProbe(admin, client, "generation_jobs", await addFinishedJob(admin, await createPlan(admin))),
  },
};

type Tables = Database["public"]["Tables"];

// The three shapes most write cells share. Each read-back is derived from its attempt, so the two
// can never name different tables or columns. The clients are taken untyped because one code path
// writes every table; the row, column and sentinel stay typed against the generated schema.

/** INSERT `row` as the principal; the effect is a row with its client-supplied id. */
const insertProbe = <T extends RepresentativeTable>(
  admin: UntypedSupabaseClient,
  client: UntypedSupabaseClient,
  table: T,
  row: Tables[T]["Insert"] & { id: string },
): WriteAttempt => ({
  attempt: () => client.from(table).insert(row),
  effectLanded: async () => readBack(await admin.from(table).select("id").eq("id", row.id)).length > 0,
});

/** UPDATE one column of row `id` to `sentinel`, which must differ from its starting value. */
const updateProbe = <T extends RepresentativeTable, C extends keyof Tables[T]["Update"] & string>(
  admin: UntypedSupabaseClient,
  client: UntypedSupabaseClient,
  table: T,
  id: string,
  column: C,
  sentinel: NonNullable<Tables[T]["Update"][C]>,
): WriteAttempt => ({
  attempt: () =>
    client
      .from(table)
      .update({ [column]: sentinel })
      .eq("id", id),
  effectLanded: async () => readBack(await admin.from(table).select(column).eq("id", id).single())[column] === sentinel,
});

/** DELETE row `id` as the principal; the effect is the row gone. */
const deleteProbe = (
  admin: UntypedSupabaseClient,
  client: UntypedSupabaseClient,
  table: RepresentativeTable,
  id: string,
): WriteAttempt => ({
  attempt: () => client.from(table).delete().eq("id", id),
  effectLanded: async () => readBack(await admin.from(table).select("id").eq("id", id)).length === 0,
});

/** Builds one profile write cell's target with the service role. `ownUserId` is null for anon. */
type ProfileWriteProbeBuilder = (
  admin: SupabaseClient,
  client: SupabaseClient,
  ownUserId: string | null,
) => Promise<WriteAttempt>;

/**
 * Every probe names `user_id` explicitly, so own and others differ only in whose id it is. Each
 * cell builds its own target: the `own` cells clear or seed the principal's one row first, so
 * neither depends on the other having run. Anon owns no row, so its `own` cells aim at a random id,
 * which the grant layer refuses before anything else could matter. Each `others` cell gets a fresh
 * user — with a profile only for UPDATE — so RLS is the only possible reason for a refusal.
 */
const PROFILE_WRITE_PROBES: Record<ProfileOwner, Record<ProfileWriteOperation, ProfileWriteProbeBuilder>> = {
  own: {
    insert: async (admin, client, ownUserId) => {
      if (ownUserId) setUp(await admin.from("profiles").delete().eq("user_id", ownUserId));
      return profileInsertProbe(admin, client, ownUserId ?? randomUUID());
    },
    update: async (admin, client, ownUserId) => {
      if (ownUserId) setUp(await admin.from("profiles").upsert({ user_id: ownUserId, display_name: "Probe start" }));
      return profileUpdateProbe(admin, client, ownUserId ?? randomUUID());
    },
  },
  others: {
    insert: async (admin, client) => profileInsertProbe(admin, client, (await createAuthUser(admin)).id),
    update: async (admin, client) => {
      const { id } = await createAuthUser(admin);
      await addProfile(admin, { userId: id, displayName: "Probe start" });
      return profileUpdateProbe(admin, client, id);
    },
  },
};

/** INSERT a profile for `userId` as the principal; the effect is a row with that owner. */
const profileInsertProbe = (admin: SupabaseClient, client: SupabaseClient, userId: string): WriteAttempt => ({
  attempt: () => client.from("profiles").insert({ user_id: userId, display_name: probeName() }),
  effectLanded: async () => readBack(await admin.from("profiles").select("user_id").eq("user_id", userId)).length > 0,
});

/** UPDATE `userId`'s display name to a sentinel; the effect is the sentinel stored. */
const profileUpdateProbe = (admin: SupabaseClient, client: SupabaseClient, userId: string): WriteAttempt => {
  const sentinel = probeName();
  return {
    attempt: () => client.from("profiles").update({ display_name: sentinel }).eq("user_id", userId),
    effectLanded: async () =>
      readBack(await admin.from("profiles").select("display_name").eq("user_id", userId)).some(
        (row) => row.display_name === sentinel,
      ),
  };
};

/**
 * Move the principal's own profile onto a fresh user who has none, so a refusal can only be RLS: an
 * existing profile would collide on the key first. The effect is a row owned by that user. Seeds
 * the own row like `own.update`, whose allowed principal is this payload's evidence.
 */
const profileRekeyProbe = async (
  admin: SupabaseClient,
  client: SupabaseClient,
  ownUserId: string | null,
): Promise<WriteAttempt> => {
  if (ownUserId) setUp(await admin.from("profiles").upsert({ user_id: ownUserId, display_name: "Probe start" }));
  const { id: targetId } = await createAuthUser(admin);
  return {
    attempt: () =>
      client
        .from("profiles")
        .update({ user_id: targetId })
        .eq("user_id", ownUserId ?? randomUUID()),
    effectLanded: async () =>
      readBack(await admin.from("profiles").select("user_id").eq("user_id", targetId)).length > 0,
  };
};

// Unique per call and within the CHECK's 60 characters.
const probeName = (): string => `Probe ${randomUUID()}`;

/**
 * `clone_plan` reads its source inside `insert … select`, so a source hidden by RLS surfaces as the
 * RPC's own "source plan … not found" (P0001), not as 42501. Catalog only: the board is irrelevant.
 */
const cloneProbe = (admin: SupabaseClient, client: SupabaseClient, planId: string): WriteAttempt => {
  const name = `Factory Plan ${randomUUID()}`;
  return {
    attempt: async () => {
      const result = await client.rpc("clone_plan", { p_source_plan_id: planId, p_name: name, p_include_board: false });
      if (result.data) registerPlan(result.data);
      return result;
    },
    effectLanded: async () => {
      // Not a pure check: it also registers what it finds, so a clone the attempt never saw is still torn down.
      const clones = readBack(await admin.from("plans").select("id").eq("name", name));
      for (const { id } of clones) registerPlan(id);
      return clones.length > 0;
    },
    // Anchored to this cell's own source, so a wrong or deleted plan id throws instead of reading as "denied".
    deniedWhen: new RegExp(`^clone_plan: source plan ${planId} not found$`),
  };
};

/**
 * At least one row in every public table, built with the service role. One plan holds every
 * plan-rooted table's rows: teachers and availability, three courses (one taught), an overlap and a
 * merge, a student with a choice, computed groupings, a placement and its bundle, a parked course,
 * and a finished job. One user, never signed in, owns the fixture profile and role row.
 */
const buildFixture = async (admin: SupabaseClient): Promise<FixtureRef> => {
  const planId = await createPlan(admin);
  const { teacherId } = await addTeacher(admin, { planId, code: "RM" });
  await addAvailability(admin, { planId, teacherId, day: 1, period: 1, severity: "soft" });
  const course = (name: string, teacherIds?: string[]) =>
    addCourse(admin, { planId, cohort: "dp1", name, hoursPerWeek: 1, teacherIds });
  const { courseId: placed } = await course("Matrix Placed", [teacherId]);
  const { courseId: dependent } = await course("Matrix Dependent");
  const { courseId: parked } = await course("Matrix Parked");
  await addOverlap(admin, { planId, baseCourseId: placed, dependentCourseId: dependent });
  await addMerge(admin, { planId, parentCourseId: dependent, childCourseId: parked });
  await addStudentWithChoices(admin, { planId, cohort: "dp1", fullName: "Matrix Student", courseIds: [placed] });
  await computeGroupingsFor(admin, { planId, cohort: "dp1" });
  await placeCourse(admin, { planId, cohort: "dp1", courseId: placed, day: 1, period: 1 });
  await shelveCourses(admin, { planId, cohort: "dp1", courseIds: [parked] });
  await addFinishedJob(admin, planId);
  const { id: profileOwnerId } = await createAuthUser(admin);
  await addProfile(admin, { userId: profileOwnerId, displayName: "Matrix Owner" });
  setUp(await admin.from("user_roles").insert({ user_id: profileOwnerId, role: "author" }));
  return { planId, profileOwnerId };
};

const addProbeCourse = async (admin: SupabaseClient, planId: string): Promise<string> =>
  (await addCourse(admin, { planId, cohort: "dp1", name: `Probe ${randomUUID()}`, hoursPerWeek: 1 })).courseId;

const addProbeStudent = async (admin: SupabaseClient, planId: string): Promise<string> =>
  (await addStudentWithChoices(admin, { planId, cohort: "dp1", fullName: "Probe", courseIds: [] })).studentId;

const addProbePlacement = async (admin: SupabaseClient, planId: string): Promise<string> => {
  const courseId = await addProbeCourse(admin, planId);
  return (await placeCourse(admin, { planId, cohort: "dp1", courseId, day: 3, period: 3 })).id;
};

/** A finished job, so it never holds its plan's one active-job slot. */
const addFinishedJob = (admin: SupabaseClient, planId: string): Promise<string> =>
  addGenerationJob(admin, { planId, status: "failed" });

/** A service-role setup write. It throws on any error: a failed setup must never read as a denial. */
const setUp = ({ error }: { error: { message: string } | null }): void => {
  if (error) throw new Error(`setup failed: ${error.message}`);
};

/** A service-role read-back. It throws on any error: a failed read-back must never read as "no effect". */
const readBack = <T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (error || data === null || data === undefined) throw new Error(`read-back failed: ${error?.message ?? "no data"}`);
  return data;
};

/** The claims RLS will judge the principal by, from the session its client holds. */
const claimsOf = async ({ client }: SignedInUser): Promise<AccessClaims> => {
  const { data } = await client.auth.getSession();
  if (!data.session) throw new Error("the signed-in client holds no session");
  return decodeAccessClaims(data.session.access_token);
};
