import { type Cohort } from "@/shared/config";
import BoardHeader from "./BoardHeader";

type PlanSummaryBarProps = { planName: string; incompleteCount: number; planId: string; cohort: Cohort };

/** Slim board heading row: plan name + cohort switcher + how many courses still need hours placed. */
export default function PlanSummaryBar({ planName, incompleteCount, planId, cohort }: PlanSummaryBarProps) {
  return (
    <BoardHeader planName={planName} planId={planId} cohort={cohort}>
      <span
        data-slot="plan-summary"
        data-incomplete={incompleteCount}
        className="text-muted-foreground ml-auto text-sm"
      >
        {incompleteCount > 0 ? (
          <>
            <span className="text-foreground font-medium tabular-nums">{incompleteCount}</span>{" "}
            {incompleteCount === 1 ? "course" : "courses"} left to place
          </>
        ) : (
          <span className="text-foreground font-medium">All course hours placed</span>
        )}
      </span>
    </BoardHeader>
  );
}
