import { useState } from "react";
import { Loader2, Wand2 } from "lucide-react";
import { DEFAULT_SOLVE_POLICY, policyLabel, SOLVE_POLICY_PRESETS, type SolvePolicyPreset } from "@/entities/timetable";
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
  ToggleGroup,
  ToggleGroupItem,
} from "@/shared/ui";
import type { GenerationControls } from "../../model/use-cohort-board-state";

type Props = {
  generation: GenerationControls;
};

/**
 * The toolbar Generate affordance (ghost idiom, next to Export/Settings) — since S-307 a deliberate
 * act rather than a one-click launch: the button opens a confirm dialog that carries the solve-policy
 * choice (FR-302), and the confirm is what enqueues the CP-SAT solve.
 *
 * **The trigger is exactly what it was.** `aria-label="Generate plan"`, disabled while any BLOCKING
 * violation exists on either cohort (block-until-clean — warns don't block), when there are no
 * deficits ("Plan is complete"), while a job is already live, or while other writes are unsettled —
 * and the `title` names the reason. Errors surface inline with `role="alert"`.
 *
 * **The dialog states consequences, never verdicts.** Each option gets one sentence about what the
 * board will and will not do under it — no comparison, no ranking, no number. One catalog, one run:
 * same-policy variance rivals between-policy variance, so a sentence that ranked the options would be
 * claiming more than the evidence supports (S-308 owns the measurements).
 *
 * **Seeded from the plan's previous job, on OPEN.** The selection initialises from the tracked job's
 * `policy` each time the dialog opens — not on mount — so a job read back after a launch seeds the
 * next open, and the author's last choice on this plan is what they see first.
 *
 * **Live re-gating at confirm.** The disable reasons are live inputs: a board can become complete, or
 * gain a blocking violation, in another tab while this dialog is open. The confirm re-checks them and
 * shows the reason as visible text with `role="status"` — the screen-reader-perceivable reason the
 * trigger's `title` alone never gave.
 *
 * The button's job still ENDS at dispatch (S-301): what the job does next is the status strip's story,
 * read back from `generation_jobs`, and Stop & keep lives on the proposal's own page (S-305).
 */
export default function GenerateButton({ generation }: Props) {
  const { state, error, disabledReason, busy, launch } = generation;
  const [open, setOpen] = useState(false);
  const [preset, setPreset] = useState<SolvePolicyPreset>(DEFAULT_SOLVE_POLICY.preset);

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

  // The previous job's policy is the seed whatever its status: a delivered or failed run is still
  // the author's last stated preference for THIS plan.
  const seed = state.status === "tracking" ? state.job.policy.preset : DEFAULT_SOLVE_POLICY.preset;

  const onOpenChange = (next: boolean): void => {
    if (next) setPreset(seed);
    setOpen(next);
  };

  const confirm = (): void => {
    launch({ preset });
    setOpen(false);
  };

  return (
    <div data-slot="generate-button" className="flex items-center gap-2">
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 gap-1.5"
            disabled={launching || disabledTitle !== null}
            title={disabledTitle ?? "Generate placements for all remaining courses"}
            aria-label="Generate plan"
          >
            {launching ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Wand2 className="size-4" aria-hidden />
            )}
            {launching ? "Starting…" : "Generate"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Generate a proposal</AlertDialogTitle>
            <AlertDialogDescription>
              The solve runs on the server for several minutes and lands as a new proposal plan. This plan is never
              written to, and you can leave the page while it runs.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <p className="text-sm font-medium">Solve policy</p>
            <ToggleGroup
              type="single"
              value={preset}
              onValueChange={(value) => {
                // Radix emits "" when the active item is re-pressed; ignore it — a policy is never cleared.
                if (isPreset(value)) setPreset(value);
              }}
              aria-label="Solve policy"
              className="w-fit"
            >
              {SOLVE_POLICY_PRESETS.map((option) => (
                <ToggleGroupItem key={option} value={option} size="sm">
                  {policyLabel(option)}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
            <p className="text-muted-foreground text-sm">{POLICY_CONSEQUENCE[preset]}</p>
          </div>
          {/* Inside the dialog and as a live region: the trigger's `title` is invisible to a screen
              reader, and a reason that arrives while the author is deciding has to be perceivable
              where their focus is. */}
          {disabledTitle !== null && (
            <p role="status" className="text-muted-foreground text-sm">
              {disabledTitle}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                confirm();
              }}
              disabled={launching || disabledTitle !== null}
            >
              Generate — {policyLabel(preset)}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {error && (
        <p role="alert" className="text-destructive max-w-56 truncate text-xs" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * One consequence per option — what the timetable WILL and WILL NOT do, in the author's words rather
 * than the engine's (no tiers, no ladder, no "soft cells"), each closed by a concrete "in practice"
 * example. No option is called better, faster or cleaner than another, and no number appears: the
 * copy describes a mechanism the author is choosing, never a recommendation.
 */
const POLICY_CONSEQUENCE: Record<SolvePolicyPreset, string> = {
  clean:
    'Treats a teacher\'s soft unavailability as a rule: no new lesson lands on a period they would rather not teach, beyond any you pinned there yourself. If that leaves no complete timetable, the rule is dropped for this run. In practice, a teacher who marked Friday afternoons as "would rather not" keeps them free, even at the cost of a less compact week.',
  canonical:
    "Treats a teacher's soft unavailability as a preference, weighed only after every course is placed, gaps in the day are closed and the timetable is kept compact. In practice, a teacher may be scheduled on a Friday afternoon they would rather keep free when that makes the week tighter or closes a gap.",
  "student-first":
    "Keeps the same soft-unavailability rule as clean, and looks after students' days before teachers': it removes free periods from students' timetables before compacting the week or closing teachers' gaps. In practice, a student may get an unbroken run of lessons while a teacher is left with a free period between classes, or the day runs later.",
};

const isPreset = (value: string): value is SolvePolicyPreset =>
  (SOLVE_POLICY_PRESETS as readonly string[]).includes(value);
