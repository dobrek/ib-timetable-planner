import { useDraggable } from "@dnd-kit/react";
import { useMemo, useState } from "react";
import GroupingBox from "./GroupingBox";
import GroupingFilter from "./GroupingFilter";
import PaletteCourseChip from "./PaletteCourseChip";
import type { CourseDrag } from "../model/drag";
import { companionCourseOptions } from "../model/companion-course-options";
import { filterGroupings } from "../model/filter-groupings";
import { sortByName } from "../model/leading-course-options";
import { reconcileCompanion } from "../model/reconcile-companion";
import { sortGroupingsForPalette } from "../model/sort-groupings";
import type { PlannerGrouping } from "../model/grouping";
import type { HoursStat } from "../model/hours";

type PlannerPaletteProps = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
};

/**
 * The palette aside: a cascading leading + companion course filter over a scrollable
 * list of grouping hint boxes. The filter is purely a rendering concern — nothing
 * outside the palette reads it — so the selection state lives here, while the membership
 * predicates and cascading options are pure `model/` functions (`filterGroupings`,
 * `companionCourseOptions`, `reconcileCompanion`).
 */
export default function PlannerPalette({ groupings, names, hours }: PlannerPaletteProps) {
  const sortedGroupings = useMemo(() => sortGroupingsForPalette(groupings), [groupings]);
  const {
    leadingCourseId,
    setLeadingCourseId,
    companionCourseId,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  } = usePaletteFilter(sortedGroupings, names);

  return (
    <aside data-slot="planner-palette" className="flex min-h-0 flex-col gap-6">
      <div className="shrink-0">
        <GroupingFilter
          groupings={groupings}
          names={names}
          value={leadingCourseId}
          onChange={setLeadingCourseId}
          companionValue={companionCourseId}
          onCompanionChange={setCompanionCourseId}
          companionOptions={companionOptions}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {leadingCourseId !== null && <PromotedCourseChip courseId={leadingCourseId} names={names} hours={hours} />}
        {visibleGroupings.map((grouping) => (
          <GroupingBox key={grouping.id} grouping={grouping} names={names} hours={hours} />
        ))}
      </div>
    </aside>
  );
}

/**
 * The selected leading course promoted to a draggable single-course chip, pinned as the
 * first item of the palette list. Emits a `CourseDrag` so the existing `addCourse` drop
 * path places exactly this one course; `single:${courseId}` is collision-free with the
 * grouping/placement ids. Re-selecting the filter stages a different single.
 */
function PromotedCourseChip({
  courseId,
  names,
  hours,
}: {
  courseId: string;
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
}) {
  const { ref, isDragging } = useDraggable<CourseDrag>({
    id: `single:${courseId}`,
    data: { kind: "course", courseId },
  });
  return (
    <PaletteCourseChip
      ref={ref}
      name={names[courseId] ?? courseId}
      hours={hours.get(courseId)}
      isDragging={isDragging}
    />
  );
}

/**
 * Thin orchestrator for the palette's two-select filter. Holds the leading and companion
 * selection state and delegates every decision to the pure `model/` functions: the
 * cascading companion option list (`companionCourseOptions`, sorted alphabetically), the
 * stale-companion reset (`reconcileCompanion`, applied during render so a companion that
 * no longer co-occurs with the leading course can never silently mis-filter), and the
 * two-predicate membership filter (`filterGroupings`). Exported for the slice's hook test.
 */
export function usePaletteFilter(groupings: PlannerGrouping[], names: Record<string, string>) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const [companionCourseId, setCompanionCourseId] = useState<string | null>(null);

  const companionOptions = sortByName(companionCourseOptions(groupings, names, leadingCourseId));

  // Adjust-state-during-render (not an effect, precedent PlannerBoard.tsx:253): if the
  // companion is no longer among the current options — because the leading course changed
  // or cleared — drop it to null in the same render that recomputes the filter.
  const validCompanion = reconcileCompanion(companionCourseId, companionOptions);
  if (validCompanion !== companionCourseId) setCompanionCourseId(validCompanion);

  const visibleGroupings = filterGroupings(groupings, leadingCourseId, validCompanion);

  return {
    leadingCourseId,
    setLeadingCourseId,
    companionCourseId: validCompanion,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  };
}
