import { ArrowUpRight, CircleStop, Hourglass, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { LADDER_CEILING_MINUTES, LADDER_TIER_COUNT, tierLabel } from "@/entities/timetable";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui";
import type { GenerationJobView } from "../api/generation-read";
import { resolvePendingPanel, type PendingPanel } from "../model/generation/pending-panel";
import { useHasTrackedJob, usePendingProposal } from "../model/generation/use-pending-proposal";
import StopAndKeep from "./StopAndKeep";

type Props = {
  planName: string;
  planId: string;
  /** The role-tagged view the route's read produced. Null if that read failed, or found no job. */
  job: GenerationJobView | null;
  /** The route's `allows(access, "edit")` (S-405): an editor's page delivers and can stop the run. */
  canEdit: boolean;
  /** A non-editor's pending proposal that no job references — the state an editor's visit releases. */
  stranded: boolean;
};

/**
 * What a proposal plan looks like before its board lands (S-306) — the page instead of the board.
 *
 * A proposal is a real plan from the moment Generate is pressed, so the hub lists it and links to it,
 * and this is where that link has to arrive. It cannot be the board: the clone is the apply target of
 * a solve that may still be running, so nothing here is editable and `loadCombinedPlannerData` is not
 * even called for this route. What is left is the one thing the author actually wants — how far the
 * solve has got — plus the two ways out.
 *
 * **It keeps itself current, and for an editor it delivers itself.** The ticker calls the same
 * `checkPlan` the route ran server-side; on the tick that finds a deliverable board, the delivery
 * happens inside that call and the page navigates to the same URL, which now renders the board. See
 * `use-pending-proposal.ts` for why this island is allowed to poll where the board island is not.
 *
 * **A viewer's page only watches (S-405).** Its ticker calls the write-free `readPlanJob`, so a job
 * that went quiet, a finished board and a stranded proposal each wait for an author's or admin's
 * visit — and each gets a panel that says so (`resolvePendingPanel`) instead of a status that could
 * not be read. The page still navigates on the tick that finds the board delivered.
 *
 * **And since S-305 it is where a solve is stopped** — by an editor. The affordance lives here rather
 * than on the hub because this is the one page that already knows how far the ladder has got — naming
 * the stage whose checkpoint would be kept is the decision the author is actually taking, and the
 * hub's badge would have to grow a projection and a dialog to say the same thing.
 *
 * Semantic theme tokens only — no palette-named or arbitrary colours.
 */
export default function PendingProposalPage({ planName, planId, job: initialJob, canEdit, stranded }: Props) {
  const job = usePendingProposal(planId, initialJob, { canEdit });
  const tracked = useHasTrackedJob(job);
  const hydrated = useHydrated();
  const panel = resolvePendingPanel(job, { canEdit, stranded, tracked });

  return (
    <div className="mx-auto max-w-2xl py-16">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Proposal</p>
      <h1 className="text-foreground mt-1 text-2xl font-semibold tracking-tight">{planName}</h1>

      <PanelFor panel={panel} job={job} canEdit={canEdit} hydrated={hydrated} />

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        {/* A removed proposal has no page to refresh into: the request would 404. */}
        {panel !== "removed" && <RefreshButton />}
        <a
          href="/plans"
          className="text-foreground hover:text-primary inline-flex items-center gap-1 font-medium underline underline-offset-2"
        >
          Watch progress in Plans
          <ArrowUpRight className="size-3.5" aria-hidden />
        </a>
        {job && (
          <a
            href={`/plans/${job.sourcePlanId}`}
            className="text-muted-foreground hover:text-foreground underline underline-offset-2"
          >
            Open the source plan
          </a>
        )}
      </div>
    </div>
  );
}

type PanelForProps = {
  panel: PendingPanel;
  job: GenerationJobView | null;
  canEdit: boolean;
  hydrated: boolean;
};

/** One panel per `PendingPanel` kind. The copy differs by capability only where an editor's visit
 *  would have acted, or where the sentence names who did something. */
const PanelFor = ({ panel, job, canEdit, hydrated }: PanelForProps) => {
  if (panel === "stranded") {
    return (
      <Panel>
        <span role="status" className="text-muted-foreground">
          This proposal&apos;s generation is no longer on record. An author&apos;s or admin&apos;s visit will release it
          as an ordinary plan.
        </span>
      </Panel>
    );
  }
  if (panel === "removed") {
    // The page held a job, then a read found none: an editor's visit swept this proposal. Worded like
    // the route's own swept notice (`SweptProposalNotice.astro`), which an editor's visit renders.
    return (
      <Panel>
        <span role="status" className="text-foreground flex items-start gap-2">
          <TriangleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
          <span>This proposal&apos;s generation ended without a board, so it has been removed.</span>
        </span>
      </Panel>
    );
  }
  if (panel === "unreadable" || job === null) {
    return (
      <Panel>
        <span role="status" className="text-muted-foreground">
          This proposal is still being generated. Its status could not be read just now — refresh to try again.
        </span>
      </Panel>
    );
  }

  switch (panel) {
    case "delivered":
      // The tick that delivers publishes its snapshot before it navigates (the polling store's
      // `publish` → `afterTick` order), so a delivered row renders here for the reload's
      // round-trip. Without this branch that flash lands in a terminal panel whose copy is
      // wrong — a stopped row with a kept board would read "nothing was kept".
      return (
        <Panel>
          <span role="status" className="text-foreground flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Board ready — opening…
          </span>
        </Panel>
      );
    case "progress":
      return (
        <Panel>
          <span role="status" className="text-foreground flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {stageLabel(job)}
          </span>
          <p className="text-muted-foreground mt-2 text-sm">
            Started <time dateTime={job.createdAt}>{hydrated ? formatStarted(job.createdAt) : null}</time>. This runs
            for up to about {LADDER_CEILING_MINUTES} minutes — the board appears here on its own
            {canEdit ? ", and you can leave the page." : "."}
          </p>
          {canEdit && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
              <StopAndKeep job={job} />
            </div>
          )}
        </Panel>
      );
    case "stalled":
      // A viewer's read cannot reclaim the row, so it stays `running` (or `queued`) until an editor's
      // visit does. Advisory, not destructive: the board may yet arrive from a kept checkpoint.
      return (
        <Panel>
          <span role="status" className="text-foreground flex items-start gap-2 font-medium">
            <TriangleAlert className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            {job.status === "queued" ? "Queued — stalled" : "Generating — stalled"}
          </span>
          <p className="text-muted-foreground mt-2 text-sm">
            This generation has stopped reporting progress. An author&apos;s or admin&apos;s visit will settle it.
          </p>
        </Panel>
      );
    case "awaiting-author":
      // Delivery writes the board, so only an editor's visit can land it (Open Question 1, decided
      // as "wait for an author"). The page keeps polling and turns into the board when one does.
      return (
        <Panel>
          <span role="status" className="text-foreground flex items-start gap-2 font-medium">
            <Hourglass className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            Finished — waiting for an author
          </span>
          <p className="text-muted-foreground mt-2 text-sm">
            This proposal has finished. Its board appears here once an author or admin opens it.
          </p>
        </Panel>
      );
    case "stopped":
      // Not the destructive panel: stopping is someone's deliberate act. A stopped row WITH a
      // checkpoint never rests here — it is deliverable — which makes this branch precisely the
      // stopped-before-any-stage case. Only an editor can stop a run, so only an editor reads "You".
      return (
        <Panel>
          <span role="status" className="text-foreground flex items-start gap-2">
            <CircleStop className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              {canEdit
                ? "You stopped this generation before any stage finished — nothing was kept."
                : "This generation was stopped before any stage finished — nothing was kept."}
            </span>
          </span>
        </Panel>
      );
    case "failed":
      return (
        <Panel tone="destructive">
          <span role="alert" className="text-destructive flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              This generation ended without a board{job.error ? `: ${job.error}` : "."} Nothing was applied to this
              plan.
            </span>
          </span>
        </Panel>
      );
  }
};

const Panel = ({ children, tone }: { children: React.ReactNode; tone?: "destructive" }) => (
  <div
    data-slot="pending-proposal-panel"
    className={`mt-6 rounded-lg border px-4 py-3 ${
      tone === "destructive" ? "bg-destructive/10 border-destructive/30" : "bg-muted/40 border-border"
    }`}
  >
    {children}
  </div>
);

/**
 * A plain re-request of the same URL, not a client re-check.
 *
 * The ticker already re-checks every five seconds; what Refresh is for is the author who wants to
 * force the question now, and a full navigation answers it through the same server path that renders
 * the board — so a proposal that became deliverable in the last second lands on the board rather than
 * updating a stage number.
 */
const RefreshButton = () => (
  <Button
    type="button"
    variant="ghost"
    size="sm"
    className="h-7 gap-1.5 px-2"
    onClick={() => {
      window.location.assign(window.location.href);
    }}
  >
    <RefreshCw className="size-3.5" aria-hidden />
    Refresh
  </Button>
);

/**
 * "Generating — stage 4 of 10 · teacher holes", or "Generating — starting" before the first stage.
 *
 * The same wording the hub's badge uses, deliberately: the author reaches this page from that badge,
 * and two different phrasings of one fact would read as two different facts. It is re-derived here
 * rather than imported because `plan-indicators.ts` lives in the `plans-list` slice and a
 * cross-`_pages` import is a steiger error; both sides build it from the same entity-layer
 * `tierLabel` / `LADDER_TIER_COUNT`.
 */
const stageLabel = (job: GenerationJobView): string => {
  if (job.stageIndex === null) return "Generating — starting";
  const named = job.stageName === null ? "" : ` · ${tierLabel(job.stageName)}`;
  return `Generating — stage ${String(job.stageIndex)} of ${String(LADDER_TIER_COUNT)}${named}`;
};

/** The reader's own locale, but only once there IS a reader — the server renders in UTC on workerd.
 *  Same shape as the status strip's; see `useHydrated`. */
const formatStarted = (createdAt: string): string =>
  new Date(createdAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
