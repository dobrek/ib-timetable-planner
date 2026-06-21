// Shared CSV → catalog transcode. Single source of truth for turning the
// data/dp1 + data/dp2 fixtures into plan-owned, FK-remapped catalog rows.
//
// Two consumers:
//   1. scripts/gen-seed.mjs — serializes the returned rows to SQL (seed.sql).
//   2. src/test/factories/seed-plan-catalog.ts — inserts the same rows via
//      supabase-js, rebound to a test-owned plan_id.
//
// Because both consume the SAME builder, the composite-FK remap (the exact logic
// the two-plan "Seed Plan A/B" design exists to stress) is single-sourced and
// guarded by the byte-identical seed check, instead of duplicated and unguarded.
//
// This module is TOOLING, not runtime: it reads the CSV fixtures with node:fs and
// is consumed only by the build script and Vitest — never bundled into the Worker,
// so the no-Node-APIs rule is not engaged.
//
// The functions return RAW values (uuids, strings, numbers, nulls) — SQL quoting
// lives in gen-seed.mjs. randomUUID() call order is preserved exactly so the
// generated seed.sql stays structurally byte-identical (see plan §Critical Details).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dp1 = (...p) => resolve(ROOT, "data", "dp1", ...p);
const dp2 = (...p) => resolve(ROOT, "data", "dp2", ...p);

// Directory names map directly to the cohort enum literals.
const COHORT_DP1 = "dp1";
const COHORT_DP2 = "dp2";

// ---------------------------------------------------------------------------
// CSV parsing — handles CRLF, no-trailing-newline, trailing-comma rows
// ---------------------------------------------------------------------------
export function parseCSV(filepath) {
  const raw = readFileSync(filepath, "utf8");
  const rows = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    rows.push(trimmed.split(",").map((c) => c.trim()));
  }
  return rows;
}

const normLevel = (raw) => (raw ?? "").trim() || "none";
const normGI = (raw) => {
  const s = (raw ?? "").trim();
  return s === "" ? 0 : parseInt(s, 10);
};
// Hours: an empty/absent field defaults to 4; an explicit value (including 0) is
// preserved. A merge-child taught only within the merged parent session may carry 0.
const normHours = (raw) => {
  const s = (raw ?? "").trim();
  if (s === "") return 4;
  const parsed = parseInt(s, 10);
  return Number.isNaN(parsed) ? 4 : parsed;
};
const ckey = (name, level, gi) => `${name}\x00${level}\x00${gi}`;
const lkey = (name, level) => `${name}\x00${level}`;

// ---------------------------------------------------------------------------
// Build course catalog + resolve student choices for one cohort
// ---------------------------------------------------------------------------
export function buildCohort(label, studentsFile, teachersFile) {
  const teacherRows = parseCSV(teachersFile);
  const studentRows = parseCSV(studentsFile);

  // catalog: ckey → { name, level, group_index, hours_per_week, teacher_codes }
  // teacher_codes is the co-teaching SET of teacher codes that drives course_teachers.
  const catalog = new Map();

  // 1. Teacher-sourced courses (authoritative — have codes + hours). Multiple teacher rows
  // sharing a course key are co-teachers: the first sets the meta, each adds to the teacher set.
  for (const cols of teacherRows) {
    const code = cols[0],
      name = cols[1];
    const level = normLevel(cols[2]);
    const gi = normGI(cols[3]);
    const hours = normHours(cols[4]);
    const k = ckey(name, level, gi);
    const existing = catalog.get(k);
    if (existing) existing.teacher_codes.add(code);
    else catalog.set(k, { name, level, group_index: gi, hours_per_week: hours, teacher_codes: new Set([code]) });
  }

  // 2. Index (name, level) → existing group_indices for single-group back-fill
  const levelGIs = new Map();
  for (const [, c] of catalog) {
    const lk = lkey(c.name, c.level);
    if (!levelGIs.has(lk)) levelGIs.set(lk, []);
    levelGIs.get(lk).push(c.group_index);
  }

  // choiceResolution: student's ckey → resolved ckey in catalog
  const choiceResolution = new Map();

  // 3. Student-sourced courses with back-fill for single-group disambiguation
  for (const cols of studentRows) {
    const name = cols[1],
      level = normLevel(cols[2]);
    const gi = normGI(cols[3]);
    const k = ckey(name, level, gi);
    const lk = lkey(name, level);

    if (catalog.has(k)) {
      choiceResolution.set(k, k);
      continue;
    }

    if (gi === 0) {
      const existing = levelGIs.get(lk) ?? [];
      if (existing.length === 1 && existing[0] > 0) {
        // Single group, unambiguous — back-fill
        const resolvedKey = ckey(name, level, existing[0]);
        choiceResolution.set(k, resolvedKey);
        process.stderr.write(
          `[WARN] ${label}: student choice (${name}, ${level}, gi=0) → back-filled to gi=${existing[0]}\n`,
        );
        continue;
      } else if (existing.length > 1) {
        // Multiple groups, gi=0 is ambiguous
        throw new Error(
          `Ambiguous group in ${label}: student picks (${name}, ${level}) without a group index, but multiple groups exist: [${existing.join(", ")}]. Back-fill the group index in the fixture.`,
        );
      }
      // gi=0, no existing teacher course → new student-only course
    }
    // New course (student-only or explicit non-zero gi not in teacher list)
    catalog.set(k, { name, level, group_index: gi, hours_per_week: 4, teacher_codes: new Set() });
    if (!levelGIs.has(lk)) levelGIs.set(lk, []);
    levelGIs.get(lk).push(gi);
    choiceResolution.set(k, k);
  }

  return { catalog, studentRows, choiceResolution };
}

// ---------------------------------------------------------------------------
// Enrich catalog with merge-parent/child and overlap courses
// ---------------------------------------------------------------------------
export function enrichFromMergesAndOverlaps(catalog, overlapRows, mergeRows, label) {
  // Merge: cols[0..3] = parent_name, parent_level, child_name, child_level
  for (const cols of mergeRows) {
    for (const [name, level] of [
      [cols[0], normLevel(cols[1])],
      [cols[2], normLevel(cols[3])],
    ]) {
      const k = ckey(name, level, 0);
      if (!catalog.has(k)) catalog.set(k, { name, level, group_index: 0, hours_per_week: 4, teacher_codes: new Set() });
    }
  }
  // Overlap: cols[0..2] = base_name, base_level, base_gi; cols[3..5] = dep_name, dep_level, dep_gi
  for (const cols of overlapRows) {
    const baseName = cols[0],
      baseLevel = normLevel(cols[1]),
      baseGI = normGI(cols[2]);
    const depName = cols[3],
      depLevel = normLevel(cols[4]),
      depGI = normGI(cols[5]);
    for (const [name, level, gi] of [
      [baseName, baseLevel, baseGI],
      [depName, depLevel, depGI],
    ]) {
      const k = ckey(name, level, gi);
      if (!catalog.has(k))
        catalog.set(k, { name, level, group_index: gi, hours_per_week: 4, teacher_codes: new Set() });
    }
  }

  // Phantom guard after enrichment
  const nlMap = new Map();
  for (const [, c] of catalog) {
    const lk = lkey(c.name, c.level);
    if (!nlMap.has(lk)) nlMap.set(lk, new Set());
    nlMap.get(lk).add(c.group_index);
  }
  const phantoms = [];
  for (const [lk, gis] of nlMap) {
    const arr = [...gis];
    if (arr.includes(0) && arr.some((g) => g > 0)) {
      const [name, level] = lk.split("\x00");
      phantoms.push(`  ${label}: ${name} (${level}) group_indices=[${arr.sort((a, b) => a - b).join(", ")}]`);
    }
  }
  if (phantoms.length > 0) {
    throw new Error(`Phantom-course guard triggered:\n${phantoms.join("\n")}\nFix fixture data and regenerate.`);
  }
}

// ---------------------------------------------------------------------------
// Verify every student choice resolves to a catalog course
// ---------------------------------------------------------------------------
export function verifyChoices(studentRows, catalog, choiceResolution, label) {
  for (const cols of studentRows) {
    const name = cols[1],
      level = normLevel(cols[2]);
    const gi = normGI(cols[3]);
    const k = ckey(name, level, gi);
    const resolved = choiceResolution.get(k) ?? k;
    if (!catalog.has(resolved)) {
      throw new Error(
        `Student choice resolution failed in ${label}: (${name}, ${level}, gi=${gi}) → ${resolved} not in catalog.`,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Load + validate both cohorts once. Reusable across multiple buildPlanRows
// passes (the catalog/choiceResolution are read-only after enrichment).
// ---------------------------------------------------------------------------
export function loadCohortFixtures() {
  const dp1Data = buildCohort("Year 1 (dp1)", dp1("students_subjects.csv"), dp1("teachers_subjects.csv"));
  const dp2Data = buildCohort("Year 2 (dp2)", dp2("students_subjects.csv"), dp2("teachers_subjects.csv"));

  const fixtures = {
    dp1Overlaps: parseCSV(dp1("subjects_overlap.csv")),
    dp1Merges: parseCSV(dp1("merge_subjects.csv")),
    dp2Overlaps: parseCSV(dp2("subjects_overlap.csv")),
    dp2Merges: parseCSV(dp2("merge_subjects.csv")),
  };

  enrichFromMergesAndOverlaps(dp1Data.catalog, fixtures.dp1Overlaps, fixtures.dp1Merges, "Year 1 (dp1)");
  enrichFromMergesAndOverlaps(dp2Data.catalog, fixtures.dp2Overlaps, fixtures.dp2Merges, "Year 2 (dp2)");
  verifyChoices(dp1Data.studentRows, dp1Data.catalog, dp1Data.choiceResolution, "Year 1 (dp1)");
  verifyChoices(dp2Data.studentRows, dp2Data.catalog, dp2Data.choiceResolution, "Year 2 (dp2)");

  return { dp1Data, dp2Data, fixtures };
}

// ---------------------------------------------------------------------------
// Per-plan row building — fresh UUIDs every pass, composite FKs remapped.
// Returns RAW rows (no SQL quoting). randomUUID() call order matches the legacy
// emitPlan exactly: plan → teachers → courses dp1/dp2 → students dp1/dp2 →
// overlaps → merges → choices — so serialized output stays byte-identical.
// ---------------------------------------------------------------------------
function buildOverlaps(overlapRows, courseIds, catalog, planId) {
  const rows = [];
  const seen = new Set();
  for (const cols of overlapRows) {
    const baseName = cols[0],
      baseLevel = normLevel(cols[1]),
      baseGI = normGI(cols[2]);
    const depName = cols[3],
      depLevel = normLevel(cols[4]),
      depGI = normGI(cols[5]);
    const baseKey = ckey(baseName, baseLevel, baseGI);
    const depKey = ckey(depName, depLevel, depGI);
    if (!catalog.has(baseKey)) throw new Error(`Overlap base course not found: ${baseKey}`);
    if (!catalog.has(depKey)) throw new Error(`Overlap dep course not found: ${depKey}`);
    const pairKey = `${baseKey}||${depKey}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    rows.push({
      id: randomUUID(),
      plan_id: planId,
      base_course_id: courseIds.get(baseKey),
      dependent_course_id: courseIds.get(depKey),
    });
  }
  return rows;
}

function buildMerges(mergeRows, courseIds, catalog, planId) {
  const rows = [];
  const seen = new Set();
  for (const cols of mergeRows) {
    const parentName = cols[0],
      parentLevel = normLevel(cols[1]);
    const childName = cols[2],
      childLevel = normLevel(cols[3]);
    const parentKey = ckey(parentName, parentLevel, 0);
    const childKey = ckey(childName, childLevel, 0);
    if (!catalog.has(parentKey)) throw new Error(`Merge parent not found: ${parentKey}`);
    if (!catalog.has(childKey)) throw new Error(`Merge child not found: ${childKey}`);
    const pairKey = `${parentKey}||${childKey}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    rows.push({
      id: randomUUID(),
      plan_id: planId,
      parent_course_id: courseIds.get(parentKey),
      child_course_id: courseIds.get(childKey),
    });
  }
  return rows;
}

// One course_teachers junction row per (course, co-teacher). Mirrors buildMerges/buildOverlaps;
// reads each course's accumulated teacher_codes SET (so co-taught courses emit ≥2 rows). A
// teacher_code with no remapped teacher is a data inconsistency — fail loud, like the others.
function buildCourseTeachers(catalog, courseIds, teacherMap, planId) {
  const rows = [];
  for (const [k, c] of catalog) {
    const courseId = courseIds.get(k);
    for (const code of c.teacher_codes) {
      const teacherId = teacherMap.get(code);
      if (!teacherId) throw new Error(`Course teacher not found: ${code} for course ${k}`);
      rows.push({ id: randomUUID(), plan_id: planId, course_id: courseId, teacher_id: teacherId });
    }
  }
  return rows;
}

function buildChoices(studentRows, studentIds, courseIds, choiceResolution, catalog, planId) {
  const rows = [];
  const seen = new Set();
  for (const cols of studentRows) {
    const studentName = cols[0],
      name = cols[1];
    const level = normLevel(cols[2]),
      gi = normGI(cols[3]);
    const k = ckey(name, level, gi);
    const resolvedKey = choiceResolution.get(k) ?? k;
    if (!catalog.has(resolvedKey)) throw new Error(`Choice resolution missing for: ${resolvedKey}`);
    const studentId = studentIds.get(studentName);
    const courseId = courseIds.get(resolvedKey);
    const pairKey = `${studentId}||${courseId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    rows.push({ id: randomUUID(), plan_id: planId, student_id: studentId, course_id: courseId });
  }
  return rows;
}

// Builds every catalog row for one plan, keyed (directly or denormalized) to a
// fresh plan UUID. Returns the raw row collections + per-cohort stats.
export function buildPlanRows(planName, dp1Data, dp2Data, fixtures) {
  const planId = randomUUID();

  // Deduplicate teachers across both cohorts by code (within this plan). Drawn from each
  // course's full teacher SET, so a teacher who only ever co-teaches is still registered.
  const teacherMap = new Map(); // code → uuid
  for (const cohortData of [dp1Data, dp2Data]) {
    for (const [, c] of cohortData.catalog) {
      for (const code of c.teacher_codes) {
        if (!teacherMap.has(code)) teacherMap.set(code, randomUUID());
      }
    }
  }

  // Course IDs per cohort
  const courseId1 = new Map(); // ckey → uuid (Year 1)
  const courseId2 = new Map(); // ckey → uuid (Year 2)
  for (const [k] of dp1Data.catalog) courseId1.set(k, randomUUID());
  for (const [k] of dp2Data.catalog) courseId2.set(k, randomUUID());

  // Student IDs per cohort
  const studentId1 = new Map(); // name → uuid
  const studentId2 = new Map();
  for (const cols of dp1Data.studentRows) {
    const name = cols[0];
    if (!studentId1.has(name)) studentId1.set(name, randomUUID());
  }
  for (const cols of dp2Data.studentRows) {
    const name = cols[0];
    if (!studentId2.has(name)) studentId2.set(name, randomUUID());
  }

  const plans = [{ id: planId, name: planName, slot_grid_preset: "5x10" }];

  // teachers — sorted by code (stable, matches legacy emission)
  const teachers = [...teacherMap.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([code, id]) => ({ id, plan_id: planId, code }));

  // courses — Year 1 then Year 2. Teachers live in course_teachers (built below), not on
  // the course row (the legacy courses.teacher_id column was dropped).
  const buildCourses = (catalog, courseIds, cohort) => {
    const rows = [];
    for (const [k, c] of catalog) {
      rows.push({
        id: courseIds.get(k),
        plan_id: planId,
        cohort,
        name: c.name,
        level: c.level,
        group_index: c.group_index,
        hours_per_week: c.hours_per_week,
      });
    }
    return rows;
  };
  const courses = [
    ...buildCourses(dp1Data.catalog, courseId1, COHORT_DP1),
    ...buildCourses(dp2Data.catalog, courseId2, COHORT_DP2),
  ];

  const overlapRows1 = buildOverlaps(fixtures.dp1Overlaps, courseId1, dp1Data.catalog, planId);
  const overlapRows2 = buildOverlaps(fixtures.dp2Overlaps, courseId2, dp2Data.catalog, planId);
  const course_overlaps = [...overlapRows1, ...overlapRows2];

  const mergeRows1 = buildMerges(fixtures.dp1Merges, courseId1, dp1Data.catalog, planId);
  const mergeRows2 = buildMerges(fixtures.dp2Merges, courseId2, dp2Data.catalog, planId);
  const course_merges = [...mergeRows1, ...mergeRows2];

  const courseTeacherRows1 = buildCourseTeachers(dp1Data.catalog, courseId1, teacherMap, planId);
  const courseTeacherRows2 = buildCourseTeachers(dp2Data.catalog, courseId2, teacherMap, planId);
  const course_teachers = [...courseTeacherRows1, ...courseTeacherRows2];

  const students = [
    ...[...studentId1.entries()].map(([name, id]) => ({ id, plan_id: planId, cohort: COHORT_DP1, full_name: name })),
    ...[...studentId2.entries()].map(([name, id]) => ({ id, plan_id: planId, cohort: COHORT_DP2, full_name: name })),
  ];

  const choices1 = buildChoices(
    dp1Data.studentRows,
    studentId1,
    courseId1,
    dp1Data.choiceResolution,
    dp1Data.catalog,
    planId,
  );
  const choices2 = buildChoices(
    dp2Data.studentRows,
    studentId2,
    courseId2,
    dp2Data.choiceResolution,
    dp2Data.catalog,
    planId,
  );
  const student_choices = [...choices1, ...choices2];

  const stats = {
    teachers: teacherMap.size,
    coursesY1: dp1Data.catalog.size,
    coursesY2: dp2Data.catalog.size,
    studentsY1: studentId1.size,
    studentsY2: studentId2.size,
    choicesY1: choices1.length,
    choicesY2: choices2.length,
    overlapsY1: overlapRows1.length,
    overlapsY2: overlapRows2.length,
    mergesY1: mergeRows1.length,
    mergesY2: mergeRows2.length,
    courseTeachersY1: courseTeacherRows1.length,
    courseTeachersY2: courseTeacherRows2.length,
  };

  return {
    rows: { plans, teachers, courses, course_overlaps, course_merges, course_teachers, students, student_choices },
    stats,
  };
}
