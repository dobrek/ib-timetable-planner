import { COHORTS, type Cohort } from "@/shared/config";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import GroupingStalePanel from "./GroupingStalePanel";
import PlannerPalette from "./PlannerPalette";
import type { PlannerGrouping } from "../../model/grouping";
import type { HoursStat } from "../../model/hours";
import { resolvePaletteView } from "../../model/palette-view";

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
 * The combined view's single palette (S-06, D6-P1): one panel switched between DP1 and DP2 by a
 * `Tabs` toggle (the shared cohort-tabs control, matching the catalog), instead of two stacked
 * palettes. The active cohort drives `resolvePaletteView` (empty / stale / ready) exactly as the
 * single board does, and is the cohort the shell dims the sibling against. Compact-first: defaults
 * collapsed (the toggle is hidden then — expand via the palette rail first). The palette area grows
 * to the full column height so the collapsed rail fills it, like the single board.
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
    <div data-slot="combined-palette" className="flex max-h-full min-h-0 flex-col gap-2">
      {!collapsed && (
        <Tabs
          value={activeCohort}
          onValueChange={(value) => {
            onActiveCohortChange(value as Cohort);
          }}
          data-slot="combined-palette-cohort"
          className="w-fit"
        >
          <TabsList aria-label="Palette cohort">
            {COHORTS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      )}
      {/* Stretch the active panel to the full column height (a flex row → cross-axis stretch), so the
          collapsed palette rail fills the available room rather than sizing to its icon. */}
      <div className="flex min-h-0 flex-1">
        {view === "ready" ? (
          <PlannerPalette
            groupings={active.groupings}
            names={active.names}
            hours={active.hours}
            collapsed={collapsed}
            onCollapsedChange={onCollapsedChange}
          />
        ) : view === "stale" ? (
          <GroupingStalePanel planId={active.planId} cohort={active.cohort} />
        ) : (
          <ComputeGroupingsEmptyState planId={active.planId} cohort={active.cohort} />
        )}
      </div>
    </div>
  );
}
