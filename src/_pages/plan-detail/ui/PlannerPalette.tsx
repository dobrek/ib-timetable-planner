import { useDraggable } from "@dnd-kit/react";
import { Boxes, ChevronLeft } from "lucide-react";
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
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui";

type PlannerPaletteProps = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
  /** Collapse disclosure — owned by `PlannerBoard` (seeded from the SSR cookie) so it persists. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/** Local icon-button recipe mirroring `ShelfDrawer`'s `SHELF_ICON_BUTTON` — kept separate, not shared. */
const PALETTE_ICON_BUTTON = "text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded";

/**
 * The collapsible left-edge palette aside (1st grid column), mirroring `ShelfDrawer` on the
 * opposite edge. One persistent `<aside>` whose width animates between a thin rail (`w-9`) and the
 * open palette (`w-64`) via the house recipe (`overflow-hidden transition-[width] duration-200
 * motion-reduce:transition-none`); the 1st grid track is `auto`, so it tracks this width and the
 * board reflows in step. The collapsed rail and the expanded body both stay mounted and are toggled
 * by their display class — so the swap never remounts, the dnd-kit draggable source elements survive
 * a collapse, and the filter selection is preserved across a collapse/expand cycle. The palette is
 * never a drop target, so this reflow only ever fires on an explicit rail/header click, never mid-drag.
 *
 * The filter itself is purely a rendering concern — nothing outside the palette reads it — so its
 * selection state lives here (`usePaletteFilter`), while the membership predicates and cascading
 * options are pure `model/` functions (`filterGroupings`, `companionCourseOptions`, `reconcileCompanion`).
 */
export default function PlannerPalette({ groupings, names, hours, collapsed, onCollapsedChange }: PlannerPaletteProps) {
  const sortedGroupings = useMemo(() => sortGroupingsForPalette(groupings), [groupings]);
  const {
    leadingCourseId,
    setLeadingCourseId,
    companionCourseId,
    setCompanionCourseId,
    companionOptions,
    visibleGroupings,
  } = usePaletteFilter(sortedGroupings, names);
  // Total grouping count — the filter is internal and hidden when collapsed, so the rail/header
  // count is the full total, not the filtered `visibleGroupings`.
  const count = groupings.length;

  return (
    <aside
      data-slot="planner-palette"
      data-collapsed={collapsed}
      className={cn(
        "flex max-h-full min-h-0 shrink-0 flex-col overflow-hidden",
        "transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-9" : "w-64",
      )}
    >
      <CollapsedRail
        count={count}
        hidden={!collapsed}
        onExpand={() => {
          onCollapsedChange(false);
        }}
      />
      <div className={cn("min-h-0 flex-1 flex-col gap-6", collapsed ? "hidden" : "flex")}>
        <header className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Boxes className="text-muted-foreground size-4" />
          <span>Groupings</span>
          <span data-slot="palette-count" className="text-muted-foreground tabular-nums">
            {count}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="palette-collapse"
            aria-label="Collapse palette"
            onClick={() => {
              onCollapsedChange(true);
            }}
            className={cn(PALETTE_ICON_BUTTON, "ml-auto")}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
        </header>
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
      </div>
    </aside>
  );
}

/** Idle state: a thin full-height rail framing the total grouping count; the whole thing expands the palette. */
function CollapsedRail({ count, hidden, onExpand }: { count: number; hidden: boolean; onExpand: () => void }) {
  return (
    <button
      type="button"
      data-slot="palette-expand"
      aria-label={`Open palette (${count} groupings)`}
      onClick={onExpand}
      // Toggle display via the class (not the `hidden` attr): a `.flex` utility would override
      // `[hidden]` and keep the rail on screen. `hidden` drops it from layout and the a11y tree.
      className={cn(
        "bg-background hover:bg-accent rounded-lg border",
        "text-muted-foreground hover:text-foreground flex-col items-center gap-2 py-3",
        hidden ? "hidden" : "flex flex-1",
      )}
    >
      <Boxes className="size-4" />
      <span className="text-xs font-medium tabular-nums">{count}</span>
    </button>
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
