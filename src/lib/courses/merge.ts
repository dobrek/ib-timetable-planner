/**
 * Single source of truth for merge derivation + validation. Consumed by both the
 * builder dialog's live preview and the `createMerge` action's server-side gate, so
 * the previewed parent and the stored parent can never drift.
 *
 * Identity stays as opaque ids; the composite `level` is a derived display token
 * (lessons: "identity as tokens, display at edges"). Pure — no DB, no React.
 */

/** Minimal child projection the derivation needs. A projection of `CourseRow`. */
export type MergeChildInput = {
  id: string;
  name: string;
  level: string;
  cohortId: string;
  teacherId: string | null;
};

/** The derived composite-parent spec. `cohortId`/`teacherId` are validated across children. */
export type MergeParentSpec = {
  name: string;
  level: string;
  teacherId: string;
  cohortId: string;
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
 * ≥2 children, single shared cohort, exact-equal shared name, single shared
 * (non-null) teacher, and distinct levels. On success the composite `level` joins
 * the distinct child levels in IB order (`AB, SL, HL`) with any others appended in
 * input order, so `AB+SL` is produced regardless of selection order.
 */
export const deriveMergeParent = (children: MergeChildInput[]): MergeDerivation => {
  if (children.length < 2) return { ok: false, reason: "too-few-children" };

  const cohortId = children[0].cohortId;
  if (children.some((child) => child.cohortId !== cohortId)) return { ok: false, reason: "mixed-cohorts" };

  const name = children[0].name;
  if (children.some((child) => child.name !== name)) return { ok: false, reason: "mismatched-name" };

  const teacherId = children[0].teacherId;
  if (teacherId === null || children.some((child) => child.teacherId === null))
    return { ok: false, reason: "missing-teacher" };
  if (children.some((child) => child.teacherId !== teacherId)) return { ok: false, reason: "mismatched-teacher" };

  const levels = children.map((child) => child.level);
  if (new Set(levels).size !== levels.length) return { ok: false, reason: "duplicate-levels" };

  // teacherId is narrowed to a non-null string by the missing-teacher guard above.
  return { ok: true, parent: { name, level: compositeLevel(levels), teacherId, cohortId } };
};

/** Human-readable rendering of a failure reason, for inline form errors and action messages. */
export const mergeReasonMessage = (reason: MergeFailureReason): string => MERGE_REASON_MESSAGES[reason];

/** The injected write operations for `writeMergeAtomic`. `T` is the inserted parent (carries its id). */
export type WriteMergeAtomicOps<T extends { id: string }> = {
  insertParent: () => Promise<T>;
  insertLinks: (parent: T) => Promise<void>;
  deleteParent: (parent: T) => Promise<void>;
};

/**
 * Two-step merge write with compensating cleanup. workerd + supabase-js can't run a
 * client-side transaction and "no migration" rules out a Postgres function, so atomicity
 * lives here: insert the parent, then the links — and if the link insert fails, delete the
 * just-created parent so no orphan parent lingers. The DB operations are injected so the
 * cleanup path is a CI-gated unit test rather than an un-triggerable manual step.
 */
export const writeMergeAtomic = async <T extends { id: string }>(ops: WriteMergeAtomicOps<T>): Promise<T> => {
  const parent = await ops.insertParent();
  try {
    await ops.insertLinks(parent);
  } catch (error) {
    await ops.deleteParent(parent);
    throw error;
  }
  return parent;
};

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
