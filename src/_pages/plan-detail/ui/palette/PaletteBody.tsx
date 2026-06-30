import { useDraggable } from "@dnd-kit/react";
import { useMemo, useState } from "react";
import GroupingBox from "./GroupingBox";
import GroupingFilter from "./GroupingFilter";
import PaletteCourseChip from "./PaletteCourseChip";
import { resolveCourseDisplay, type CourseDisplay } from "../../model/course-display";
import type { CourseDrag } from "../../model/drag";
import { companionCourseOptions } from "../../model/grouping/companion-course-options";
import { filterGroupings } from "../../model/grouping/filter-groupings";
import { sortByName } from "../../model/grouping/leading-course-options";
import { reconcileCompanion } from "../../model/grouping/reconcile-companion";
import { sortGroupingsForPalette } from "../../model/grouping/sort-groupings";
import type { PlannerGrouping } from "../../model/grouping/grouping";
import type { HoursStat } from "../../model/hours";

type Props = {
  groupings: PlannerGrouping[];
  courseDisplay: Record<string, CourseDisplay>;
  hours: Map<string, HoursStat>;
};

/**
 * The palette's interactive body — the leading-course filter + the grouping list — rendered as the
 * `ready` body of the shared `CollapsibleEdgePanel` by the one palette panel (`CombinedPalettePanel`)
 * in both focus and combined modes. Extracting it lets the panel keep a constant header (+ optional
 * cohort-switcher toolbar) while only the body swaps across ready/stale/empty.
 *
 * The filter selection is purely a rendering concern — nothing outside the palette reads it — so its
 * state lives here (`usePaletteFilter`), while the membership predicates and cascading options are
 * pure `model/` functions (`filterGroupings`, `companionCourseOptions`, `reconcileCompanion`).
 */
export default function PaletteBody({ groupings, courseDisplay, hours }: Props) {
  const sortedGroupings = useMemo(() => sortGroupingsForPalette(groupings), [groupings]);
  const {
    leadingCourseId,
    setLeadingCourseId,
    companionCourseId,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  } = usePaletteFilter(sortedGroupings, courseDisplay);

  return (
    <>
      <div className="shrink-0">
        <GroupingFilter
          groupings={groupings}
          courseDisplay={courseDisplay}
          value={leadingCourseId}
          onChange={setLeadingCourseId}
          companionValue={companionCourseId}
          onCompanionChange={setCompanionCourseId}
          companionOptions={companionOptions}
        />
      </div>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-1">
        {leadingCourseId !== null && (
          <PromotedCourseChip courseId={leadingCourseId} courseDisplay={courseDisplay} hours={hours} />
        )}
        {visibleGroupings.map((grouping) => (
          <GroupingBox key={grouping.id} grouping={grouping} courseDisplay={courseDisplay} hours={hours} />
        ))}
      </div>
    </>
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
  courseDisplay,
  hours,
}: {
  courseId: string;
  courseDisplay: Record<string, CourseDisplay>;
  hours: Map<string, HoursStat>;
}) {
  const { ref, isDragging } = useDraggable<CourseDrag>({
    id: `single:${courseId}`,
    data: { kind: "course", courseId },
  });
  return (
    <PaletteCourseChip
      ref={ref}
      name={resolveCourseDisplay(courseDisplay, courseId).name}
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
export function usePaletteFilter(groupings: PlannerGrouping[], courseDisplay: Record<string, CourseDisplay>) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const [companionCourseId, setCompanionCourseId] = useState<string | null>(null);

  const companionOptions = sortByName(companionCourseOptions(groupings, courseDisplay, leadingCourseId));

  // Adjust-state-during-render (not an effect, precedent PlannerBoard): if the companion is no longer
  // among the current options — because the leading course changed or cleared — drop it to null in
  // the same render that recomputes the filter.
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
