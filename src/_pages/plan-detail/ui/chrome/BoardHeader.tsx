import { type ReactNode } from "react";
import { CurrentPlanBadge } from "@/shared/ui";
import CohortSwitcher from "./CohortSwitcher";
import type { BoardSurface } from "../../lib/board-surface";

type BoardHeaderProps = {
  planName: string;
  isCurrent: boolean;
  planId: string;
  active: BoardSurface;
  children?: ReactNode;
};

/**
 * The board's heading row: plan name + surface switcher, with an optional trailing slot. Shared by
 * the populated board (`PlanSummaryBar`, which fills the slot with the counts + hint toggle) and the
 * focus-mode empty/compute-groupings state, so the heading stays identical across that transition.
 * `active` is the current `?focus=` surface (a cohort or combined). `isCurrent` adds the "Current"
 * badge after the name (S-404), in every state, since both render sites pass it.
 */
export default function BoardHeader({ planName, isCurrent, planId, active, children }: BoardHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2 print:hidden">
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
      {isCurrent && <CurrentPlanBadge />}
      <CohortSwitcher planId={planId} active={active} />
      {children}
    </div>
  );
}
