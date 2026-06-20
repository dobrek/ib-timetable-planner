#!/usr/bin/env node
// Generates supabase/seed.sql from data/dp1/ and data/dp2/ CSV fixtures.
// Usage: node scripts/gen-seed.mjs > supabase/seed.sql
//
// Plan-first generation: the catalog is plan-owned, so every insert threads a
// plan_id (including the denormalized link-table columns). Two plans are seeded
// by running the same insert pipeline twice with fresh UUIDs per pass, so
// composite-FK remapping bugs fail loudly here instead of hiding in copied rows.
//
// The CSV → row transcode (and the composite-FK remap) lives in the shared
// scripts/lib/catalog-transcode.mjs module, consumed by both this script and the
// test factory. This file keeps ONLY SQL serialization over the rows the module
// returns, so the remap is single-sourced and guarded by the byte-identical check.
import { loadCohortFixtures, buildPlanRows } from "./lib/catalog-transcode.mjs";

// ---------------------------------------------------------------------------
// SQL helpers
// ---------------------------------------------------------------------------
const esc = (s) => String(s).replace(/'/g, "''");
const q = (s) => `'${esc(s)}'`;
const NULL = "NULL";
const qOrNull = (v) => (v == null || v === "" ? NULL : q(v));

function inserts(table, cols, rows) {
  if (rows.length === 0) return "";
  const colList = cols.join(", ");
  const vals = rows.map((r) => `  (${r.join(", ")})`).join(",\n");
  return `INSERT INTO ${table} (${colList}) VALUES\n${vals};\n`;
}

// ---------------------------------------------------------------------------
// Serialize one plan's raw rows to SQL — column order is the serialization
// concern that stays here; values come pre-remapped from the transcode module.
// ---------------------------------------------------------------------------
function serializePlan(planName, rows) {
  const sql = [];
  sql.push(`-- Plan: ${planName}`);

  sql.push(
    inserts(
      "plans",
      ["id", "name", "slot_grid_preset"],
      rows.plans.map((r) => [q(r.id), q(r.name), q(r.slot_grid_preset)]),
    ),
  );

  sql.push(
    inserts(
      "teachers",
      ["id", "plan_id", "code"],
      rows.teachers.map((r) => [q(r.id), q(r.plan_id), q(r.code)]),
    ),
  );

  sql.push(
    inserts(
      "courses",
      ["id", "plan_id", "cohort", "teacher_id", "name", "level", "group_index", "hours_per_week"],
      rows.courses.map((r) => [
        q(r.id),
        q(r.plan_id),
        q(r.cohort),
        qOrNull(r.teacher_id),
        q(r.name),
        q(r.level),
        r.group_index,
        r.hours_per_week,
      ]),
    ),
  );

  if (rows.course_overlaps.length > 0) {
    sql.push(
      inserts(
        "course_overlaps",
        ["id", "plan_id", "base_course_id", "dependent_course_id"],
        rows.course_overlaps.map((r) => [q(r.id), q(r.plan_id), q(r.base_course_id), q(r.dependent_course_id)]),
      ),
    );
  }

  if (rows.course_merges.length > 0) {
    sql.push(
      inserts(
        "course_merges",
        ["id", "plan_id", "parent_course_id", "child_course_id"],
        rows.course_merges.map((r) => [q(r.id), q(r.plan_id), q(r.parent_course_id), q(r.child_course_id)]),
      ),
    );
  }

  // course_teachers — the single source of each course's teacher set. Serialized after
  // courses + teachers (its composite-FK targets). Mirrors the course_merges block.
  if (rows.course_teachers.length > 0) {
    sql.push(
      inserts(
        "course_teachers",
        ["id", "plan_id", "course_id", "teacher_id"],
        rows.course_teachers.map((r) => [q(r.id), q(r.plan_id), q(r.course_id), q(r.teacher_id)]),
      ),
    );
  }

  sql.push(
    inserts(
      "students",
      ["id", "plan_id", "cohort", "full_name"],
      rows.students.map((r) => [q(r.id), q(r.plan_id), q(r.cohort), q(r.full_name)]),
    ),
  );

  sql.push(
    inserts(
      "student_choices",
      ["id", "plan_id", "student_id", "course_id"],
      rows.student_choices.map((r) => [q(r.id), q(r.plan_id), q(r.student_id), q(r.course_id)]),
    ),
  );

  return sql;
}

// ≥1-teacher invariant (decision 3): a course with no course_teachers row would render
// teacher-less and silently lose double-booking + availability detection. Fail loud here,
// joining the transcoder's other data-consistency aborts, rather than bake a broken seed.
function assertEveryCourseHasTeacher(planName, rows) {
  const withTeacher = new Set(rows.course_teachers.map((r) => r.course_id));
  const orphans = rows.courses.filter((c) => !withTeacher.has(c.id));
  if (orphans.length > 0) {
    const names = orphans.map((c) => `${c.name} (${c.level}, gi=${c.group_index})`).join(", ");
    throw new Error(
      `Seed abort — ${planName}: ${orphans.length} course(s) resolved to zero teachers: ${names}. ` +
        `Every course must have at least one teacher (add a teachers_subjects.csv row).`,
    );
  }
}

function printStats(planName, stats) {
  process.stderr.write(`\nSeed stats — ${planName}:\n`);
  process.stderr.write(`  Teachers:        ${stats.teachers}\n`);
  process.stderr.write(`  Courses (Y1):    ${stats.coursesY1}\n`);
  process.stderr.write(`  Courses (Y2):    ${stats.coursesY2}\n`);
  process.stderr.write(`  Students (Y1):   ${stats.studentsY1}\n`);
  process.stderr.write(`  Students (Y2):   ${stats.studentsY2}\n`);
  process.stderr.write(`  Choices (Y1):    ${stats.choicesY1}\n`);
  process.stderr.write(`  Choices (Y2):    ${stats.choicesY2}\n`);
  process.stderr.write(`  Overlaps (Y1):   ${stats.overlapsY1}\n`);
  process.stderr.write(`  Overlaps (Y2):   ${stats.overlapsY2}\n`);
  process.stderr.write(`  Merges (Y1):     ${stats.mergesY1}\n`);
  process.stderr.write(`  Merges (Y2):     ${stats.mergesY2}\n`);
  process.stderr.write(`  CourseTeach (Y1):${stats.courseTeachersY1}\n`);
  process.stderr.write(`  CourseTeach (Y2):${stats.courseTeachersY2}\n`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

// Build + validate cohort data once; emission runs per plan with fresh UUIDs.
const { dp1Data, dp2Data, fixtures } = loadCohortFixtures();

const out = [];
out.push("-- Generated by scripts/gen-seed.mjs — do not edit by hand.");
out.push("-- Re-generate with: node scripts/gen-seed.mjs > supabase/seed.sql\n");

const PLAN_NAMES = ["Seed Plan A", "Seed Plan B"];
for (const planName of PLAN_NAMES) {
  const { rows, stats } = buildPlanRows(planName, dp1Data, dp2Data, fixtures);
  assertEveryCourseHasTeacher(planName, rows);
  out.push(...serializePlan(planName, rows));
  printStats(planName, stats);
}

process.stdout.write(out.join("\n"));
