import { ArrowUpRight, CircleStop, Loader2, RefreshCw, TriangleAlert } from "lucide-react";
import { isActiveJobStatus, LADDER_TIER_COUNT, tierLabel } from "@/entities/timetable";
import { useHydrated } from "@/shared/lib/use-hydrated";
import { Button } from "@/shared/ui";
import type { GenerationJobView } from "../api/generation-delivery";
import { usePendingProposal } from "../model/generation/use-pending-proposal";
import StopAndKeep from "./StopAndKeep";

type Props = {
  planName: string;
  planId: string;
  /** The role-tagged view the route's `checkPlan` produced. Null only if that check failed. */
  job: GenerationJobView | null;
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
 * **It keeps itself current, and it delivers itself.** The ticker calls the same `checkPlan` the
 * route ran server-side; on the tick that finds a deliverable board, the delivery happens inside that
 * call and the page navigates to the same URL, which now renders the board. See
 * `use-pending-proposal.ts` for why this island is allowed to poll where the board island is not.
 *
 * **And since S-305 it is where a solve is stopped.** The affordance lives here rather than on the
 * hub because this is the one page that already knows how far the ladder has got — naming the stage
 * whose checkpoint would be kept is the decision the author is actually taking, and the hub's badge
 * would have to grow a projection and a dialog to say the same thing.
 *
 * Semantic theme tokens only — no palette-named or arbitrary colours.
 */
export default function PendingProposalPage({ planName, planId, job: initialJob }: Props) {
  const job = usePendingProposal(planId, initialJob);
  const hydrated = useHydrated();

  return (
    <div className="mx-auto max-w-2xl py-16">
      <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Proposal</p>
      <h1 className="text-foreground mt-1 text-2xl font-semibold tracking-tight">{planName}</h1>

      {job === null ? (
        <Panel>
          <span role="status" className="text-muted-foreground">
            This proposal is still being generated. Its status could not be read just now — refresh to try again.
          </span>
        </Panel>
      ) : isActiveJobStatus(job.status) ? (
        <Panel>
          <span role="status" className="text-foreground flex items-center gap-2 font-medium">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {stageLabel(job)}
          </span>
          <p className="text-muted-foreground mt-2 text-sm">
            Started <time dateTime={job.createdAt}>{hydrated ? formatStarted(job.createdAt) : null}</time>. This runs
            for several minutes — the board appears here on its own, and you can leave the page.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <StopAndKeep job={job} />
          </div>
        </Panel>
      ) : job.status === "stopped" ? (
        // The author's own act, so not the destructive panel. A stopped row WITH a checkpoint never
        // reaches here — it is deliverable, so the tick that finds it delivers and navigates to the
        // board — which makes this branch precisely the stopped-before-any-stage case.
        <Panel>
          <span role="status" className="text-foreground flex items-start gap-2">
            <CircleStop className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
            <span>You stopped this generation before any stage finished — nothing was kept.</span>
          </span>
        </Panel>
      ) : (
        <Panel tone="destructive">
          <span role="alert" className="text-destructive flex items-start gap-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>
              This generation ended without a board{job.error ? `: ${job.error}` : "."} Nothing was applied to this
              plan.
            </span>
          </span>
        </Panel>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <RefreshButton />
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
