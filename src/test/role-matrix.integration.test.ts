import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient as UntypedSupabaseClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Database, SupabaseClient } from "@/shared/api";
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
  probeRead,
  probeWrite,
  seesFixtureRows,
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
  PROFILE_WRITES,
  READS,
  RPCS,
  WRITES,
  type Principal,
  type ProfileOwner,
  type ProfileWriteOperation,
  type RepresentativeTable,
  type TableGrants,
  type WriteOperation,
} from "./role-matrix-expectations";

/**
 * The role matrix: every cell of `role-matrix-expectations.ts`, run live through real clients.
 *
 * Rows are proven through each principal's own client by the access probe, so RLS is in play; a
 * service-role suite cannot see it at all. Grants are proven from the catalog over `pg`. App roles
 * will live in rows rather than Postgres roles, so only the first instrument will ever tell
 * S-403's admin, author and viewer apart.
 *
 * Today the matrix pins the posture S-403 replaces: anon is denied everywhere, and a signed-in user
 * without a role is allowed everywhere except another user's profile row (S-401's own-row
 * policies, which S-403 keeps). S-403 flips the expectations first (red), then its policy
 * migration turns them green. That flip is the proof that this suite can fail; the deny drill in
 * the `give-integration-lane-a-signed-in-client-per-role` change folder (`drill/`) shows it on
 * today's schema.
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

const PRINCIPALS = Object.keys(PRINCIPAL_NOTES) as Principal[];
const TABLES = Object.keys(READS) as PublicTable[];
const REPRESENTATIVES = Object.keys(WRITES) as RepresentativeTable[];
const OPERATIONS: WriteOperation[] = ["insert", "update", "delete"];
const PROFILE_OWNERS: ProfileOwner[] = ["own", "others"];
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];

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

      const expected = RPCS.clone_plan[principal];
      it(`${principal} RPC clone_plan → ${expected}`, async () => {
        expect(await probeWrite(cloneProbe(admin, principals[principal], fixture.planId))).toBe(expected);
      });
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
 * and a finished job. One user, never signed in, owns the fixture profile.
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
