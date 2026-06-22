import { type Cohort } from "@/shared/config";
import CohortSwitcher from "./CohortSwitcher";

type PlanSummaryBarProps = { planName: string; incompleteCount: number; planId: string; cohort: Cohort };

/** Slim board heading row: plan name + cohort switcher + how many courses still need hours placed. */
export default function PlanSummaryBar({ planName, incompleteCount, planId, cohort }: PlanSummaryBarProps) {
  return (
    <div
      data-slot="plan-summary"
      data-incomplete={incompleteCount}
      className="text-muted-foreground flex shrink-0 items-center gap-3 border-b px-6 py-2 text-sm"
    >
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
      <CohortSwitcher planId={planId} cohort={cohort} />
      {incompleteCount > 0 ? (
        <span className="ml-auto">
          <span className="text-foreground font-medium tabular-nums">{incompleteCount}</span>{" "}
          {incompleteCount === 1 ? "course" : "courses"} left to place
        </span>
      ) : (
        <span className="text-foreground ml-auto font-medium">All course hours placed</span>
      )}
    </div>
  );
}
