import { useState } from "react";
import { CircleStop, Loader2 } from "lucide-react";
import { LADDER_TIER_COUNT } from "@/entities/timetable";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
  Button,
} from "@/shared/ui";
import { stopGeneration as stopGenerationAction } from "../api/generation-client";
import type { GenerationJobView } from "../api/generation-delivery";
import type { StopGenerationResult } from "../api/generation-stop";

type Props = {
  /** The polled snapshot. Everything this component renders is derived from it — there is no local
   *  mirror of the job's state beyond the in-flight call. */
  job: GenerationJobView;
  /** Injected in tests; the real transport is the Astro Action client. */
  stop?: (jobId: string) => Promise<StopGenerationResult>;
};

/**
 * Stop & keep (S-305, FR-305 / US-302): end a running generation and keep the best board the ladder
 * has already checkpointed.
 *
 * **The confirm step exists to name what is kept**, which is the whole of FR-305's obligation: a
 * solve that is stopped at stage 3 delivers a board that met three of ten quality tiers, and an
 * author who was not told that would read a partial board as a finished one. So the dialog says
 * which stage's checkpoint they are about to get — or that there is not one yet.
 *
 * **The copy is LIVE.** It reads `checkpointStageIndex` off the polled snapshot, so a stage
 * completing while the dialog is open moves the number up. That is correct: the sentence always
 * names what would actually be kept if the author confirmed right now.
 *
 * **And it is honest about the wait.** Stopping is a request written to the row, not a signal sent to
 * a process: the solver notices on its next heartbeat and then has to unwind the ladder stage in
 * flight, which is budgeted in minutes. The dialog says so, and no number is quoted — the budgets are
 * configuration, and a measured latency would be a promise this page cannot keep.
 *
 * Semantic theme tokens only, and `AlertDialog` rather than `Dialog` because this is a decision the
 * author has to take deliberately.
 */
export default function StopAndKeep({ job, stop = stopGenerationAction }: Props) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  const confirm = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setFailure(null);
    try {
      await stop(job.jobId);
      setOpen(false);
    } catch (error) {
      // The only outcome that needs saying here. `stopped` / `stopping` / `already-finished` are all
      // narrated by the next poll tick — the snapshot is the single source of truth for job state,
      // and a second one derived from this call's return value could only ever disagree with it.
      setFailure(error instanceof Error ? error.message : "The stop could not be requested.");
    } finally {
      setBusy(false);
    }
  };

  // The request is durable and the solver has not finished reacting to it. The stage line beside this
  // keeps advancing, and truthfully so: the ladder genuinely is still running.
  if (job.stopRequestedAt !== null) {
    return (
      <span
        data-slot="stopping-indicator"
        role="status"
        className="text-muted-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <Loader2 className="size-3.5 animate-spin" aria-hidden />
        Stopping…
      </span>
    );
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-7 gap-1.5 px-2">
          <CircleStop className="size-3.5" aria-hidden />
          Stop &amp; keep
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Stop this generation?</AlertDialogTitle>
          <AlertDialogDescription>
            {keptSummary(job.checkpointStageIndex)} Stopping is not immediate — the solver finishes reacting to it,
            which can take a few minutes. This page updates on its own.
          </AlertDialogDescription>
        </AlertDialogHeader>
        {/* Inside the dialog, not beside it: the dialog stays open when the request fails (the
              author's decision has not been taken yet), and an aria-hidden sibling of an open modal
              is unreachable to a screen reader anyway. */}
        {failure !== null && (
          <p role="alert" className="text-destructive text-sm">
            {failure}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep generating</AlertDialogCancel>
          <AlertDialogAction
            onClick={(event) => {
              event.preventDefault();
              void confirm();
            }}
            disabled={busy}
          >
            {confirmLabel(job.checkpointStageIndex)}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * What confirming would actually keep — the sentence FR-305 is about.
 *
 * "the stage now running is discarded" is not a detail: a checkpoint is written only when a stage
 * SOLVES, so the work done since is genuinely lost, and an author deciding whether to wait needs to
 * know that stopping mid-stage throws that stage away rather than banking it.
 */
const keptSummary = (checkpointStageIndex: number | null): string =>
  checkpointStageIndex === null
    ? "No stage has completed yet — stopping now keeps nothing."
    : `Keep the board from stage ${String(checkpointStageIndex)} of ${String(LADDER_TIER_COUNT)} — the stage now running is discarded.`;

/** "Stop & keep" is a promise the button must not make when there is nothing to keep. */
const confirmLabel = (checkpointStageIndex: number | null): string =>
  checkpointStageIndex === null ? "Stop anyway" : "Stop & keep";
