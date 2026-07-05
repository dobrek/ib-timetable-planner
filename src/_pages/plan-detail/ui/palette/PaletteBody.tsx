import { useDraggable } from "@dnd-kit/react";
import { useMemo, useState } from "react";
import GroupingBox from "./GroupingBox";
import GroupingFilter from "./GroupingFilter";
import PaletteCourseChip from "./PaletteCourseChip";
import { type CourseDisplay, type HoursStat, resolveCourseDisplay } from "@/entities/timetable";
import type { CourseDrag } from "../../model/drag";
import { companionCourseOptions } from "../../model/grouping/companion-course-options";
import { filterGroupings } from "../../model/grouping/filter-groupings";
import { sortByName } from "../../model/grouping/leading-course-options";
import { reconcileCompanion } from "../../model/grouping/reconcile-companion";
import { sortGroupingsForPalette } from "../../model/grouping/sort-groupings";
import type { PlannerGrouping } from "../../model/grouping/grouping";

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
    onLeadingChange,
    companionCourseId,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  } = usePaletteFilter(sortedGroupings, courseDisplay);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6">
      <div className="shrink-0">
        <GroupingFilter
          groupings={groupings}
          courseDisplay={courseDisplay}
          value={leadingCourseId}
          onChange={onLeadingChange}
          companionValue={companionCourseId}
          onCompanionChange={setCompanionCourseId}
          companionOptions={companionOptions}
        />
      </div>
      <div className="flex min-h-0 flex-1 scrollbar-none flex-col gap-2 overflow-y-auto">
        {leadingCourseId !== null && (
          <PromotedCourseChip courseId={leadingCourseId} courseDisplay={courseDisplay} hours={hours} />
        )}
        {visibleGroupings.map((grouping) => (
          <GroupingBox key={grouping.id} grouping={grouping} courseDisplay={courseDisplay} hours={hours} />
        ))}
      </div>
    </div>
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
  const display = resolveCourseDisplay(courseDisplay, courseId);
  return (
    <PaletteCourseChip
      ref={ref}
      name={display.name}
      color={display.color}
      hours={hours.get(courseId)}
      isDragging={isDragging}
    />
  );
}

/**
 * Thin orchestrator for the palette's two-select filter. Holds the leading and companion
 * selection state and delegates every decision to the pure `model/` functions: the
 * cascading companion option list (`companionCourseOptions`, sorted alphabetically) and the
 * two-predicate membership filter (`filterGroupings`). A leading-course change always resets
 * the companion to "Any companion" via the wrapped `changeLeading` handler — even when the old
 * companion still co-occurs with the new leading course; `reconcileCompanion` stays as the
 * residual validity guard that drops a companion a data change left invalid. Exported for the
 * slice's hook test.
 */
export function usePaletteFilter(groupings: PlannerGrouping[], courseDisplay: Record<string, CourseDisplay>) {
  const [leadingCourseId, setLeadingCourseId] = useState<string | null>(null);
  const [companionCourseId, setCompanionCourseId] = useState<string | null>(null);

  // A leading-course change (or clear) always resets the companion — even when the old companion
  // would still co-occur with the new leading course. This is the slice's first change-handler
  // reset; `reconcileCompanion` below is the residual validity guard, not the change trigger.
  const changeLeading = (next: string | null) => {
    setLeadingCourseId(next);
    setCompanionCourseId(null);
  };

  const companionOptions = sortByName(companionCourseOptions(groupings, courseDisplay, leadingCourseId));

  // Adjust-state-during-render (not an effect, precedent PlannerBoard): residual validity guard — if a
  // data change left the companion no longer among the current options, drop it to null in the same
  // render that recomputes the filter. (The leading-change reset is handled by `changeLeading` above.)
  const validCompanion = reconcileCompanion(companionCourseId, companionOptions);
  if (validCompanion !== companionCourseId) setCompanionCourseId(validCompanion);

  const visibleGroupings = filterGroupings(groupings, leadingCourseId, validCompanion);

  return {
    leadingCourseId,
    // Leading changes route through this handler, not a raw setter: it also clears the companion,
    // so a leading change always resets the companion to "Any companion". Named to signal that.
    onLeadingChange: changeLeading,
    companionCourseId: validCompanion,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  };
}
