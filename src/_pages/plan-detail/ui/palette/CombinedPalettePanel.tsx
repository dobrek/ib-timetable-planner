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
  dp1: PaletteCohortData;
  dp2: PaletteCohortData;
  /** Which cohort the palette currently shows. Owned by the shell — it doubles as the drag-target
   *  signal that dims the sibling column during a palette drag. */
  activeCohort: Cohort;
  onActiveCohortChange: (cohort: Cohort) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

/**
 * The combined view's single palette (S-06): one shared `CollapsibleEdgePanel` whose **header and
 * cohort-switcher toolbar are constant** across all three states; only the **body** swaps on
 * `resolvePaletteView(active)` → ready (filter+list) / stale (recompute) / empty (compute prompt).
 *
 * The cohort `Tabs` live in the shell's `toolbar` slot (below the panel's own header) — the
 * palette-header fix: the switcher no longer floats *above* the panel, the hierarchy reads right, and
 * it auto-hides with the rest of the expanded section when the palette collapses. Because the header +
 * switcher persist across states, the author can switch cohorts even when one cohort is empty/stale.
 * Compact-first: defaults collapsed (only the rail shows; expand it first to reveal the switcher).
 */
export default function CombinedPalettePanel({
  dp1,
  dp2,
  activeCohort,
  onActiveCohortChange,
  collapsed,
  onCollapsedChange,
}: Props) {
  const active = activeCohort === "dp1" ? dp1 : dp2;
  const view = resolvePaletteView({ groupingsCount: active.groupings.length, stale: active.stale });

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
      dataSlot="combined-palette"
      railClassName="bg-background hover:bg-accent rounded-lg border"
      bodyClassName="gap-6"
      toolbar={
        <Tabs
          value={activeCohort}
          onValueChange={(value) => {
            onActiveCohortChange(value as Cohort);
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
