import type { PlacementWeek } from "@/shared/config";
import type { GroupingCourse } from "@/shared/lib/catalog-hash";
import type { WeekLane } from "../../analysis/lanes";
import type { DayOccupancyIndex } from "../../day-occupancy-index";

/**
 * Structured collision explanation. Ids stay opaque (uuids) — display names are
 * resolved at the render edge via the island's name records, never baked in here.
 *
 * The two day-scoped kinds both carry `courseIds` (never a bare `courseId`), so the three
 * generic consumers that walk `violation.courseIds` for every non-`duplicate-course` kind
 * (`collectIdsBySeverity`, teacher-perspective `citedCourseIds`, the exhaustive dialog
 * `groupByKind`) handle them without change. `early-finish-edge` puts the single flagged id in
 * a one-tuple and carries the affected `studentKeys` for the dialog.
 */
export type CollisionViolation =
  | { kind: "duplicate-course"; courseId: string }
  | { kind: "teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "student"; studentKeys: string[]; courseIds: [string, string] }
  | { kind: "teacher-unavailable"; teacherKey: string; courseIds: string[]; severity: "block" | "warn" }
  | { kind: "cross-cohort-teacher"; teacherKey: string; courseIds: string[] }
  | { kind: "early-finish-edge"; courseIds: [string]; studentKeys: string[] }
  | { kind: "course-day-stacking"; courseIds: string[]; count: number; lanes: WeekLane[] }
  | { kind: "course-day-split"; courseIds: string[]; periods: number[]; lanes: WeekLane[] }
  | {
      kind: "teacher-day-shape";
      teacherKey: string;
      courseIds: string[];
      span: number;
      maxStreak: number;
      /** Every week lane of that teacher-day that breaches. `verifyGeneration` compares these
       *  lane-by-lane against the pins-only board to tell a generator-created breach from one the
       *  author pinned — a `(teacher, day)` reading cannot make that distinction. */
      lanes: WeekLane[];
    };

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
  /** Course ids flagged `finishes_early` — the edge rule fires only for these. Delivered as a
   *  side-set (never a `GroupingCourse` field, to keep the catalog hash stable); absent/empty ⇒
   *  the edge rule stays dormant. */
  finishesEarlyByCourseId?: Set<string>;
  /** Week-aware per-day board view (per-student and per-course), built once per derivation.
   *  Both day-scoped constraints read it; absent ⇒ their regression path (return `[]`). */
  dayOccupancy?: DayOccupancyIndex;
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
