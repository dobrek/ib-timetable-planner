import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "../../grouping/grouping";

/**
 * Structured collision explanation. Ids stay opaque (uuids) — display names are
 * resolved at the render edge via the island's name records, never baked in here.
 */
export type CollisionViolation =
  | { kind: "duplicate-course"; courseId: string }
  | { kind: "teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "student"; studentKeys: string[]; courseIds: [string, string] }
  | { kind: "teacher-unavailable"; teacherKey: string; courseIds: string[]; severity: "block" | "warn" }
  | { kind: "cross-cohort-teacher"; teacherKey: string; courseIds: string[] };

/**
 * Inputs beyond the cell's occupants. Deliberately minimal — board-only constraints
 * (cross-cohort occupancy, teacher availability) add optional fields here additively,
 * without touching existing evaluators. Teacher availability is keyed teacherKey →
 * set of `cellKey` (`${day}:${period}`); the constraint checks `ctx.cell` membership.
 */
export type BoardContext = {
  cell: { day: number; period: number };
  catalogById: Map<string, GroupingCourse>;
  /** Cells (by `cellKey`) each teacher CANNOT teach — strong NO → `block` violations. */
  strongUnavailableByTeacher?: Map<string, Set<string>>;
  /** Cells (by `cellKey`) each teacher PREFERS NOT to teach — soft NO → `warn` (Phase 4). */
  softUnavailableByTeacher?: Map<string, Set<string>>;
  /** Each occupant's placement week (courseId → week), within this cell. Absent ⇒ treat
   *  as `both` (every week). Drives the opposite-week relaxation in the conflict constraints. */
  weekByCourseId?: Map<string, PlacementWeek>;
  /** Cross-cohort occupancy: teacherKey → `cellKey` → set of weeks that teacher is occupied
   *  in the *other* cohort. Drives the board-only week-aware `cross-cohort-teacher` rule;
   *  absent ⇒ single-cohort regression path (no cross-cohort flagging). */
  occupiedByTeacher?: Map<string, Map<string, Set<PlacementWeek>>>;
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
