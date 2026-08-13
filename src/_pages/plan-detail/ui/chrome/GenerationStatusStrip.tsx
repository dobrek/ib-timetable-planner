import { ExternalLink, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { describeCleanLabel } from "@/entities/timetable";
import { Button } from "@/shared/ui";
import type { GenerationControls } from "../../model/use-cohort-board-state";

type Props = {
  generation: GenerationControls;
};

/**
 * The generation job's whole visible life, in one strip: active, delivered, or failed.
 *
 * It exists because the work outlives the page. A CP-SAT solve runs for ~12 minutes on a server, so
 * there is no in-page progress to render and no engine to interrogate — only a durable row, and this
 * is the author's window onto it. Refresh re-reads that row, and on a job that has succeeded the
 * re-read is also what DELIVERS it (verify → translate → apply, server-side).
 *
 * Deliberately minimal, and S-303 upgrades it in place: no elapsed time, no stage-by-stage progress,
 * no cancel. Each of those needs either polling or a server-side stop path, and both belong to slices
 * that will design them properly rather than to this one improvising.
 *
 * Semantic theme tokens only — no palette-named or arbitrary colours, so the whole light/dark theme
 * stays drivable from `global.css`.
 */
export default function GenerationStatusStrip({ generation }: Props) {
  const { state, checking, refresh } = generation;
  if (state.status !== "tracking") return null;
  const { job } = state;

  if (job.status === "queued" || job.status === "running") {
    return (
      <Strip>
        <span role="status" className="text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Generating… started {formatStarted(job.createdAt)}
        </span>
        <RefreshButton checking={checking} onRefresh={refresh} />
        <span className="text-muted-foreground/80">This runs for several minutes — you can leave the page.</span>
      </Strip>
    );
  }

  if (job.delivered && job.proposalPlanId) {
    return (
      <Strip>
        <a
          href={`/plans/${job.proposalPlanId}`}
          className="text-foreground hover:text-primary inline-flex items-center gap-1.5 font-medium underline underline-offset-2"
        >
          Proposal ready — open
          <ExternalLink className="size-3.5" aria-hidden />
        </a>
        <span className="text-muted-foreground">{describeCleanLabel(job.cleanLabel)}</span>
      </Strip>
    );
  }

  if (job.status === "failed") {
    return (
      <Strip tone="destructive">
        <span role="alert" className="text-destructive flex items-center gap-1.5">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Generation failed{job.error ? `: ${job.error}` : "."}
        </span>
      </Strip>
    );
  }

  // `succeeded` but not yet delivered (the check is still in flight), or a `stopped`/`interrupted`
  // row from a slice that does not exist yet. Say what is true rather than guess.
  return (
    <Strip>
      <span role="status" className="text-muted-foreground flex items-center gap-1.5">
        {checking && <Loader2 className="size-3.5 animate-spin" aria-hidden />}
        Generation {job.status} — no proposal has been delivered.
      </span>
      <RefreshButton checking={checking} onRefresh={refresh} />
    </Strip>
  );
}

const Strip = ({ children, tone }: { children: React.ReactNode; tone?: "destructive" }) => (
  <div
    data-slot="generation-status-strip"
    className={`flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 text-xs ${
      tone === "destructive" ? "bg-destructive/10 border-destructive/30" : "bg-muted/40 border-border"
    }`}
  >
    {children}
  </div>
);

const RefreshButton = ({ checking, onRefresh }: { checking: boolean; onRefresh: () => void }) => (
  <Button type="button" variant="ghost" size="sm" className="h-6 gap-1.5 px-2" onClick={onRefresh} disabled={checking}>
    <RefreshCw className={`size-3.5 ${checking ? "animate-spin" : ""}`} aria-hidden />
    {checking ? "Checking…" : "Refresh"}
  </Button>
);

/** `created_at` is an ISO instant from the database; render it in the reader's own locale. */
const formatStarted = (createdAt: string): string =>
  new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
