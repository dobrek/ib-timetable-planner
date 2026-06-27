import { cohortLabel, COHORTS, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import ComputeGroupingsEmptyState from "./ComputeGroupingsEmptyState";
import GroupingStalePanel from "./GroupingStalePanel";
import PlannerPalette from "./PlannerPalette";
import type { PlannerGrouping } from "../model/grouping";
import type { HoursStat } from "../model/hours";
import { resolvePaletteView } from "../model/palette-view";

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
 * toggle, instead of two stacked palettes. The active cohort drives `resolvePaletteView` (empty /
 * stale / ready) exactly as the single board does, and is the cohort the shell dims the sibling
 * against. Compact-first: defaults collapsed. The toggle is hidden while collapsed — expand via the
 * palette rail first.
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
    <div data-slot="combined-palette" className="flex max-h-full min-h-0 shrink-0 flex-col gap-2">
      {!collapsed && <CohortToggle active={activeCohort} onChange={onActiveCohortChange} />}
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
  );
}

/** DP1/DP2 segmented toggle — selects the palette's active cohort (does not navigate). Tokens only. */
function CohortToggle({ active, onChange }: { active: Cohort; onChange: (cohort: Cohort) => void }) {
  return (
    <div
      data-slot="combined-palette-cohort"
      role="group"
      aria-label="Palette cohort"
      className="bg-muted inline-flex items-center gap-1 self-start rounded-md p-1"
    >
      {COHORTS.map((option) => {
        const isActive = option.value === active;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={isActive}
            onClick={() => {
              onChange(option.value);
            }}
            className={cn(
              "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
              isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {cohortLabel(option.value)}
          </button>
        );
      })}
    </div>
  );
}
