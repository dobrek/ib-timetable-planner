import { X } from "lucide-react";
import { cohortLabel, type Cohort } from "@/shared/config";
import { resolveCourseDisplay, type CourseDisplay } from "@/entities/timetable";
import { Button } from "@/shared/ui";
import type { GenerationSummary } from "../../model/generation/use-generate-plan";

type Props = {
  summary: GenerationSummary;
  /** Plan-wide display map (both cohorts merged) — unplaced course names resolve at this edge. */
  courseDisplay: Record<string, CourseDisplay>;
  onDismiss: () => void;
};

/**
 * The dismissible post-solve review panel (author decision 5): per-cohort occupied slots
 * before → after, the unplaced list with course names (render-edge resolution), budget used,
 * a `partial` marker when the solve was cancelled, and the proven-optimal note when the
 * engine provides it. Ephemeral — never persisted; the hook also dismisses it on the next
 * board edit (it reviews THAT board state).
 */
export default function GenerationSummaryPanel({ summary, courseDisplay, onDismiss }: Props) {
  const { diagnostics, softWarnCount } = summary;
  const cohorts: Cohort[] = ["dp1", "dp2"];

  return (
    <section
      data-slot="generation-summary"
      aria-label="Generation summary"
      className="bg-accent/50 text-accent-foreground flex flex-wrap items-start gap-x-6 gap-y-2 border-b px-4 py-2 text-xs"
    >
      <span className="font-medium">Generated{diagnostics.partial ? " (stopped early — best so far kept)" : ""}</span>
      {cohorts.map((cohort) => {
        const { occupiedSlotsBefore, occupiedSlotsAfter, unplaced } = diagnostics.cohorts[cohort];
        return (
          <span key={cohort} className="flex items-center gap-1.5 tabular-nums">
            <span className="font-medium">{cohortLabel(cohort)}</span>
            <span>
              slots {occupiedSlotsBefore} → {occupiedSlotsAfter}
            </span>
            {unplaced.length > 0 && (
              <span className="text-warning" data-slot="unplaced-list">
                unplaced:{" "}
                {unplaced
                  .map(
                    ({ courseId, missing }) =>
                      `${resolveCourseDisplay(courseDisplay, courseId).name} (${String(missing)}h)`,
                  )
                  .join(", ")}
              </span>
            )}
          </span>
        );
      })}
      <span className="text-muted-foreground tabular-nums">
        {(diagnostics.elapsedMs / 1000).toFixed(1)}s used
        {diagnostics.provenOptimal ? " · proven optimal" : ""}
        {softWarnCount > 0 ? ` · ${String(softWarnCount)} soft availability warn${softWarnCount === 1 ? "" : "s"}` : ""}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="ml-auto size-6"
        onClick={onDismiss}
        aria-label="Dismiss generation summary"
      >
        <X className="size-3.5" />
      </Button>
    </section>
  );
}
