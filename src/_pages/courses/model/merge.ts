/**
 * Single source of truth for merge derivation + validation. Consumed by both the
 * builder dialog's live preview and the `createMerge` action's server-side gate, so
 * the previewed parent and the stored parent can never drift.
 *
 * Identity stays as opaque ids; the composite `level` is a derived display token.
 * Pure — no DB, no React.
 */

import type { Cohort } from "@/shared/config";

/** Minimal child projection the derivation needs. A projection of `CourseRow`. */
export type MergeChildInput = {
  id: string;
  name: string;
  level: string;
  cohort: Cohort;
  teacherIds: string[];
};

/** The derived composite-parent spec. `cohort`/`teacherIds` are validated across children. */
export type MergeParentSpec = {
  name: string;
  level: string;
  teacherIds: string[];
  cohort: Cohort;
};

/** Why a candidate merge is invalid — an opaque token; map to display via `mergeReasonMessage`. */
export type MergeFailureReason =
  | "too-few-children"
  | "mixed-cohorts"
  | "mismatched-name"
  | "missing-teacher"
  | "mismatched-teacher"
  | "duplicate-levels";

/** Discriminated result: a derived parent spec or a named failure. */
export type MergeDerivation = { ok: true; parent: MergeParentSpec } | { ok: false; reason: MergeFailureReason };

/**
 * Validate a candidate merge and derive its composite parent. Rules, in order:
 * ≥2 children, single shared cohort, exact-equal shared name, an identical non-empty
 * teacher *set* shared by every child, and distinct levels. On success the composite
 * `level` joins the distinct child levels in IB order (`AB, SL, HL`) with any others
 * appended in input order, so `AB+SL` is produced regardless of selection order.
 */
export const deriveMergeParent = (children: MergeChildInput[]): MergeDerivation => {
  if (children.length < 2) return { ok: false, reason: "too-few-children" };

  const cohort = children[0].cohort;
  if (children.some((child) => child.cohort !== cohort)) return { ok: false, reason: "mixed-cohorts" };

  const name = children[0].name;
  if (children.some((child) => child.name !== name)) return { ok: false, reason: "mismatched-name" };

  const teacherIds = children[0].teacherIds;
  if (children.some((child) => child.teacherIds.length === 0)) return { ok: false, reason: "missing-teacher" };
  if (children.some((child) => !sameTeacherSet(child.teacherIds, teacherIds)))
    return { ok: false, reason: "mismatched-teacher" };

  const levels = children.map((child) => child.level);
  if (new Set(levels).size !== levels.length) return { ok: false, reason: "duplicate-levels" };

  // Every child shares the same non-empty set; carry it (deduped) onto the parent.
  return { ok: true, parent: { name, level: compositeLevel(levels), teacherIds: [...new Set(teacherIds)], cohort } };
};

/** Set equality over teacher ids (order-independent). */
const sameTeacherSet = (a: string[], b: string[]): boolean => {
  const bSet = new Set(b);
  return a.length === b.length && a.every((id) => bSet.has(id));
};

/** Human-readable rendering of a failure reason, for inline form errors and action messages. */
export const mergeReasonMessage = (reason: MergeFailureReason): string => MERGE_REASON_MESSAGES[reason];

const MERGE_REASON_MESSAGES: Record<MergeFailureReason, string> = {
  "too-few-children": "Select at least 2 courses to merge.",
  "mixed-cohorts": "All merged courses must belong to the same cohort.",
  "mismatched-name": "All merged courses must share the same name.",
  "missing-teacher": "Every merged course must have a teacher.",
  "mismatched-teacher": "All merged courses must share the same teacher.",
  "duplicate-levels": "Merged courses must have distinct levels.",
};

const IB_LEVEL_ORDER = ["AB", "SL", "HL"] as const;

/**
 * Join distinct levels with `+` in IB order (`AB, SL, HL`), appending any
 * non-IB levels in input order. Order-independent for IB levels; deterministic
 * for the rest. Caller guarantees the input contains no duplicates.
 */
const compositeLevel = (levels: string[]): string => {
  const ibLevels = IB_LEVEL_ORDER.filter((level) => levels.includes(level));
  const otherLevels = levels.filter((level) => !IB_LEVEL_ORDER.includes(level as (typeof IB_LEVEL_ORDER)[number]));
  return [...ibLevels, ...otherLevels].join("+");
};
