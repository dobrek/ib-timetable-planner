type PlanSummaryBarProps = { planName: string; incompleteCount: number };

/** Slim board heading row: plan name + how many courses still need hours placed. */
export default function PlanSummaryBar({ planName, incompleteCount }: PlanSummaryBarProps) {
  return (
    <div
      data-slot="plan-summary"
      data-incomplete={incompleteCount}
      className="text-muted-foreground flex shrink-0 items-center gap-2 border-b px-6 py-2 text-sm"
    >
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
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
