import type { PlanComparisonData, PlanDetail } from "../api/load-comparison";
import { MAX_COMPARE_PLANS } from "../lib/compare-params";
import { DriftBanner } from "./DriftBanner";
import { MetricHelp } from "./MetricHelp";
import { ScoreboardTable } from "./ScoreboardTable";
import { VerdictBlock } from "./VerdictBlock";

/**
 * The presenter. Takes one plain-serializable `data` prop — no `Map`s cross the island boundary (the
 * read-only plan-view precedent).
 *
 * **This page has no plan picker, deliberately.** The selection is made on the plans hub and arrives in
 * the URL, so every number below is SSR'd from exactly the plans named in the heading. An in-page picker
 * was client state driving server-rendered numbers: change it and the columns kept their old values, so
 * the page could quietly show one selection and one set of measurements that disagreed with it. Changing
 * the selection means going back to the hub — one round trip, and the numbers can never lie about which
 * plans they came from. The island hydrates for the metric-help popovers, which hold nothing but their
 * own open/closed state; the rule is that no client state here may *choose what is measured*.
 *
 * Order matters: what-went-wrong (missing plans) → drift banner → rule verdict → the scoreboard.
 * Everything that could make the numbers *lie* is stated before the numbers are shown.
 */
export default function PlanComparisonPage({ data, omittedForCap = 0 }: Props) {
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Compare plans</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {data === null
              ? "A feature vector per plan, never a score."
              : `${data.plans.map((plan) => plan.name).join(" · ")} — a feature vector per plan, never a score. The numbers are the evidence; the judgement is yours.`}
          </p>
        </div>
        <a href="/plans" className="text-primary text-sm font-medium underline-offset-4 hover:underline">
          Change selection
        </a>
      </header>

      {/* Stated before the numbers, for the same reason the missing-plan and drift notices are: a reader
          who asked for twelve plans and is shown eight would otherwise read a partial comparison as the
          whole one. The cap is a reliability bound — see `MAX_COMPARE_PLANS`. */}
      {omittedForCap > 0 ? (
        <div role="status" className="rounded-md border p-3 text-sm">
          Showing the first {MAX_COMPARE_PLANS} plans — {omittedForCap} more {omittedForCap === 1 ? "was" : "were"} left
          out. Compare fewer plans at a time for a readable scoreboard.
        </div>
      ) : null}

      {data === null ? (
        <p className="text-muted-foreground text-sm">
          Nothing to compare. Tick two or more plans on the plans list, then press Compare.
        </p>
      ) : (
        <Comparison data={data} />
      )}
    </div>
  );
}

type Props = {
  /** `null` when the URL named no loadable plan — an empty state, not an error. */
  data: PlanComparisonData | null;
  /** How many ids the URL named beyond `MAX_COMPARE_PLANS`. Non-zero renders a truncation notice. */
  omittedForCap?: number;
};

function Comparison({ data }: { data: PlanComparisonData }) {
  return (
    <>
      {data.missingPlanIds.length > 0 ? (
        <div role="status" className="rounded-md border p-3 text-sm">
          {/* Named, not swallowed: a shareable URL goes stale, and the reader deserves to know which
              plan is absent from the columns rather than silently comparing fewer plans. */}
          {data.missingPlanIds.length === 1
            ? "1 plan could not be loaded or is still being generated"
            : `${String(data.missingPlanIds.length)} plans could not be loaded or are still being generated`}
          {" — "}
          {data.missingPlanIds.join(", ")}. It may have been deleted, or be a proposal whose board has not landed yet.
        </div>
      ) : null}

      <DriftBanner reports={data.drift} />

      <VerdictBlock plans={data.perPlan} />

      {/* THE invariant — a slot count never renders without its cohort's hour accounting beside it — is
          carried by the scoreboard itself: UNPLACED HOURS and OVER-PLACED HOURS are its first two rows,
          above every slot count, per plan per cohort. (An incomplete board trivially uses fewer slots,
          which is how the engine's five abandoned hours once read as a "better" slot count than the
          expert's complete board.) The prose restatement of those same numbers is gone; the numbers are
          not. If a slot count ever moves into a section that carries no hour accounting, this invariant
          has to come back with it. */}
      {data.sections.map((section) => (
        <ScoreboardTable key={section.title} section={section} />
      ))}

      <section className="space-y-3">
        <div className="flex items-center gap-1.5">
          <h2 className="text-base font-semibold">Distributions — the signal totals hide</h2>
          <MetricHelp title="Distributions">
            <p>
              A total tells you how big a problem is. A distribution tells you whether it is spread thinly across
              everyone or concentrated on a few people — and only the second kind is fixable by moving one lesson.
            </p>
            <p>
              Each line is a five-number summary: <strong>min</strong>, <strong>p10</strong> (the 10th percentile — a
              tenth of the population sits at or below it), <strong>median</strong>, <strong>mean</strong> and{" "}
              <strong>max</strong>. A median of 1 next to a max of 14 is one person having a terrible week, not a
              systemic problem.
            </p>
          </MetricHelp>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {data.perPlan.map((plan) => (
            <PlanDetailCard key={plan.planId} plan={plan} />
          ))}
        </div>
      </section>
    </>
  );
}

function PlanDetailCard({ plan }: { plan: PlanDetail }) {
  return (
    <article className="space-y-3 rounded-md border p-3 text-sm">
      <h3 className="font-medium">{plan.planName}</h3>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <p className="font-medium">Per-person spread</p>
          <MetricHelp title="Per-person spread">
            <p>
              <strong>Gaps</strong> — free periods stranded between a person’s first and last lesson of a day, totalled
              across their week. Time on site that buys nothing.
            </p>
            <p>
              <strong>Teacher day span</strong> — periods from a teacher’s first lesson to their last on a teaching day,
              gaps included. A span of 8 for 3 lessons is a long day for little teaching.
            </p>
            <p>
              <strong>Span efficiency</strong> — a student’s lessons ÷ their span, per day. 1.0 is a fully compact day;
              0.5 means half the time between arriving and leaving is idle.
            </p>
            <p>
              <strong>Late finishes</strong> — periods left in the day <em>after</em> a student’s last lesson. Read it
              backwards: <strong>0 means they finish in the final period</strong>; a big number means they go home
              early.
            </p>
          </MetricHelp>
        </div>
        <ul className="text-muted-foreground space-y-1 font-mono text-xs">
          {plan.distributions.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>

      {/* No "worst cases" block here: the worst teacher and worst student are scoreboard rows, where
          they are named and linked. Restating them was the same fact twice. */}

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <p className="font-medium">Mirrored cells ({plan.mirroredCells.length})</p>
          <MetricHelp title="Mirrored cells">
            <p>
              A cell where <strong>both cohorts run the same subject at the same time</strong> — same subject and level,
              same day, same period, in DP1 and DP2 at once.
            </p>
            <p>
              These are the school-wide fixtures (SSSTS, CAS/EE): the slots you deliberately synchronize across both
              years. The count is a check that they survived, not a score — zero is correct for a plan that has no
              fixtures, and a fixture that quietly stopped mirroring shows up here as a missing line.
            </p>
            <p>
              Matched week-agnostically on purpose: a fixture still mirrors when DP1 runs it in week A and DP2 in week
              B.
            </p>
          </MetricHelp>
        </div>
        {plan.mirroredCells.length === 0 ? (
          <p className="text-muted-foreground">(none — no cross-cohort synchronization)</p>
        ) : (
          <ul className="text-muted-foreground space-y-1">
            {plan.mirroredCells.map((cell) => (
              <li key={`${String(cell.day)}-${String(cell.period)}-${cell.label}`}>
                d{cell.day} P{cell.period} · {cell.label}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center gap-1.5">
          <p className="font-medium">Time-of-day gradient</p>
          <MetricHelp title="Time-of-day gradient">
            <p>
              The <strong>mean period</strong> of every hour a subject is taught — so Maths at 3.1 sits earlier in the
              day, on average, than History at 6.4. Subjects are listed earliest first.
            </p>
            <p>
              It answers “what does this board think mornings are for?”. Whether the heavy subjects <em>belong</em> in
              the morning is a judgement the page does not make — it reports where they landed, and you decide whether
              that is the school you want.
            </p>
            <p>
              An average, so it hides spread: 3.5 is two hours at P1 and two at P6 just as readily as four at P3–P4.
            </p>
          </MetricHelp>
        </div>
        <p className="text-muted-foreground">
          {plan.gradient.length === 0
            ? "(no subjects)"
            : plan.gradient.map((entry) => `${entry.subject} ${entry.meanPeriod}`).join(" · ")}
        </p>
      </div>
    </article>
  );
}
