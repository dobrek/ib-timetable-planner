import { useEffect, useMemo, useState } from "react";
import {
  type AvailabilityIndex,
  buildAvailabilityIndex,
  type CellCollisions,
  type CrossCohortIndex,
  deriveCellViolations,
  deriveHours,
  deriveOverplaced,
  deriveUnplaced,
  type LocalPlacement,
  summarizeHours,
} from "@/entities/timetable";
import { deriveLensMatches, type LensCriterion } from "./lens";
import type { CellData, DragData, SharedBoardProps } from "./drag";
import { deriveDropHints, resolveDragHintContext, type DragHintContext } from "./drop-hints";
import type { GroupingCourse, PlannerGrouping } from "./grouping/grouping";
import { deriveOptionalTally } from "./optional-tally";

/**
 * The pure per-cohort board derivations, composed in one place by the per-cohort assembler
 * (`useCohortBoardState`) and the combined orchestrator (`useCombinedBoardState`) — no duplication,
 * no drift. Each is a framework-light memo/state composition of existing model functions — `.ts`,
 * not `.tsx`, since none render JSX. The UI-disclosure/persistence hooks (`useHintMode`,
 * `useShelfDisclosure`, `usePaletteDisclosure`) deliberately stay in the UI layer: the board shell
 * owns them as single shell-level instances, so a per-cohort hook never needs them.
 */

// Shared course lookup, built once for both the collision and drag-hint derivations.
export function useCatalogById(catalog: GroupingCourse[]) {
  return useMemo(() => new Map(catalog.map((course) => [course.id, course])), [catalog]);
}

// Index the raw availability cells (a serializable prop) into the Maps the derivations read.
export function useAvailabilityIndex(availability: SharedBoardProps["availability"]) {
  return useMemo(() => buildAvailabilityIndex(availability), [availability]);
}

// Index the serializable flagged-id array into the Set the edge rule reads — built once and shared
// by the collision and drag-hint derivations, mirroring `useAvailabilityIndex`.
export function useFinishesEarlySet(ids: SharedBoardProps["finishesEarlyByCourseId"]) {
  return useMemo(() => new Set(ids), [ids]);
}

export function useCollisions(
  placements: LocalPlacement[],
  catalogById: Map<string, GroupingCourse>,
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
  finishesEarlyByCourseId: Set<string>,
) {
  return useMemo(
    () => deriveCellViolations(placements, catalogById, availability, occupiedByTeacher, finishesEarlyByCourseId),
    [placements, catalogById, availability, occupiedByTeacher, finishesEarlyByCourseId],
  );
}

// Owns the active-drag identity and derives the per-cell hint map from it. Keyed on live
// placements so marks stay correct if an optimistic placement settles or rolls back mid-drag.
// The map is null when no drag is active, so cells render no hint.
export function useDragHints(
  catalogById: Map<string, GroupingCourse>,
  placements: LocalPlacement[],
  groupings: PlannerGrouping[],
  availability: AvailabilityIndex,
  occupiedByTeacher: CrossCohortIndex,
  finishesEarlyByCourseId: Set<string>,
  periods: number,
) {
  const [context, setContext] = useState<DragHintContext | null>(null);
  const dropHints = useMemo(
    () =>
      deriveDropHints(context, placements, catalogById, availability, occupiedByTeacher, finishesEarlyByCourseId, {
        periods,
      }),
    [context, placements, catalogById, availability, occupiedByTeacher, finishesEarlyByCourseId, periods],
  );
  return {
    dropHints,
    startDragHints: (data: DragData) => {
      setContext(resolveDragHintContext(data, { catalogById, groupings, placements }));
    },
    clearDragHints: () => {
      setContext(null);
    },
  };
}

export function useHours(placements: LocalPlacement[], catalog: GroupingCourse[]) {
  const hours = useMemo(() => deriveHours(placements, catalog), [placements, catalog]);
  const unplaced = useMemo(() => deriveUnplaced(hours), [hours]);
  const overplaced = useMemo(() => deriveOverplaced(hours), [hours]);
  const { hoursLeft, hoursOver } = useMemo(() => summarizeHours(unplaced, overplaced), [unplaced, overplaced]);
  return { hours, unplaced, overplaced, hoursLeft, hoursOver };
}

/** The cohort's pending-optional tally — derived here like the hours siblings, so the popover
 * summary at the UI edge only resolves display names and sorts. */
export function useOptionalTally(placements: LocalPlacement[]) {
  return useMemo(() => deriveOptionalTally(placements), [placements]);
}

// Turns the hook's `lastDuplicated` outcome into a transient, self-clearing highlight the grid
// reads. The highlight is *derived* during render (active unless its nonce has been cleared), so no
// state is set synchronously in the effect; the effect only schedules the clear. `lastDuplicated`
// is a fresh object (bumped nonce) on every duplicate, so a same-cell repeat re-arms the timer and
// re-fires the highlight; the timer is cleared on unmount. The board owns this lifecycle.
const DUPLICATE_HIGHLIGHT_MS = 1200;

export function useDuplicateHighlight(last: (CellData & { nonce: number }) | null) {
  const [clearedNonce, setClearedNonce] = useState<number | null>(null);
  useEffect(() => {
    if (!last) return;
    const timer = setTimeout(() => {
      setClearedNonce(last.nonce);
    }, DUPLICATE_HIGHLIGHT_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [last]);
  return last && last.nonce !== clearedNonce ? last : null;
}

// The highlight lens's match union over one cohort's placements — null while no criteria are active
// (mirrors `dropHints`' null-means-inactive). Deps are orthogonal to the collision/hint memos, so a
// lens change never re-runs them and a placement mutation re-runs this one linear pass alongside.
export function useLensMatches(
  placements: LocalPlacement[],
  catalogById: Map<string, GroupingCourse>,
  criteria: LensCriterion[],
) {
  return useMemo(() => deriveLensMatches(placements, catalogById, criteria), [placements, catalogById, criteria]);
}

export type { CellCollisions };
