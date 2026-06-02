#!/usr/bin/env node
// Generates supabase/seed.sql from data/dp1/ and data/dp2/ CSV fixtures.
// Usage: node scripts/gen-seed.mjs > supabase/seed.sql
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dp1 = (...p) => resolve(ROOT, "data", "dp1", ...p);
const dp2 = (...p) => resolve(ROOT, "data", "dp2", ...p);

// ---------------------------------------------------------------------------
// CSV parsing — handles CRLF, no-trailing-newline, trailing-comma rows
// ---------------------------------------------------------------------------
function parseCSV(filepath) {
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
const esc = (s) => String(s).replace(/'/g, "''");
const q = (s) => `'${esc(s)}'`;
const ckey = (name, level, gi) => `${name}\x00${level}\x00${gi}`;
const lkey = (name, level) => `${name}\x00${level}`;

// ---------------------------------------------------------------------------
// Build course catalog + resolve student choices for one cohort
// ---------------------------------------------------------------------------
function buildCohort(label, studentsFile, teachersFile) {
  const teacherRows = parseCSV(teachersFile);
  const studentRows = parseCSV(studentsFile);

  // catalog: ckey → { name, level, group_index, hours_per_week, teacher_code }
  const catalog = new Map();

  // 1. Teacher-sourced courses (authoritative — have codes + hours)
  for (const cols of teacherRows) {
    const code = cols[0],
      name = cols[1];
    const level = normLevel(cols[2]);
    const gi = normGI(cols[3]);
    const hours = normHours(cols[4]);
    const k = ckey(name, level, gi);
    if (!catalog.has(k)) catalog.set(k, { name, level, group_index: gi, hours_per_week: hours, teacher_code: code });
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
    catalog.set(k, { name, level, group_index: gi, hours_per_week: 4, teacher_code: null });
    if (!levelGIs.has(lk)) levelGIs.set(lk, []);
    levelGIs.get(lk).push(gi);
    choiceResolution.set(k, k);
  }

  return { catalog, studentRows, choiceResolution };
}

// ---------------------------------------------------------------------------
// Enrich catalog with merge-parent/child and overlap courses
// ---------------------------------------------------------------------------
function enrichFromMergesAndOverlaps(catalog, overlapRows, mergeRows, label) {
  // Merge: cols[0..3] = parent_name, parent_level, child_name, child_level
  for (const cols of mergeRows) {
    for (const [name, level] of [
      [cols[0], normLevel(cols[1])],
      [cols[2], normLevel(cols[3])],
    ]) {
      const k = ckey(name, level, 0);
      if (!catalog.has(k)) catalog.set(k, { name, level, group_index: 0, hours_per_week: 4, teacher_code: null });
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
      if (!catalog.has(k)) catalog.set(k, { name, level, group_index: gi, hours_per_week: 4, teacher_code: null });
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
function verifyChoices(studentRows, catalog, choiceResolution, label) {
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
// SQL helpers
// ---------------------------------------------------------------------------
const NULL = "NULL";
const qOrNull = (v) => (v == null || v === "" ? NULL : q(v));

function inserts(table, cols, rows) {
  if (rows.length === 0) return "";
  const colList = cols.join(", ");
  const vals = rows.map((r) => `  (${r.join(", ")})`).join(",\n");
  return `INSERT INTO ${table} (${colList}) VALUES\n${vals};\n`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Build cohort data
const dp1Data = buildCohort("Year 1 (dp1)", dp1("students_subjects.csv"), dp1("teachers_subjects.csv"));
const dp2Data = buildCohort("Year 2 (dp2)", dp2("students_subjects.csv"), dp2("teachers_subjects.csv"));

const dp1Overlaps = parseCSV(dp1("subjects_overlap.csv"));
const dp1Merges = parseCSV(dp1("merge_subjects.csv"));
const dp2Overlaps = parseCSV(dp2("subjects_overlap.csv"));
const dp2Merges = parseCSV(dp2("merge_subjects.csv"));

enrichFromMergesAndOverlaps(dp1Data.catalog, dp1Overlaps, dp1Merges, "Year 1 (dp1)");
enrichFromMergesAndOverlaps(dp2Data.catalog, dp2Overlaps, dp2Merges, "Year 2 (dp2)");
verifyChoices(dp1Data.studentRows, dp1Data.catalog, dp1Data.choiceResolution, "Year 1 (dp1)");
verifyChoices(dp2Data.studentRows, dp2Data.catalog, dp2Data.choiceResolution, "Year 2 (dp2)");

// ---------------------------------------------------------------------------
// Assign IDs
// ---------------------------------------------------------------------------
const cohort1Id = randomUUID();
const cohort2Id = randomUUID();

// Deduplicate teachers across both cohorts by code
const teacherMap = new Map(); // code → uuid
for (const cohortData of [dp1Data, dp2Data]) {
  for (const [, c] of cohortData.catalog) {
    if (c.teacher_code && !teacherMap.has(c.teacher_code)) {
      teacherMap.set(c.teacher_code, randomUUID());
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

const planId = randomUUID();
const variantId = randomUUID();

// ---------------------------------------------------------------------------
// Emit SQL
// ---------------------------------------------------------------------------
const out = [];
out.push("-- Generated by scripts/gen-seed.mjs — do not edit by hand.");
out.push("-- Re-generate with: node scripts/gen-seed.mjs > supabase/seed.sql\n");

// cohorts
out.push(
  inserts(
    "cohorts",
    ["id", "name"],
    [
      [q(cohort1Id), q("Diploma Programme Year 1")],
      [q(cohort2Id), q("Diploma Programme Year 2")],
    ],
  ),
);

// teachers
const teacherRows = [...teacherMap.entries()].sort((a, b) => a[0].localeCompare(b[0]));
out.push(
  inserts(
    "teachers",
    ["id", "code"],
    teacherRows.map(([code, id]) => [q(id), q(code)]),
  ),
);

// courses — Year 1 then Year 2
function emitCourses(catalog, courseIds, cohortId) {
  const rows = [];
  for (const [k, c] of catalog) {
    const id = courseIds.get(k);
    const teacherId = c.teacher_code ? qOrNull(teacherMap.get(c.teacher_code)) : NULL;
    rows.push([q(id), q(cohortId), teacherId, q(c.name), q(c.level), c.group_index, c.hours_per_week]);
  }
  return rows;
}
const courseRows = [
  ...emitCourses(dp1Data.catalog, courseId1, cohort1Id),
  ...emitCourses(dp2Data.catalog, courseId2, cohort2Id),
];
out.push(
  inserts("courses", ["id", "cohort_id", "teacher_id", "name", "level", "group_index", "hours_per_week"], courseRows),
);

// course_overlaps
function emitOverlaps(overlapRows, courseIds, catalog) {
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
    rows.push([q(randomUUID()), q(courseIds.get(baseKey)), q(courseIds.get(depKey))]);
  }
  return rows;
}
const overlapRows1 = emitOverlaps(dp1Overlaps, courseId1, dp1Data.catalog);
const overlapRows2 = emitOverlaps(dp2Overlaps, courseId2, dp2Data.catalog);
if (overlapRows1.length + overlapRows2.length > 0) {
  out.push(
    inserts("course_overlaps", ["id", "base_course_id", "dependent_course_id"], [...overlapRows1, ...overlapRows2]),
  );
}

// course_merges
function emitMerges(mergeRows, courseIds, catalog) {
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
    rows.push([q(randomUUID()), q(courseIds.get(parentKey)), q(courseIds.get(childKey))]);
  }
  return rows;
}
const mergeRows1 = emitMerges(dp1Merges, courseId1, dp1Data.catalog);
const mergeRows2 = emitMerges(dp2Merges, courseId2, dp2Data.catalog);
if (mergeRows1.length + mergeRows2.length > 0) {
  out.push(inserts("course_merges", ["id", "parent_course_id", "child_course_id"], [...mergeRows1, ...mergeRows2]));
}

// students
const studentRows1 = [...studentId1.entries()].map(([name, id]) => [q(id), q(cohort1Id), q(name)]);
const studentRows2 = [...studentId2.entries()].map(([name, id]) => [q(id), q(cohort2Id), q(name)]);
out.push(inserts("students", ["id", "cohort_id", "full_name"], [...studentRows1, ...studentRows2]));

// student_choices
function emitChoices(studentRows, studentIds, courseIds, choiceResolution, catalog) {
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
    rows.push([q(randomUUID()), q(studentId), q(courseId)]);
  }
  return rows;
}
const choices1 = emitChoices(dp1Data.studentRows, studentId1, courseId1, dp1Data.choiceResolution, dp1Data.catalog);
const choices2 = emitChoices(dp2Data.studentRows, studentId2, courseId2, dp2Data.choiceResolution, dp2Data.catalog);
out.push(inserts("student_choices", ["id", "student_id", "course_id"], [...choices1, ...choices2]));

// plans + plan_variants
out.push(inserts("plans", ["id", "name", "slot_grid_preset"], [[q(planId), q("Seed Plan"), q("5x8")]]));
out.push(
  inserts("plan_variants", ["id", "plan_id", "name", "is_final"], [[q(variantId), q(planId), q("Draft 1"), "false"]]),
);

// Stats to stderr so they don't pollute the SQL file
process.stderr.write(`\nSeed stats:\n`);
process.stderr.write(`  Cohorts:         2\n`);
process.stderr.write(`  Teachers:        ${teacherMap.size}\n`);
process.stderr.write(`  Courses (Y1):    ${dp1Data.catalog.size}\n`);
process.stderr.write(`  Courses (Y2):    ${dp2Data.catalog.size}\n`);
process.stderr.write(`  Students (Y1):   ${studentId1.size}\n`);
process.stderr.write(`  Students (Y2):   ${studentId2.size}\n`);
process.stderr.write(`  Choices (Y1):    ${choices1.length}\n`);
process.stderr.write(`  Choices (Y2):    ${choices2.length}\n`);
process.stderr.write(`  Overlaps (Y1):   ${overlapRows1.length}\n`);
process.stderr.write(`  Overlaps (Y2):   ${overlapRows2.length}\n`);
process.stderr.write(`  Merges (Y1):     ${mergeRows1.length}\n`);
process.stderr.write(`  Merges (Y2):     ${mergeRows2.length}\n`);

process.stdout.write(out.join("\n"));
