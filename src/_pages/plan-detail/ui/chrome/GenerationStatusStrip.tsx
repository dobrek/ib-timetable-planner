import { ExternalLink, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { describeCleanLabel, isHaltedJobStatus, LADDER_TIER_COUNT, policyLabel } from "@/entities/timetable";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui";
import type { GenerationJobView } from "../../api/generation-delivery";
import type { GenerationControls } from "../../model/use-cohort-board-state";

type Props = {
  generation: GenerationControls;
};

/**
 * The generation job's whole visible life, in one strip — and since S-306, TWO strips, because the
 * job now has two pages and they owe the author different things.
 *
 * It exists because the work outlives the page. A CP-SAT solve runs for ~12 minutes on a server, so
 * there is no in-page progress to render and no engine to interrogate — only a durable row, and this
 * is the author's window onto it. Refresh re-reads that row, and on a job with a deliverable board
 * the re-read is also what DELIVERS it (verify → translate → apply, server-side).
 *
 * **The split, and why the source loses most of what it used to say.** The board lands on the
 * PROPOSAL, never on the source (FR-307), and the proposal is a plan of its own the author can open
 * from the first second. So:
 *
 *   * On the **source** the job is something that is happening elsewhere. While it runs, one advisory
 *     line (FR-308) pointing at the proposal; if it failed, the reason, because a failed job has no
 *     proposal left to carry it. Once it delivers, **nothing** — the result is not on this plan and a
 *     "ready" banner here would be an invitation to look for it in the wrong place.
 *   * On the **proposal**, once delivered, provenance: what this board was generated from and when,
 *     plus the quality label. A proposal's whole identity is that it came from somewhere.
 *
 * The pending proposal has no strip at all — it has `PendingProposalPage`, which IS the strip.
 *
 * **Static by design, and it stays that way.** This is FR-308's advisory — status plus a start time,
 * SSR'd from the page's frontmatter — and S-303 deliberately did NOT make it live. Stage-by-stage
 * progress lives on the plans list and on the proposal's own page, both of which have no board, so
 * polling can never contend with dragging there: FR-312 satisfied structurally rather than by a
 * memoization argument. Nothing in this island loops, and nothing should start. The stop affordance
 * (S-305) lives on the proposal's own page for the same reason progress does — see `StopAndKeep`.
 *
 * Semantic theme tokens only — no palette-named or arbitrary colours, so the whole light/dark theme
 * stays drivable from `global.css`.
 */
export default function GenerationStatusStrip({ generation }: Props) {
  const { state, checking, refresh } = generation;
  const hydrated = useHydrated();
  if (state.status !== "tracking") return null;
  const { job } = state;

  if (job.role === "proposal") return <ProposalStrip job={job} hydrated={hydrated} />;

  if (job.status === "queued" || job.status === "running") {
    return (
      <Strip>
        <span role="status" className="text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Generating a proposal from the{" "}
          <time dateTime={job.createdAt}>{hydrated ? formatStarted(job.createdAt) : null}</time> state
        </span>
        {/* Always present while active: the clone is created before the job row exists, and only a
            terminal branch ever detaches or sweeps it. */}
        {job.proposalPlanId && (
          <a
            href={`/plans/${job.proposalPlanId}`}
            className="text-foreground hover:text-primary inline-flex items-center gap-1 font-medium underline underline-offset-2"
          >
            Open proposal
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
        )}
        <RefreshButton checking={checking} onRefresh={refresh} />
        <a href="/plans" className="text-foreground hover:text-primary font-medium underline underline-offset-2">
          Watch progress in Plans
        </a>
        <span className="text-muted-foreground/80">This runs for several minutes — you can leave the page.</span>
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
        <RefreshButton checking={checking} onRefresh={refresh} />
      </Strip>
    );
  }

  // Halted with nothing kept: the container died, or the author stopped it, before a single stage
  // finished — so there is no board to deliver and the clone has already been swept. Advisory rather
  // than destructive: the run was cut short, which is not the author's data being wrong.
  if (isHaltedJobStatus(job.status) && job.checkpointStageIndex === null) {
    return (
      <Strip>
        <span role="status" className="text-muted-foreground flex items-center gap-1.5">
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          {haltedSummary(job)} Generate again when you are ready.
        </span>
        <RefreshButton checking={checking} onRefresh={refresh} />
      </Strip>
    );
  }

  // Delivered, or terminal-with-a-board that the check is still landing. Either way the result is on
  // the PROPOSAL and not here, so the source says nothing at all — see the split above.
  return null;
}

/**
 * The delivered proposal's own line: where this board came from, and how good it is.
 *
 * The provenance link is the only route back to the source, and it matters more than it looks: a
 * proposal is named `Proposal — <source>` only until the author renames it, after which nothing else
 * on the page records which plan it was solved from. The policy noun beside it (S-307) is the ONE
 * surface that shows the policy afterwards — the hub and the pending page do not — because two
 * proposals from the same source differ in nothing else the author can see.
 */
const ProposalStrip = ({ job, hydrated }: { job: GenerationJobView; hydrated: boolean }) => {
  if (!job.delivered) return null;
  return (
    <Strip>
      <span className="text-muted-foreground">
        Generated from{" "}
        <a
          href={`/plans/${job.sourcePlanId}`}
          className="text-foreground hover:text-primary font-medium underline underline-offset-2"
        >
          {job.sourcePlanName ?? "the source plan"}
        </a>{" "}
        at <time dateTime={job.createdAt}>{hydrated ? formatStarted(job.createdAt) : null}</time> ·{" "}
        {policyLabel(job.policy.preset)} policy
      </span>
      {/* A halted run says which stage it got to INSTEAD of a clean label, not beside it: a mid-ladder
          transcript rarely reaches tier 5, so `describeCleanLabel` would honestly but unhelpfully say
          "unavailable" where the author wants to know how far the solve got. */}
      <span className="text-muted-foreground">
        {isHaltedJobStatus(job.status) ? haltedSummary(job) : describeCleanLabel(job.cleanLabel)}
      </span>
    </Strip>
  );
};

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

/**
 * `created_at` is an ISO instant from the database; render it in the reader's own locale — but only
 * once there IS a reader. The server renders on workerd in UTC, so formatting there would hand every
 * non-UTC author the wrong time; the `<time dateTime>` carries the instant meanwhile. Same shape as
 * the plans-list Activity cell; see `useHydrated`.
 */
const formatStarted = (createdAt: string): string =>
  new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

/**
 * How far a halted solve got, in the same "stage N of 10" form the hub's progress label uses — and
 * WHO halted it.
 *
 * Naming the stage is half the point: a partial board is a legitimate result the author may well
 * keep, and "kept the board from stage 3 of 10" is what tells them whether to keep it or regenerate.
 *
 * Naming the agent is the other half, and it is what S-305 makes necessary. `stopped` and
 * `interrupted` were one vocabulary here while only one of them had a producer; now that the author
 * can stop a solve, reading "Stopped" over a run the PLATFORM killed would attribute their own act to
 * them wrongly — and reading it over a run they did stop would say nothing about it at all.
 */
const haltedSummary = (job: GenerationJobView): string => {
  const authored = job.status === "stopped";
  if (job.checkpointStageIndex === null) {
    return authored
      ? "You stopped this generation — nothing was kept."
      : "Generation was interrupted before any stage finished — nothing was kept.";
  }
  const kept = `kept the board from stage ${String(job.checkpointStageIndex)} of ${String(LADDER_TIER_COUNT)}.`;
  return authored ? `Stopped early — ${kept}` : `Interrupted — ${kept}`;
};
