import { type ReactNode } from "react";
import { Badge } from "@/shared/ui";
import BoardHeader from "./BoardHeader";
import type { BoardSurface } from "../../lib/board-surface";

type PlanSummaryBarProps = {
  planName: string;
  incompleteCount: number;
  /** Number of parked (shelved) bundles — the always-visible durability cue. */
  parkedCount: number;
  /** Open the shelf drawer (the badge doubles as the expand affordance). */
  onExpandShelf: () => void;
  planId: string;
  /** The current `?focus=` surface (a cohort or combined), driving the switcher's active segment. */
  active: BoardSurface;
  /** Trailing controls (the drag-hint toggle) — the one header for every mode. */
  trailing?: ReactNode;
};

/** Slim board heading row: plan name + surface switcher + a parked-count cue + how many courses still
 *  need hours placed, with the drag-hint toggle trailing so there is one header for all modes. */
export default function PlanSummaryBar({
  planName,
  incompleteCount,
  parkedCount,
  onExpandShelf,
  planId,
  active,
  trailing,
}: PlanSummaryBarProps) {
  return (
    <BoardHeader planName={planName} planId={planId} active={active}>
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
        {trailing}
      </div>
    </BoardHeader>
  );
}
