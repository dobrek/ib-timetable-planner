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
  classifyWrite,
  probeRead,
  probeUserRowRead,
  probeWrite,
  seesFixtureRows,
  type AccessOutcome,
  type FixtureRef,
  type UserKeyedTable,
  type WriteAttempt,
} from "./access-probe";
import { connectPostgres, heldPrivileges } from "./postgres-client";
import { createPublishableClient } from "./publishable-client";
import { readPublishableKey } from "./publishable-key";
import {
  CAPABILITY_POLICIES,
  GRANTS,
  PRINCIPAL_NOTES,
  PROFILE_REKEY,
  PROFILE_WRITES,
  READS,
  RPCS,
  SELF_GRANT_EVIDENCE,
  SELF_GRANTS,
  USER_KEYED_READS,
  WRITES,
  type PlanScopedTable,
  type PolicyShape,
  type Principal,
  type ProfileWriteOperation,
  type RepresentativeTable,
  type RowOwner,
  type Rpc,
  type SelfGrant,
  type TableGrants,
  type WriteOperation,
} from "./role-matrix-expectations";

/**
 * The role matrix: every cell of `role-matrix-expectations.ts`, run live through real clients.
 *
 * Rows are proven through each principal's own client by the access probe, so RLS is in play; a
 * service-role suite cannot see it at all. Grants are proven from the catalog over `pg`, and so are
 * the role helpers in the `private` schema, which PostgREST does not expose, and the policies
 * themselves. App roles live in rows (`user_roles`) rather than Postgres roles, so only the first
 * instrument tells admin, author and viewer apart.
 *
 * The matrix pins S-403's fail-closed posture. Anon is denied everywhere. A signed-in user without
 * a role reaches only its own profile. A viewer reads every plan and profile, and writes only its
 * own profile. An author and an admin read and write every plan. Behavioural cells cover five
 * representative tables, so a structural check over `pg_policies` proves the other eleven: every
 * plan-scoped table holds exactly `CAPABILITY_POLICIES`, and no policy a session can fall under is
 * a literal `true`.
 *
 * S-403 flipped the expectations before its policy migration existed. Their red run against the old
 * policies (the `fail-closed-roles` change's deny drill) is the proof that this suite can fail, as
 * F-401's drill (`drill/` in the `give-integration-lane-a-signed-in-client-per-role` change folder)
 * was before it.
 *
 * Each principal signs in once per file, never per test, which keeps the lane clear of GoTrue's
 * rate limits. Each write cell acts on a fresh target, and each read of a user-keyed table names the
 * row it targets, so cells never depend on their order.
 */
const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PUBLISHABLE_KEY = readPublishableKey();
const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY && PUBLISHABLE_KEY);

/** Every principal but anon holds a session. */
type SignedInPrincipal = Exclude<Principal, "anon">;

/** The role each signed-in principal signs in holding, which `own_app_role` must answer. */
const HELD_ROLES: Record<SignedInPrincipal, AppRole | null> = {
  noRole: null,
  viewer: "viewer",
  author: "author",
  admin: "admin",
};

/** Every write a self-grant can send: the service role's evidence covers each one. */
const SELF_GRANT_WRITES: Record<SelfGrant, WriteOperation[]> = {
  "claim admin": ["insert", "update"],
  "drop own role": ["delete"],
};

/**
 * The write a principal's self-grant sends. Claiming `admin` INSERTs a role row when the principal
 * holds none, and UPDATEs the one it holds; dropping its role DELETEs that row.
 */
const selfGrantWrite = (grant: SelfGrant, principal: Principal): WriteOperation => {
  if (grant === "drop own role") return "delete";
  return principal !== "anon" && HELD_ROLES[principal] !== null ? "update" : "insert";
};

const PRINCIPALS = Object.keys(PRINCIPAL_NOTES) as Principal[];
const SIGNED_IN_PRINCIPALS = Object.keys(HELD_ROLES) as SignedInPrincipal[];
const PLAN_SCOPED_TABLES = Object.keys(READS) as PlanScopedTable[];
const USER_KEYED_TABLES = Object.keys(USER_KEYED_READS) as UserKeyedTable[];
const REPRESENTATIVES = Object.keys(WRITES) as RepresentativeTable[];
const OPERATIONS: WriteOperation[] = ["insert", "update", "delete"];
const ROW_OWNERS: RowOwner[] = ["own", "others"];
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];
const SELF_GRANT_NAMES = Object.keys(SELF_GRANTS) as SelfGrant[];
const RPC_NAMES = Object.keys(RPCS) as Rpc[];

(hasEnv ? describe : describe.skip)("role matrix (local Supabase)", () => {
  let admin: SupabaseClient;
  let pg: Client;
  let signedIn: Record<SignedInPrincipal, SignedInUser>;
  let principals: Record<Principal, SupabaseClient>;
  let fixture: FixtureRef;

  // Anon holds no session, so it owns no row.
  const ownUserIdOf = (principal: Principal): string | null => (principal === "anon" ? null : signedIn[principal].id);

  /**
   * The user whose row a user-keyed read names, made sure to exist as the service role, so an empty
   * read can only mean a denial. The principal's own profile is seeded, since a user holds one only
   * once they save a display name; its role row is the one it signed in with, and the fixture owner
   * holds both. Anon owns no row, so it aims at a random id, which the grant layer refuses before a
   * row could matter.
   */
  const userRowTargetOf = async (principal: Principal, table: UserKeyedTable, owner: RowOwner): Promise<string> => {
    if (owner === "others") return requireUserRow(admin, table, fixture.profileOwnerId);
    const ownUserId = ownUserIdOf(principal);
    if (!ownUserId) return randomUUID();
    if (table === "profiles") {
      setUp(await admin.from("profiles").upsert({ user_id: ownUserId, display_name: "Probe start" }));
    }
    return requireUserRow(admin, table, ownUserId);
  };

  // A "no-row" cell is not probed. Its premise is checked instead, so the marker can never hide a cell.
  const lacksOwnRow = async (principal: Principal, table: UserKeyedTable): Promise<boolean> => {
    const ownUserId = ownUserIdOf(principal);
    if (!ownUserId) throw new Error(`${principal} owns no row it could lack`);
    return !(await hasUserRow(admin, table, ownUserId));
  };

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
    signedIn = await signInEveryPrincipal(admin);
    principals = {
      // The publishable key and no session: never signed in.
      anon: createPublishableClient(SUPABASE_URL, PUBLISHABLE_KEY),
      noRole: signedIn.noRole.client,
      viewer: signedIn.viewer.client,
      author: signedIn.author.client,
      admin: signedIn.admin.client,
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
      [...PLAN_SCOPED_TABLES, ...USER_KEYED_TABLES].map(async (table) => ({
        table,
        seen: await seesFixtureRows(admin, table, fixture),
      })),
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

  it("catalog: every plan-scoped table holds exactly the four capability policies, and no other", async () => {
    const declared = Object.fromEntries(PLAN_SCOPED_TABLES.map((table) => [table, CAPABILITY_POLICIES]));

    // A new table without the four, a fifth policy, a drifted name or an unwrapped helper all differ.
    expect(await humanPolicies(pg)).toEqual(declared);
  });

  it("catalog: no policy that authenticated or PUBLIC falls under is a literal `true`", async () => {
    const { rows } = await pg.query<{ policy: string }>(
      `select format('%s: %s', tablename, policyname) as policy
         from pg_policies
        where schemaname = 'public'
          and roles && array['authenticated', 'public']::name[]
          and (qual = 'true' or with_check = 'true')
        order by tablename, policyname`,
    );
    // The solver's `to solver_job_writer` policies are out of scope: no human session holds that role.
    expect(rows.map(({ policy }) => policy)).toEqual([]);
  });

  it("catalog: private holds the role helpers, and only current_app_role is SECURITY DEFINER", async () => {
    expect(await privateFunctionSecurity(pg)).toEqual(PRIVATE_FUNCTIONS);
  });

  it("catalog: current_app_role is the only SECURITY DEFINER function in the schemas this repo owns", async () => {
    const { rows } = await pg.query<{ signature: string }>(
      `select ${QUALIFIED_SIGNATURE} as signature
         from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where p.prosecdef
          and n.nspname in ('public', 'private')
        order by 1`,
    );
    // CLAUDE.md's recorded exception covers one function. A second needs its reason in its migration
    // and the plan that introduces it, and then a place here.
    expect(rows.map(({ signature }) => signature)).toEqual(["private.current_app_role()"]);
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

  it("catalog: only authenticated may execute the private helpers, own_app_role and set_current_plan, never anon or PUBLIC", async () => {
    expect(await roleFunctionExecutors(pg)).toEqual({
      "private.can_edit()": ["authenticated"],
      "private.can_read()": ["authenticated"],
      "private.current_app_role()": ["authenticated"],
      "public.own_app_role()": ["authenticated"],
      "public.set_current_plan(p_plan_id uuid)": ["authenticated"],
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

      for (const table of PLAN_SCOPED_TABLES) {
        const expected = READS[table][principal];
        it(`${principal} SELECT ${table} → ${expected}`, async () => {
          expect(await probeRead(principals[principal], table, fixture)).toBe(expected);
        });
      }

      for (const table of USER_KEYED_TABLES) {
        for (const owner of ROW_OWNERS) {
          const expected = USER_KEYED_READS[table][owner][principal];
          if (expected === "no-row") {
            it(`${principal} SELECT ${owner} ${table} row → no-row: it holds none`, async () => {
              expect(await lacksOwnRow(principal, table)).toBe(true);
            });
          } else {
            it(`${principal} SELECT ${owner} ${table} row → ${expected}`, async () => {
              const userId = await userRowTargetOf(principal, table, owner);
              expect(await probeUserRowRead(principals[principal], table, userId)).toBe(expected);
            });
          }
        }
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

      for (const owner of ROW_OWNERS) {
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

      for (const grant of SELF_GRANT_NAMES) {
        const expected = SELF_GRANTS[grant][principal];
        if (expected === "no-row") {
          it(`${principal} ${grant} → no-row: it holds no role row`, async () => {
            expect(await lacksOwnRow(principal, "user_roles")).toBe(true);
          });
        } else {
          const write = selfGrantWrite(grant, principal);
          const whose = principal === "anon" ? "a fresh user's" : "own";
          it(`${principal} ${grant} (${write.toUpperCase()} ${whose} role row) → ${expected}`, async () => {
            const target = ownUserIdOf(principal) ?? (await freshRoleTarget(admin, write));
            const attempt = await ROLE_WRITE_PROBES[write](admin, principals[principal], target);
            expect(await probeWrite(attempt)).toBe(expected);
          });
        }
      }

      for (const rpc of RPC_NAMES) {
        const expected = RPCS[rpc][principal];
        it(`${principal} RPC ${rpc} → ${expected}`, async () => {
          expect(await RPC_PROBES[rpc](admin, principals[principal], fixture.planId)).toBe(expected);
        });
      }
    });
  }

  // No app principal may send a self-grant, so the service role sends each one instead: the evidence
  // that every all-denied `SELF_GRANTS` row is refused for access, not for a broken payload.
  describe("service role — the evidence for the self-grant rows", () => {
    for (const grant of SELF_GRANT_NAMES) {
      for (const write of SELF_GRANT_WRITES[grant]) {
        const expected = SELF_GRANT_EVIDENCE[grant];
        it(`service role ${grant} (${write.toUpperCase()} a fresh user's role row) → ${expected}`, async () => {
          const attempt = await ROLE_WRITE_PROBES[write](admin, admin, await freshRoleTarget(admin, write));
          expect(await probeWrite(attempt)).toBe(expected);
        });
      }
    }
  });
});

/** Signs every signed-in principal in at once, each holding its role from `HELD_ROLES`. */
const signInEveryPrincipal = async (admin: SupabaseClient): Promise<Record<SignedInPrincipal, SignedInUser>> => {
  const users = await Promise.all(
    SIGNED_IN_PRINCIPALS.map(
      async (principal) =>
        [principal, await createSignedInUser(admin, { role: HELD_ROLES[principal] ?? undefined })] as const,
    ),
  );
  return Object.fromEntries(users) as Record<SignedInPrincipal, SignedInUser>;
};

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

/**
 * Every RLS table in `public` but the user-keyed ones, with each policy a human session can fall
 * under, as `pg_policies` states it and sorted by command. The solver's `to solver_job_writer`
 * policies are left out, since no human session holds that role. A table with no policy lists none.
 */
const humanPolicies = async (pg: Client): Promise<Record<string, PolicyShape[]>> => {
  const { rows } = await pg.query<{ relname: string; policies: PolicyShape[] }>(
    `select c.relname,
            coalesce(
              jsonb_agg(
                jsonb_build_object(
                  'name', p.policyname, 'command', p.cmd, 'roles', p.roles, 'using', p.qual, 'withCheck', p.with_check
                )
                order by p.cmd, p.policyname
              ) filter (where p.policyname is not null),
              '[]'
            ) as policies
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_policies p
         on p.schemaname = n.nspname and p.tablename = c.relname and p.roles <> '{solver_job_writer}'
      where n.nspname = 'public'
        and c.relkind in ('r', 'p')
        and c.relrowsecurity
        and c.relname <> all ($1::text[])
      group by c.relname`,
    [USER_KEYED_TABLES],
  );
  return Object.fromEntries(rows.map(({ relname, policies }) => [relname, policies]));
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
 * Which of anon, authenticated and PUBLIC may execute each function in `private`, the app's role
 * read, and the current-plan move. Postgres gives PUBLIC EXECUTE on every new function, so a missed
 * revoke shows up here. The `RPCS` anon cell cannot catch one for `set_current_plan`: run as anon,
 * an INVOKER function meets only `to authenticated` policies, sees no row and returns empty, which
 * reads "denied" either way. A function that is gone shows up as a missing key.
 */
const roleFunctionExecutors = async (pg: Client): Promise<Record<string, string[]>> => {
  const { rows } = await pg.query<{ signature: string; executors: string[] }>(
    `select ${QUALIFIED_SIGNATURE} as signature,
            array(select r from unnest(array['anon', 'authenticated', 'public']) as r
                   where has_function_privilege(r, p.oid, 'EXECUTE') order by r) as executors
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'private'
         or p.oid = any (array[to_regprocedure('public.own_app_role()'), to_regprocedure('public.set_current_plan(uuid)')])`,
  );
  return Object.fromEntries(rows.map(({ signature, executors }) => [signature, executors]));
};

// `schema.name(args)`, whatever the connection's search_path: `regprocedure` drops a visible schema.
const QUALIFIED_SIGNATURE = "format('%s.%s(%s)', n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))";

/** One RPC cell: the call as the principal, classified. */
type RpcProbe = (admin: SupabaseClient, client: SupabaseClient, planId: string) => Promise<AccessOutcome>;

const RPC_PROBES: Record<Rpc, RpcProbe> = {
  apply_generated_placements: async (admin, client) => probeWrite(await applyGeneratedProbe(admin, client)),
  clone_plan: (admin, client, planId) => probeWrite(cloneProbe(admin, client, planId)),
  // A read: there is no effect to read back, so the call's own answer is the outcome. What it
  // answers is checked per principal, against `HELD_ROLES`.
  own_app_role: async (_admin, client) => classifyCall((await client.rpc("own_app_role")).error),
  replace_cohort_groupings: async (admin, client) => probeWrite(await replaceGroupingsProbe(admin, client)),
  set_current_plan: (admin, client) => setCurrentProbe(admin, client),
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
const PROFILE_WRITE_PROBES: Record<RowOwner, Record<ProfileWriteOperation, ProfileWriteProbeBuilder>> = {
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

/** Whether the service role sees `userId`'s row in `table`. Throws on any error. */
const hasUserRow = async (admin: UntypedSupabaseClient, table: UserKeyedTable, userId: string): Promise<boolean> =>
  readBack(await admin.from(table).select("user_id").eq("user_id", userId)).length > 0;

/** `userId`, once the service role sees its row in `table`. A missing row is a setup failure. */
const requireUserRow = async (admin: UntypedSupabaseClient, table: UserKeyedTable, userId: string): Promise<string> => {
  if (!(await hasUserRow(admin, table, userId))) throw new Error(`setup failed: no ${table} row for ${userId}`);
  return userId;
};

/** One self-grant write against `userId`'s role row, sent by `client`. */
type RoleWriteProbe = (admin: SupabaseClient, client: SupabaseClient, userId: string) => Promise<WriteAttempt>;

/**
 * Each probe first checks that its target is in the state the write needs: no role row to INSERT,
 * one to UPDATE or DELETE. So the read-back can only change if the write lands, and a missing or
 * stray row is a setup failure rather than an outcome.
 */
const ROLE_WRITE_PROBES: Record<WriteOperation, RoleWriteProbe> = {
  insert: async (admin, client, userId) => {
    if (await roleRowOf(admin, userId)) throw new Error(`setup failed: ${userId} already holds a role row`);
    return {
      attempt: () => client.from("user_roles").insert({ user_id: userId, role: "admin" }),
      effectLanded: async () => (await roleRowOf(admin, userId)) !== null,
    };
  },
  // Every UPDATE moves `updated_at` (the moddatetime trigger), so the effect shows even on a row
  // that already reads `admin`, which is what an admin's self-grant sends.
  update: async (admin, client, userId) => {
    const before = await requireRoleRow(admin, userId);
    return {
      attempt: () => client.from("user_roles").update({ role: "admin" }).eq("user_id", userId),
      effectLanded: async () => (await requireRoleRow(admin, userId)).updated_at !== before.updated_at,
    };
  },
  delete: async (admin, client, userId) => {
    await requireRoleRow(admin, userId);
    return {
      attempt: () => client.from("user_roles").delete().eq("user_id", userId),
      effectLanded: async () => (await roleRowOf(admin, userId)) === null,
    };
  },
};

/**
 * A fresh user in the state `write` needs: no role row to INSERT, an `author` row to UPDATE or
 * DELETE. The target of anon's self-grants, which owns no row, and of the service role's evidence.
 */
const freshRoleTarget = async (admin: SupabaseClient, write: WriteOperation): Promise<string> => {
  const { id } = await createAuthUser(admin);
  if (write !== "insert") setUp(await admin.from("user_roles").insert({ user_id: id, role: "author" }));
  return id;
};

type RoleRow = { role: AppRole; updated_at: string };

/** `userId`'s role row as the service role sees it, or null when it holds none. Throws on any error. */
const roleRowOf = async (admin: SupabaseClient, userId: string): Promise<RoleRow | null> => {
  const { data, error } = await admin.from("user_roles").select("role, updated_at").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(`read-back failed: ${error.message}`);
  return data;
};

const requireRoleRow = async (admin: SupabaseClient, userId: string): Promise<RoleRow> => {
  const row = await roleRowOf(admin, userId);
  if (!row) throw new Error(`setup failed: ${userId} holds no role row`);
  return row;
};

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
 * `apply_generated_placements` on one cell of a fresh plan: the region replace a delivery lands a
 * generated board with (S-405 records that a viewer's visit cannot). A fresh plan per cell, because a
 * region replace states a cell's whole content and would otherwise rewrite the fixture's rows. A
 * viewer's or role-less user's bundle INSERT fails WITH CHECK (42501), and anon holds no grant on the
 * tables the body writes (42501). The effect is the placement row, read back by its course.
 */
const applyGeneratedProbe = async (admin: SupabaseClient, client: SupabaseClient): Promise<WriteAttempt> => {
  const planId = await createPlan(admin);
  const courseId = await addProbeCourse(admin, planId);
  return {
    attempt: () =>
      client.rpc("apply_generated_placements", {
        p_plan_id: planId,
        p_cells: [{ cohort: "dp1", day: 4, period: 4 }],
        p_placements: [{ cohort: "dp1", course_id: courseId, day: 4, period: 4, week: "both", is_optional: false }],
      }),
    effectLanded: async () =>
      readBack(await admin.from("placements").select("id").eq("course_id", courseId)).length > 0,
  };
};

/**
 * `replace_cohort_groupings` on a fresh plan: the write behind computing a cohort's groupings. A fresh
 * plan per cell, because the call deletes the cohort's groupings first and the fixture's must survive.
 * The payload needs one grouping, or a refused principal would only meet the DELETE, which matches
 * no rows rather than failing; with one, its INSERT fails WITH CHECK (42501). The effect is a grouping
 * row carrying the cell's own catalog hash.
 */
const replaceGroupingsProbe = async (admin: SupabaseClient, client: SupabaseClient): Promise<WriteAttempt> => {
  const planId = await createPlan(admin);
  const courseId = await addProbeCourse(admin, planId);
  const catalogHash = `probe-${randomUUID()}`;
  return {
    attempt: () =>
      client.rpc("replace_cohort_groupings", {
        p_plan_id: planId,
        p_cohort: "dp1",
        p_catalog_hash: catalogHash,
        p_groupings: [{ coverage_count: 1, score: 1, member_ids: [courseId], opposite_week: false }],
      }),
    effectLanded: async () =>
      readBack(await admin.from("course_groupings").select("id").eq("catalog_hash", catalogHash)).length > 0,
  };
};

/**
 * `set_current_plan` on a fresh plan. An allowed principal really moves the one current-plan marker
 * there, on purpose: that is the write under test, and it is safe because no suite asserts which
 * plan is current at a given moment (`current-plan.integration.test.ts`'s isolation rules). For the
 * same reason the RPC's own answer is the first evidence: a parallel file may move the marker
 * between the call and a read-back, which would turn an allowed cell into "denied". The read-back
 * is only the fallback, for a call that returned no marked row. A denied principal never gets one
 * back: a viewer's write fails WITH CHECK (42501), anon holds no EXECUTE (42501), and a user without
 * a role sees no plan, so nothing is returned.
 */
const setCurrentProbe = async (admin: SupabaseClient, client: SupabaseClient): Promise<AccessOutcome> => {
  const planId = await createPlan(admin);
  const { data, error } = await client.rpc("set_current_plan", { p_plan_id: planId });
  const returnedMarked = (data ?? []).some((row) => row.id === planId && row.is_current);
  const effectObserved =
    returnedMarked || readBack(await admin.from("plans").select("is_current").eq("id", planId).single()).is_current;
  return classifyWrite({ error, effectObserved });
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
