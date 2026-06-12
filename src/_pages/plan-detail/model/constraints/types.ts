import type { GroupingCourse } from "../grouping";

/**
 * Structured collision explanation. Ids stay opaque (uuids) — display names are
 * resolved at the render edge via the island's name records, never baked in here.
 */
export type CollisionViolation =
  | { kind: "duplicate-course"; courseId: string }
  | { kind: "teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "student"; studentKeys: string[]; courseIds: [string, string] };

/**
 * Inputs beyond the cell's occupants. Deliberately minimal — future board-only
 * constraints (cross-cohort occupancy, teacher availability) add optional fields
 * here additively, without touching existing evaluators.
 */
export type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
};

/** A self-contained cell constraint: one file per rule, registered in `index.ts`. */
export type CellConstraint = {
  id: string;
  /** Enumerates ALL violations among the cell's occupants (no short-circuit). */
  explain(occupants: GroupingCourse[], ctx: BoardContext): CollisionViolation[];
  /** Ctx-free pairwise fast path (short-circuit). Omit for board-only constraints —
   *  omitted constraints do not participate in grouping enumeration. */
  test?(course: GroupingCourse, others: GroupingCourse[]): boolean;
};
