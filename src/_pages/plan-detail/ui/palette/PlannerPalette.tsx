import { Boxes } from "lucide-react";
import type { Cohort } from "@/shared/config";
import GroupingStalePanel from "./GroupingStalePanel";
import PaletteBody from "./PaletteBody";
import CollapsibleEdgePanel from "../chrome/CollapsibleEdgePanel";
import type { PlannerGrouping } from "../../model/grouping";
import type { HoursStat } from "../../model/hours";

// Re-exported so the slice's hook test (`PlannerPalette.test.tsx`) and any palette consumer keep a
// stable import site even though the filter state now lives in `PaletteBody`.
export { usePaletteFilter } from "./PaletteBody";

type PlannerPaletteProps = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
  /** Out-of-date palette: swap the filter+list body for the recompute prompt under the same shell. */
  stale: boolean;
  planId: string;
  cohort: Cohort;
  /** Collapse disclosure — owned by `PlannerBoard` (seeded from the SSR cookie) so it persists. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * The single board's collapsible left-edge palette (1st grid column): a thin composition over the
 * shared `CollapsibleEdgePanel`. The shell owns the width-animated `<aside>`, the collapsed rail, and
 * the header/collapse chrome (mirroring `ShelfDrawer` on the opposite edge); the palette supplies its
 * body, swapping the filter+list (`PaletteBody`) for the recompute prompt (`GroupingStalePanel`) when
 * the suggestions are stale — both under the same header so collapse/expand and the count are
 * consistent. The board's `empty` state stays a full-screen early-return handled in `PlannerBoard`
 * (with zero groupings there is nothing to place). Mirrors `CombinedPalettePanel`, minus the
 * cohort-switcher toolbar. The palette's bordered "box" lives on the collapsed rail (`railClassName`),
 * since the open palette has no border of its own; the panel is never a drop target.
 */
export default function PlannerPalette({
  groupings,
  names,
  hours,
  stale,
  planId,
  cohort,
  collapsed,
  onCollapsedChange,
}: PlannerPaletteProps) {
  return (
    <CollapsibleEdgePanel
      side="left"
      icon={Boxes}
      label="Groupings"
      name="palette"
      countNoun="groupings"
      count={groupings.length}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      openWidthClass="w-64"
      dataSlot="planner-palette"
      railClassName="bg-background hover:bg-accent rounded-lg border"
      bodyClassName="gap-6"
    >
      {stale ? (
        <GroupingStalePanel planId={planId} cohort={cohort} />
      ) : (
        <PaletteBody groupings={groupings} names={names} hours={hours} />
      )}
    </CollapsibleEdgePanel>
  );
}
