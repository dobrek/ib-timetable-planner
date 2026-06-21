import type { AvailabilityIndex } from "./availability-index";
import { bucketByCell, cellKey } from "./collisions";
import { violatesAny } from "./constraints";
import type { CellData, DragData } from "./drag";
import type { GroupingCourse, PlannerGrouping } from "./grouping";
import type { PlannerPlacement } from "./placement";

// Local empty default so callers without availability need no index (kept here rather than
// imported from `availability-index` to avoid a runtime cycle via `collisions`).
const NO_AVAILABILITY: AvailabilityIndex = {
  strongUnavailableByTeacher: new Map(),
  softUnavailableByTeacher: new Map(),
};

/**
 * Per-cell drag affordance. The map is **sparse**: a cell absent from the map (while
 * a drag is active) is free. `"partial"` is structurally group-only — single-member
 * drags only ever yield free, `"warn"`, `"opposite-week"`, or `"blocked"`. `"warn"` (soft-NO)
 * is advisory: it only surfaces on a cell that would otherwise be free. `"opposite-week"` marks
 * a cell where a dragged bi-weekly course could legally share on the opposite week — a positive,
 * non-destructive affordance (week chosen after drop). Precedence: blocked > partial >
 * opposite-week > warn > free.
 */
export type DropHint = "partial" | "blocked" | "warn" | "opposite-week";

/** Resolved inputs the derivation needs, independent of which `DragData` kind produced them. */
export type DragHintContext = {
  /** The course(s) the drag would land — one for course/placement drags, N for groupings/bundles. */
  members: GroupingCourse[];
  /** Dragged placements subtracted from the board before the what-if — one for a placement move, all for a bundle. */
  excludePlacementIds?: string[];
  /** For placement/bundle moves: the origin cell, forced `"blocked"` (dropping there is a same-cell no-op). */
  origin?: CellData;
};

type ResolveDeps = {
  catalogById: Map<string, GroupingCourse>;
  groupings: PlannerGrouping[];
  placements: PlannerPlacement[];
};

/**
 * Translate a drag payload into the derivation's inputs, resolving ids to validation-catalog
 * courses and capturing the placement-move exclusion/origin. Returns `null` when nothing
 * resolves (unknown id / empty member-set) so the caller renders no hints.
 */
export const resolveDragHintContext = (data: DragData, deps: ResolveDeps): DragHintContext | null => {
  const { catalogById, groupings, placements } = deps;
  switch (data.kind) {
    case "course": {
      const course = catalogById.get(data.courseId);
      return course ? { members: [course] } : null;
    }
    case "placement": {
      const course = catalogById.get(data.courseId);
      if (!course) return null;
      const row = placements.find((placement) => placement.id === data.placementId);
      return {
        members: [course],
        excludePlacementIds: [data.placementId],
        origin: row ? { day: row.day, period: row.period } : undefined,
      };
    }
    case "grouping": {
      const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
      const members = resolveMembers(grouping, catalogById);
      return members.length > 0 ? { members } : null;
    }
    case "bundle": {
      // A whole-slot drag: members are the source cell's occupants, and ALL of them are
      // excluded so the what-if judges targets against the courses that would remain there.
      const source = placements.filter((placement) => placement.day === data.day && placement.period === data.period);
      const members = source
        .map((placement) => catalogById.get(placement.courseId))
        .filter((course): course is GroupingCourse => course !== undefined);
      if (members.length === 0) return null;
      return {
        members,
        excludePlacementIds: source.map((placement) => placement.id),
        origin: { day: data.day, period: data.period },
      };
    }
  }
};

/**
 * Classify every cell as free (omitted) / `"partial"` / `"blocked"` for the dragged member-set,
 * honoring collision and the same-cell-move no-op. Returns `null` when no drag is active.
 *
 * Sparse by design: only non-free cells are entries, so an empty early-planning grid yields a
 * near-empty map and the caller treats "no entry, drag active" as free without knowing grid bounds.
 */
export const deriveDropHints = (
  context: DragHintContext | null,
  placements: PlannerPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex = NO_AVAILABILITY,
): Map<string, DropHint> | null => {
  if (!context) return null;

  // A placement/bundle move lifts the dragged chip(s) off the board for the what-if, so every
  // cell — including the origin — is judged against the courses that would *remain*.
  const excluded = new Set(context.excludePlacementIds);
  const occupied = excluded.size > 0 ? placements.filter((placement) => !excluded.has(placement.id)) : placements;

  // Candidate cells = occupied cells PLUS empty cells where a dragged member's teacher is
  // strong- OR soft-unavailable. Those aren't seen by `classifyCell`'s `violatesAny`
  // (availability is a board-only constraint with no `test`), so we surface them explicitly.
  const candidates = new Map<string, GroupingCourse[]>();
  for (const [key, { occupants }] of bucketByCell(occupied, catalogById)) candidates.set(key, occupants);
  for (const member of context.members) {
    for (const teacherKey of member.teacherKeys) {
      for (const byTeacher of [availability.strongUnavailableByTeacher, availability.softUnavailableByTeacher]) {
        const unavailableCells = byTeacher.get(teacherKey);
        if (unavailableCells) for (const key of unavailableCells) if (!candidates.has(key)) candidates.set(key, []);
      }
    }
  }

  const hints = new Map<string, DropHint>();
  for (const [key, occupants] of candidates) {
    const hint = classifyCell(context.members, occupants, key, availability);
    if (hint) hints.set(key, hint);
  }

  // The origin of a placement move computes as free after the exclusion above (its only
  // conflicting occupant was itself), but dropping back there is a no-op — force it blocked.
  if (context.origin) hints.set(cellKey(context.origin.day, context.origin.period), "blocked");

  return hints;
};

const resolveMembers = (
  grouping: PlannerGrouping | undefined,
  catalogById: Map<string, GroupingCourse>,
): GroupingCourse[] =>
  (grouping?.memberIds ?? [])
    .map((id) => catalogById.get(id))
    .filter((course): course is GroupingCourse => course !== undefined);

/**
 * A member "hard-fits" a cell iff it would land collision-free AND its teacher is not
 * strong-unavailable there. A member "soft-fits" (opposite-week) iff it does not hard-fit but
 * its only blockers are *soft edges* — the member is bi-weekly and every occupant it conflicts
 * with is also bi-weekly, so the two could share on opposite weeks (the week is chosen after drop).
 *
 * Roll up with precedence blocked > partial > opposite-week > warn > free: any member that
 * hard-conflicts → `"blocked"` (none placeable) / `"partial"` (some placeable); else if any member
 * soft-fits → `"opposite-week"`; else all hard-fit → `"warn"` if any teacher is soft-unavailable
 * there, else free (omit).
 *
 * Collision fit is decided by `violatesAny` over the constraint registry. Availability is a
 * board-only constraint (no `test`), so it is NOT inherited by `violatesAny` — both severities
 * are checked explicitly here, the one place a board-only rule must be wired into hints.
 */
const classifyCell = (
  members: GroupingCourse[],
  occupants: GroupingCourse[],
  key: string,
  availability: AvailabilityIndex,
): DropHint | null => {
  let hardFits = 0;
  let softFits = 0;
  let hardConflicts = 0;
  let soft = false;
  for (const member of members) {
    const strongUnavailable = isStrongUnavailable(member, key, availability);
    if (isSoftUnavailable(member, key, availability)) soft = true;
    if (!violatesAny(member, occupants) && !strongUnavailable) hardFits += 1;
    else if (!strongUnavailable && softFitsOppositeWeek(member, occupants)) softFits += 1;
    else hardConflicts += 1;
  }
  if (hardConflicts > 0) return hardFits + softFits === 0 ? "blocked" : "partial";
  if (softFits > 0) return "opposite-week";
  return soft ? "warn" : null;
};

/**
 * A dragged member soft-fits iff it is bi-weekly AND every occupant it conflicts with is also
 * bi-weekly — the Phase-3 soft-edge rule. Such conflicts are resolvable by placing the member on
 * the opposite week, so the cell is a legal (non-blocking) drop rather than blocked.
 */
const softFitsOppositeWeek = (member: GroupingCourse, occupants: GroupingCourse[]): boolean => {
  if (member.weekMode !== "biweekly") return false;
  const conflicting = occupants.filter((occupant) => violatesAny(member, [occupant]));
  return conflicting.length > 0 && conflicting.every((occupant) => occupant.weekMode === "biweekly");
};

// A member is unavailable at a cell iff ANY of its co-teachers is unavailable there.
const isStrongUnavailable = (member: GroupingCourse, key: string, availability: AvailabilityIndex): boolean =>
  member.teacherKeys.some((teacherKey) => availability.strongUnavailableByTeacher.get(teacherKey)?.has(key) ?? false);

const isSoftUnavailable = (member: GroupingCourse, key: string, availability: AvailabilityIndex): boolean =>
  member.teacherKeys.some((teacherKey) => availability.softUnavailableByTeacher.get(teacherKey)?.has(key) ?? false);
