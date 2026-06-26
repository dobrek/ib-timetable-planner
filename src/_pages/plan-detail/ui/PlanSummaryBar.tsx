import { type Cohort } from "@/shared/config";
import { Badge } from "@/shared/ui";
import BoardHeader from "./BoardHeader";

type PlanSummaryBarProps = {
  planName: string;
  incompleteCount: number;
  /** Number of parked (shelved) bundles — the always-visible durability cue. */
  parkedCount: number;
  /** Open the shelf drawer (the badge doubles as the expand affordance). */
  onExpandShelf: () => void;
  planId: string;
  cohort: Cohort;
};

/** Slim board heading row: plan name + cohort switcher + a parked-count cue + how many courses still need hours placed. */
export default function PlanSummaryBar({
  planName,
  incompleteCount,
  parkedCount,
  onExpandShelf,
  planId,
  cohort,
}: PlanSummaryBarProps) {
  return (
    <BoardHeader planName={planName} planId={planId} cohort={cohort}>
      <div className="ml-auto flex items-center gap-3">
        {parkedCount > 0 && (
          <Badge asChild variant="secondary" className="cursor-pointer">
            <button
              type="button"
              data-slot="parked-badge"
              data-parked={parkedCount}
              aria-label={`${parkedCount} parked — open shelf`}
              onClick={onExpandShelf}
            >
              <span className="tabular-nums">{parkedCount}</span> parked
            </button>
          </Badge>
        )}
        <span data-slot="plan-summary" data-incomplete={incompleteCount} className="text-muted-foreground text-sm">
          {incompleteCount > 0 ? (
            <>
              <span className="text-foreground font-medium tabular-nums">{incompleteCount}</span>{" "}
              {incompleteCount === 1 ? "course" : "courses"} left to place
            </>
          ) : (
            <span className="text-foreground font-medium">All course hours placed</span>
          )}
        </span>
      </div>
    </BoardHeader>
  );
}
