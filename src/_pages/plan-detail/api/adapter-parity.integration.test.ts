import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadCohortCourses, type Database } from "@/shared/api";
import { createPlan, seedPlanCatalog, teardown } from "@/test/factories";
import type { GroupingCourse } from "../model/grouping";
import { loadFixtureCourses } from "./__fixtures__/cohort-catalog.node";

// Proves the Supabase adapter produces the same domain projection as the fixture
// adapter on identical data — the definitive check of the course_overlaps
// base/dependent direction (research Open Q3). The two adapters use different
// identity tokens (UUIDs vs composite-name strings), so we align on the natural
// key (composite name) and translate UUIDs back to names/codes before comparing.
//
// Local-only: connects with the service_role/secret key (bypasses RLS). Skips
// cleanly when the env or stack is unavailable. Owns a factory-seeded plan whose
// dp2 catalog comes from the same data/dp2 CSVs the fixture oracle reads — so the
// parity check stays meaningful while the suite depends on nothing already in the DB.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const COHORT = "dp2";
const FIXTURE_DIR = "data/dp2";

const hasEnv = Boolean(SUPABASE_URL && SERVICE_KEY);

(hasEnv ? describe : describe.skip)("dual-adapter parity (dp2)", () => {
  let supabase: SupabaseClient<Database>;
  let planId: string;
  let studentName: Map<string, string>;
  let teacherCode: Map<string, string>;

  beforeAll(async () => {
    if (!SUPABASE_URL || !SERVICE_KEY) return;
    supabase = createClient<Database>(SUPABASE_URL, SERVICE_KEY);

    planId = await createPlan(supabase);
    await seedPlanCatalog(supabase, planId);

    const { data: students } = await supabase.from("students").select("id, full_name").eq("plan_id", planId);
    studentName = new Map((students ?? []).map((s) => [s.id, s.full_name]));

    const { data: teachers } = await supabase.from("teachers").select("id, code").eq("plan_id", planId);
    teacherCode = new Map((teachers ?? []).map((t) => [t.id, t.code]));
  });

  afterAll(async () => {
    await teardown(supabase);
  });

  it("Supabase adapter ≡ fixture adapter on the dp2 catalog", async () => {
    const fixtureCourses = loadFixtureCourses(FIXTURE_DIR);
    const { courses: dbCourses, names } = await loadCohortCourses(supabase, planId, COHORT);

    // Re-key the Supabase projection on the composite name (the fixture's id),
    // translating UUID tokens to the fixture's name/code tokens.
    const dbByName = new Map<string, GroupingCourse>(
      dbCourses.map((course) => [
        names.get(course.id) ?? course.id,
        {
          id: names.get(course.id) ?? course.id,
          teacherKeys: course.teacherKeys.map((id) => teacherCode.get(id) ?? `?${id}`),
          hours: course.hours,
          studentKeys: course.studentKeys.map((id) => studentName.get(id) ?? `?${id}`),
        },
      ]),
    );
    const fixtureByName = new Map(fixtureCourses.map((course) => [course.id, course]));

    // 1. Same set of courses (composite names) in both adapters.
    const onlyInFixture = [...fixtureByName.keys()].filter((name) => !dbByName.has(name)).sort();
    const onlyInDb = [...dbByName.keys()].filter((name) => !fixtureByName.has(name)).sort();
    expect({ onlyInFixture, onlyInDb }).toEqual({ onlyInFixture: [], onlyInDb: [] });

    // 2. Per-course field parity: teacherKeys, hours, studentKeys (teachers + students as sets).
    const diffs = [...fixtureByName.entries()].flatMap(([name, fixture]) => {
      const db = dbByName.get(name);
      if (!db) return [];
      const problems: string[] = [];
      const dbTeachers = new Set(db.teacherKeys);
      const fixtureTeachers = new Set(fixture.teacherKeys);
      if (dbTeachers.size !== fixtureTeachers.size || [...fixtureTeachers].some((t) => !dbTeachers.has(t))) {
        const missing = [...fixtureTeachers].filter((t) => !dbTeachers.has(t));
        const extra = [...dbTeachers].filter((t) => !fixtureTeachers.has(t));
        problems.push(`teachers: missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`);
      }
      if (db.hours !== fixture.hours) {
        problems.push(`hours: db=${db.hours} fixture=${fixture.hours}`);
      }
      const dbStudents = new Set(db.studentKeys);
      const fixtureStudents = new Set(fixture.studentKeys);
      if (dbStudents.size !== fixtureStudents.size || [...fixtureStudents].some((s) => !dbStudents.has(s))) {
        const missing = [...fixtureStudents].filter((s) => !dbStudents.has(s));
        const extra = [...dbStudents].filter((s) => !fixtureStudents.has(s));
        problems.push(`students: missing=[${missing.join(", ")}] extra=[${extra.join(", ")}]`);
      }
      return problems.length ? [`${name} → ${problems.join("; ")}`] : [];
    });

    expect(diffs).toEqual([]);
  });
});
