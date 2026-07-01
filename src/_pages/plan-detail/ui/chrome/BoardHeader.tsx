import { type ReactNode } from "react";
import CohortSwitcher from "./CohortSwitcher";
import type { BoardSurface } from "../../lib/board-surface";

type BoardHeaderProps = { planName: string; planId: string; active: BoardSurface; children?: ReactNode };

/**
 * The board's heading row: plan name + surface switcher, with an optional trailing slot. Shared by
 * the populated board (`PlanSummaryBar`, which fills the slot with the counts + hint toggle) and the
 * focus-mode empty/compute-groupings state, so the heading stays identical across that transition.
 * `active` is the current `?focus=` surface (a cohort or combined).
 */
export default function BoardHeader({ planName, planId, active, children }: BoardHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
      <CohortSwitcher planId={planId} active={active} />
      {children}
    </div>
  );
}
