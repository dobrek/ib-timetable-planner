import { Boxes } from "lucide-react";
import { COHORTS, type Cohort } from "@/shared/config";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import GroupingStalePanel from "./GroupingStalePanel";
import PaletteBody from "./PaletteBody";
import CollapsibleEdgePanel from "../chrome/CollapsibleEdgePanel";
import type { PlannerGrouping } from "../../model/grouping/grouping";
import type { HoursStat } from "../../model/hours";
import { resolvePaletteView } from "../../model/grouping/palette-view";

// Re-exported so the palette test and any consumer keep a stable import site even though the filter
// state lives in `PaletteBody`.
export { usePaletteFilter } from "./PaletteBody";

/** One cohort's palette inputs — the slice of board state the panel renders for the active cohort. */
export type PaletteCohortData = {
  cohort: Cohort;
  planId: string;
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  hours: Map<string, HoursStat>;
  stale: boolean;
};

type Props = {
  /** The cohorts the palette can show: one in focus mode (no switcher), both in combined. */
  cohorts: PaletteCohortData[];
  /** Which cohort the palette currently shows. In combined it doubles as the drag-target signal that
   *  dims the sibling column during a palette drag; in focus mode it is fixed to the one cohort. */
  activeCohort: Cohort;
  /** Switch the active cohort — only wired (and the toolbar only shown) when there is more than one. */
  onActiveCohortChange?: (cohort: Cohort) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * The one palette panel: a shared `CollapsibleEdgePanel` whose **header is constant** across all three
 * states; only the **body** swaps on `resolvePaletteView(active)` → ready (filter+list) / stale
 * (recompute) / empty (compute prompt). With more than one cohort the cohort-switcher `Tabs` fill the
 * shell's `toolbar` slot (below the header, expanded-only); with a single cohort there is no toolbar —
 * the focus-mode render then matches the pre-merge single palette exactly. Because the header (+
 * switcher) persist across states, the author can switch cohorts even when one cohort is empty/stale.
 * Compact-first when seeded collapsed: only the rail shows until expanded.
 */
export default function CombinedPalettePanel({
  cohorts,
  activeCohort,
  onActiveCohortChange,
  collapsed,
  onCollapsedChange,
}: Props) {
  const active = cohorts.find((cohort) => cohort.cohort === activeCohort) ?? cohorts[0];
  const view = resolvePaletteView({ groupingsCount: active.groupings.length, stale: active.stale });
  const showSwitcher = cohorts.length > 1;

  return (
    <CollapsibleEdgePanel
      side="left"
      icon={Boxes}
      label="Groupings"
      name="palette"
      countNoun="groupings"
      count={active.groupings.length}
      collapsed={collapsed}
      onCollapsedChange={onCollapsedChange}
      openWidthClass="w-64"
      dataSlot="planner-palette"
      railClassName="bg-background hover:bg-accent rounded-lg border"
      bodyClassName="gap-6"
      toolbar={
        showSwitcher ? (
          <Tabs
            value={activeCohort}
            onValueChange={(value) => {
              onActiveCohortChange?.(value as Cohort);
            }}
            data-slot="combined-palette-cohort"
            className="w-fit shrink-0"
          >
            <TabsList aria-label="Palette cohort">
              {COHORTS.map((option) => (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        ) : undefined
      }
    >
      {view === "ready" ? (
        <PaletteBody groupings={active.groupings} names={active.names} hours={active.hours} />
      ) : view === "stale" ? (
        <GroupingStalePanel planId={active.planId} cohort={active.cohort} />
      ) : (
        <ComputeGroupingsEmptyState planId={active.planId} cohort={active.cohort} />
      )}
    </CollapsibleEdgePanel>
  );
}
