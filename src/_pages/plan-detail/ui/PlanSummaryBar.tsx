type PlanSummaryBarProps = { incompleteCount: number };

/** Read-only header rollup: how many courses still need hours placed. */
export default function PlanSummaryBar({ incompleteCount }: PlanSummaryBarProps) {
  return (
    <div
      data-slot="plan-summary"
      data-incomplete={incompleteCount}
      className="text-muted-foreground flex shrink-0 items-center gap-2 border-b px-6 py-2 text-sm"
    >
      {incompleteCount > 0 ? (
        <span>
          <span className="text-foreground font-medium tabular-nums">{incompleteCount}</span>{" "}
          {incompleteCount === 1 ? "course" : "courses"} left to place
        </span>
      ) : (
        <span className="text-foreground font-medium">All course hours placed</span>
      )}
    </div>
  );
}
