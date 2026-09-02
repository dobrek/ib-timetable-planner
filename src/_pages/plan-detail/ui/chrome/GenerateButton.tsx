import { Loader2, Wand2 } from "lucide-react";
import { DEFAULT_SOLVE_POLICY } from "@/entities/timetable";
import { Button } from "@/shared/ui";
import type { GenerationControls } from "../../model/use-cohort-board-state";

type Props = {
  generation: GenerationControls;
};

/**
 * The zero-config toolbar Generate affordance (ghost idiom, next to Export/Settings). Idle →
 * one click enqueues a CP-SAT solve. Disabled while any BLOCKING violation exists on either cohort
 * (block-until-clean — warns don't block), when there are no deficits ("Plan is complete"),
 * or while other writes are unsettled — the `title` names the reason. Errors surface inline with
 * `role="alert"`, mirroring the recompute idiom.
 *
 * The button's job ENDS at dispatch (S-301). It used to own a whole ~20 s greedy solve — elapsed vs
 * budget, "Stop & keep" — and none of that survives the move to a server-side job that runs for
 * ~12 minutes and outlives the page. What the job does next is the status strip's story, read back
 * from `generation_jobs`; and Stop & keep came back as a row write on the proposal's own page
 * (S-305, `StopAndKeep`), which is what makes it work from a closed tab.
 */
export default function GenerateButton({ generation }: Props) {
  const { state, error, disabledReason, busy, launch } = generation;

  const launching = state.status === "launching";
  // Only a LIVE job blocks a new one, matching the partial unique index that enforces it server-side:
  // once a job is delivered or failed the plan is enqueueable again, and the button has to agree.
  // That derivation moved into `disabledReason` with S-306, so it can OUTRANK the board-derived
  // reasons — a running job is the truthful answer even on a board that is also complete.
  const disabledTitle =
    disabledReason === "generating"
      ? "A generation is already running for this plan"
      : disabledReason === "violations"
        ? "Resolve blocking violations first"
        : disabledReason === "complete"
          ? "Plan is complete"
          : busy
            ? "Waiting for pending edits to settle"
            : null;

  return (
    <div data-slot="generate-button" className="flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 gap-1.5"
        onClick={() => {
          launch(DEFAULT_SOLVE_POLICY);
        }}
        disabled={launching || disabledTitle !== null}
        title={disabledTitle ?? "Generate placements for all remaining courses"}
        aria-label="Generate plan"
      >
        {launching ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
        {launching ? "Starting…" : "Generate"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive max-w-56 truncate text-xs" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
