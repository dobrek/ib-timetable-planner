import { Loader2, Wand2 } from "lucide-react";
import { Button } from "@/shared/ui";
import type { GenerationControls } from "../../model/use-cohort-board-state";

type Props = {
  generation: GenerationControls;
};

/**
 * The zero-config toolbar Generate affordance (ghost idiom, next to Export/Settings). Idle →
 * one click generates. Disabled while any BLOCKING violation exists on either cohort
 * (block-until-clean — warns don't block), when there are no deficits ("Plan is complete"),
 * or while other writes are unsettled — the `title` names the reason. Running → elapsed vs
 * budget progress plus the "Stop & keep" cancel (the engine keeps its best-so-far). Errors
 * surface inline with `role="alert"`, mirroring the recompute idiom.
 */
export default function GenerateButton({ generation }: Props) {
  const { run, error, disabledReason, busy, generate, cancel } = generation;

  if (run.status === "solving") {
    const seconds = (ms: number) => `${String(Math.round(ms / 1000))}s`;
    return (
      <div data-slot="generate-running" className="flex items-center gap-2">
        <span role="status" className="text-muted-foreground flex items-center gap-1.5 text-xs tabular-nums">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Generating… {seconds(run.elapsedMs)} / {seconds(run.budgetMs)}
        </span>
        <Button type="button" variant="ghost" size="sm" className="h-8" onClick={cancel} disabled={run.cancelRequested}>
          {run.cancelRequested ? "Stopping…" : "Stop & keep"}
        </Button>
      </div>
    );
  }

  const applying = run.status === "applying";
  const disabledTitle =
    disabledReason === "violations"
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
        onClick={generate}
        disabled={applying || disabledTitle !== null}
        title={disabledTitle ?? "Generate placements for all remaining courses"}
        aria-label="Generate plan"
      >
        {applying ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Wand2 className="size-4" aria-hidden />}
        {applying ? "Applying…" : "Generate"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive max-w-56 truncate text-xs" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
