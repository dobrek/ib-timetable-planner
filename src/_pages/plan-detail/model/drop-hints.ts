import { bucketByCell, cellKey } from "./collisions";
import { violatesAny } from "./constraints";
import type { CellData, DragData } from "./drag";
import type { GroupingCourse, PlannerGrouping } from "./grouping";
import type { PlannerPlacement } from "./placement";

/**
 * Per-cell drag affordance. The map is **sparse**: a cell absent from the map (while
 * a drag is active) is free. `"partial"` is structurally group-only — single-member
 * drags only ever yield free or `"blocked"`.
 */
export type DropHint = "partial" | "blocked";

/** Resolved inputs the derivation needs, independent of which `DragData` kind produced them. */
export type DragHintContext = {
  /** The course(s) the drag would land — one for course/placement drags, N for groupings. */
  members: GroupingCourse[];
  /** For placement moves: the dragged placement, subtracted from the board before the what-if. */
  excludePlacementId?: string;
  /** For placement moves: the origin cell, forced `"blocked"` (dropping there is a same-cell no-op). */
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
        excludePlacementId: data.placementId,
        origin: row ? { day: row.day, period: row.period } : undefined,
      };
    }
    case "grouping": {
      const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
      const members = resolveMembers(grouping, catalogById);
      return members.length > 0 ? { members } : null;
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
): Map<string, DropHint> | null => {
  if (!context) return null;

  // A placement move lifts the dragged chip off the board for the what-if, so every cell —
  // including its origin — is judged against the courses that would *remain*.
  const occupied = context.excludePlacementId
    ? placements.filter((placement) => placement.id !== context.excludePlacementId)
    : placements;

  const hints = new Map<string, DropHint>();
  for (const [key, { occupants }] of bucketByCell(occupied, catalogById)) {
    const hint = classifyCell(context.members, occupants);
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
 * A member "fits" a cell iff it would land collision-free. Roll up: all fit → free (omit);
 * some fit → `"partial"`; none fit → `"blocked"`.
 *
 * INVARIANT: fit is decided by `violatesAny` over the constraint registry — never a bespoke
 * check — so future constraints (e.g. cross-cohort teacher availability) are inherited for free.
 * Duplicate-of-existing is already covered (`duplicateCourse.test` is in the registry), so no
 * separate `canAdd` check is needed for candidate cells.
 */
const classifyCell = (members: GroupingCourse[], occupants: GroupingCourse[]): DropHint | null => {
  let fits = 0;
  for (const member of members) {
    if (!violatesAny(member, occupants)) fits += 1;
  }
  if (fits === members.length) return null;
  return fits === 0 ? "blocked" : "partial";
};
