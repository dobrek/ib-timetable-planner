import { type ReactNode } from "react";
import { type Cohort } from "@/shared/config";
import CohortSwitcher from "./CohortSwitcher";

type BoardHeaderProps = { planName: string; planId: string; cohort: Cohort; children?: ReactNode };

/**
 * The board's heading row: plan name + cohort switcher, with an optional trailing slot. Shared by
 * the populated board (`PlanSummaryBar`, which fills the slot with the incomplete-count summary)
 * and the empty/compute-groupings state, so the heading stays identical across that transition.
 */
export default function BoardHeader({ planName, planId, cohort, children }: BoardHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-6 py-2">
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
      <CohortSwitcher planId={planId} active={cohort} />
      {children}
    </div>
  );
}
