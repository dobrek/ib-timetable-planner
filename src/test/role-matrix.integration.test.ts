import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import type { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { shelveCourses } from "@/_pages/plan-detail/api/shelf";
import { computeSnapshotHash } from "@/entities/timetable";
import type { Database, SupabaseClient } from "@/shared/api";
import {
  addAvailability,
  addCourse,
  addMerge,
  addOverlap,
  addStudentWithChoices,
  addTeacher,
  computeGroupingsFor,
  createPlan,
  createSignedInUser,
  placeCourse,
  registerPlan,
  teardown,
  type SignedInUser,
} from "@/test/factories";
import { probeRead, probeWrite, seesFixtureRows, type PublicTable, type WriteAttempt } from "./access-probe";
import { connectPostgres, heldPrivileges } from "./postgres-client";
import { readPublishableKey } from "./publishable-key";
import {
  GRANTS,
  PRINCIPAL_NOTES,
  READS,
  RPCS,
  WRITES,
  type Principal,
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
 * without a role is allowed everywhere. S-403 flips the expectations first (red), then its policy
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
const CLONE_SOURCE_HIDDEN = /source plan .* not found/;

(hasEnv ? describe : describe.skip)("role matrix (local Supabase)", () => {
  let admin: SupabaseClient;
  let pg: Client;
  let signedIn: Record<SignedInPrincipal, SignedInUser>;
  let principals: Record<Principal, SupabaseClient>;
  let planId: string;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY || !PUBLISHABLE_KEY) return;
    admin = createClient<Database>(SUPABASE_URL, SERVICE_KEY);
    pg = await connectPostgres();
    signedIn = { noRole: await createSignedInUser(admin) };
    principals = {
      // The publishable key and no session: never signed in.
      anon: createClient<Database>(SUPABASE_URL, PUBLISHABLE_KEY, {
        auth: { persistSession: false, autoRefreshToken: false },
      }),
      noRole: signedIn.noRole.client,
    };
    planId = await buildFixture(admin);
  }, 30_000);

  afterAll(async () => {
    await teardown(admin);
    await pg.end();
  });

  it("fixture: the service role sees a fixture row in every public table", async () => {
    const sightings = await Promise.all(
      TABLES.map(async (table) => ({ table, seen: await seesFixtureRows(admin, table, planId) })),
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
          expect(await probeRead(principals[principal], table, planId)).toBe(expected);
        });
      }

      for (const table of REPRESENTATIVES) {
        for (const operation of OPERATIONS) {
          const expected = WRITES[table][operation][principal];
          it(`${principal} ${operation.toUpperCase()} ${table} → ${expected}`, async () => {
            const attempt = await WRITE_PROBES[table][operation](admin, principals[principal], planId);
            expect(await probeWrite(attempt)).toBe(expected);
          });
        }
      }

      const expected = RPCS.clone_plan[principal];
      it(`${principal} RPC clone_plan → ${expected}`, async () => {
        expect(await probeWrite(cloneProbe(admin, principals[principal], planId))).toBe(expected);
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
  const entries = await Promise.all(
    rows.map(
      async ({ relname, relrowsecurity }): Promise<[string, TablePosture]> => [
        relname,
        {
          anon: await heldPrivileges(pg, "anon", `public.${relname}`),
          authenticated: await heldPrivileges(pg, "authenticated", `public.${relname}`),
          rls: relrowsecurity,
        },
      ],
    ),
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
      return Promise.resolve({
        attempt: () => client.from("plans").insert({ id, name: `Factory Plan ${id}`, slot_grid_preset: "5x10" }),
        effectLanded: async () => readBack(await admin.from("plans").select("id").eq("id", id)).length > 0,
      });
    },
    update: async (admin, client) => {
      const id = await createPlan(admin);
      const name = `Factory Plan ${randomUUID()}`;
      return {
        attempt: () => client.from("plans").update({ name }).eq("id", id),
        effectLanded: async () =>
          readBack(await admin.from("plans").select("name").eq("id", id).single()).name === name,
      };
    },
    delete: async (admin, client) => {
      const id = await createPlan(admin);
      return {
        attempt: () => client.from("plans").delete().eq("id", id),
        effectLanded: async () => readBack(await admin.from("plans").select("id").eq("id", id)).length === 0,
      };
    },
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
      return Promise.resolve({
        attempt: () => client.from("courses").insert(row),
        effectLanded: async () => readBack(await admin.from("courses").select("id").eq("id", id)).length > 0,
      });
    },
    update: async (admin, client, planId) => {
      const id = await addProbeCourse(admin, planId);
      const color = "#5e771e";
      return {
        attempt: () => client.from("courses").update({ color }).eq("id", id),
        effectLanded: async () =>
          readBack(await admin.from("courses").select("color").eq("id", id).single()).color === color,
      };
    },
    delete: async (admin, client, planId) => {
      const id = await addProbeCourse(admin, planId);
      return {
        attempt: () => client.from("courses").delete().eq("id", id),
        effectLanded: async () => readBack(await admin.from("courses").select("id").eq("id", id)).length === 0,
      };
    },
  },
  students: {
    insert: (admin, client, planId) => {
      const id = randomUUID();
      return Promise.resolve({
        attempt: () => client.from("students").insert({ id, plan_id: planId, cohort: "dp1", full_name: "Probe" }),
        effectLanded: async () => readBack(await admin.from("students").select("id").eq("id", id)).length > 0,
      });
    },
    update: async (admin, client, planId) => {
      const id = await addProbeStudent(admin, planId);
      const fullName = `Probe ${randomUUID()}`;
      return {
        attempt: () => client.from("students").update({ full_name: fullName }).eq("id", id),
        effectLanded: async () =>
          readBack(await admin.from("students").select("full_name").eq("id", id).single()).full_name === fullName,
      };
    },
    delete: async (admin, client, planId) => {
      const id = await addProbeStudent(admin, planId);
      return {
        attempt: () => client.from("students").delete().eq("id", id),
        effectLanded: async () => readBack(await admin.from("students").select("id").eq("id", id)).length === 0,
      };
    },
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
    update: async (admin, client, planId) => {
      const id = await addProbePlacement(admin, planId);
      return {
        attempt: () => client.from("placements").update({ is_optional: true }).eq("id", id),
        effectLanded: async () =>
          readBack(await admin.from("placements").select("is_optional").eq("id", id).single()).is_optional,
      };
    },
    delete: async (admin, client, planId) => {
      const id = await addProbePlacement(admin, planId);
      return {
        attempt: () => client.from("placements").delete().eq("id", id),
        effectLanded: async () => readBack(await admin.from("placements").select("id").eq("id", id)).length === 0,
      };
    },
  },
  // Each cell gets a plan of its own: a plan holds at most one queued or running job.
  generation_jobs: {
    insert: async (admin, client) => {
      const id = randomUUID();
      const row = { id, ...(await jobRow(await createPlan(admin))) };
      return {
        attempt: () => client.from("generation_jobs").insert(row),
        effectLanded: async () => readBack(await admin.from("generation_jobs").select("id").eq("id", id)).length > 0,
      };
    },
    update: async (admin, client) => {
      const id = await insertTerminalJob(admin, await createPlan(admin));
      const error = `probe ${randomUUID()}`;
      return {
        attempt: () => client.from("generation_jobs").update({ error }).eq("id", id),
        effectLanded: async () =>
          readBack(await admin.from("generation_jobs").select("error").eq("id", id).single()).error === error,
      };
    },
    delete: async (admin, client) => {
      const id = await insertTerminalJob(admin, await createPlan(admin));
      return {
        attempt: () => client.from("generation_jobs").delete().eq("id", id),
        effectLanded: async () => readBack(await admin.from("generation_jobs").select("id").eq("id", id)).length === 0,
      };
    },
  },
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
      const clones = readBack(await admin.from("plans").select("id").eq("name", name));
      for (const { id } of clones) registerPlan(id);
      return clones.length > 0;
    },
    deniedWhen: CLONE_SOURCE_HIDDEN,
  };
};

/**
 * One plan with at least one row in every public table, built with the service role:
 * teachers and availability, three courses (one taught), an overlap and a merge, a student with a
 * choice, computed groupings, a placement and its bundle, a parked course, and a finished job.
 */
const buildFixture = async (admin: SupabaseClient): Promise<string> => {
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
  await shelveCourses(admin, {
    planId,
    cohort: "dp1",
    members: [{ courseId: parked, week: "both", isOptional: false }],
  });
  await insertTerminalJob(admin, planId);
  return planId;
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
const insertTerminalJob = async (admin: SupabaseClient, planId: string): Promise<string> => {
  const { data, error } = await admin
    .from("generation_jobs")
    .insert({ ...(await jobRow(planId)), status: "failed" })
    .select("id")
    .single();
  if (error) throw new Error(`insertTerminalJob: ${error.message}`);
  return data.id;
};

const jobRow = async (planId: string): Promise<Database["public"]["Tables"]["generation_jobs"]["Insert"]> => {
  const snapshot = {
    days: 5,
    periods: 10,
    availability: [],
    finishesEarlyByCourseId: [],
    cohorts: {
      dp1: { courses: [], pins: [], parkedCourseIds: [] },
      dp2: { courses: [], pins: [], parkedCourseIds: [] },
    },
  };
  return {
    plan_id: planId,
    policy: { budgetMs: 20_000, mode: "full" },
    snapshot,
    snapshot_hash: await computeSnapshotHash(snapshot),
  };
};

/** A service-role read-back. It throws on any error: a failed read-back must never read as "no effect". */
const readBack = <T>({ data, error }: { data: T; error: { message: string } | null }): NonNullable<T> => {
  if (error || data === null || data === undefined) throw new Error(`read-back failed: ${error?.message ?? "no data"}`);
  return data;
};

type Claims = { role?: string; sub?: string; app_metadata?: { machine_role?: string } };

/** The access token's payload, decoded without verification: the claims RLS will judge it by. */
const claimsOf = async ({ client }: SignedInUser): Promise<Claims> => {
  const { data } = await client.auth.getSession();
  const payload = data.session?.access_token.split(".")[1];
  if (!payload) throw new Error("the signed-in client holds no JWT access token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Claims;
};
