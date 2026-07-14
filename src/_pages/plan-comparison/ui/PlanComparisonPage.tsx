import type { PlanComparisonData, PlanDetail } from "../api/load-comparison";
import { DriftBanner } from "./DriftBanner";
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
 * plans they came from.
 *
 * Order matters: what-went-wrong (missing plans) → drift banner → rule verdict → the scoreboard.
 * Everything that could make the numbers *lie* is stated before the numbers are shown.
 */
export default function PlanComparisonPage({ data }: Props) {
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
};

function Comparison({ data }: { data: PlanComparisonData }) {
  return (
    <>
      {data.missingPlanIds.length > 0 ? (
        <div role="status" className="rounded-md border p-3 text-sm">
          {/* Named, not swallowed: a shareable URL goes stale, and the reader deserves to know which
              plan is absent from the columns rather than silently comparing fewer plans. */}
          {data.missingPlanIds.length === 1
            ? "1 plan could not be loaded"
            : `${String(data.missingPlanIds.length)} plans could not be loaded`}
          {" — "}
          {data.missingPlanIds.join(", ")}. It may have been deleted.
        </div>
      ) : null}

      <DriftBanner reports={data.drift} />

      <VerdictBlock plans={data.perPlan} />

      {data.sections.map((section) => (
        <div key={section.title} className="space-y-2">
          <ScoreboardTable section={section} />
          {/* THE invariant: a slot count never renders without its cohort's hour accounting beside it.
              An incomplete board trivially uses fewer slots — which is exactly how the engine's five
              abandoned hours once read as a "better" slot count than the expert's complete board. */}
          {section.title === "Cohort scoreboard" ? <CompletenessNotes data={data} /> : null}
        </div>
      ))}

      <section className="space-y-3">
        <h2 className="text-base font-semibold">Distributions — the signal totals hide</h2>
        <div className="grid gap-3 md:grid-cols-2">
          {data.perPlan.map((plan) => (
            <PlanDetailCard key={plan.planId} plan={plan} />
          ))}
        </div>
      </section>
    </>
  );
}

function CompletenessNotes({ data }: { data: PlanComparisonData }) {
  if (data.annotations.length === 0) return null;

  return (
    <ul className="space-y-1 text-sm">
      {data.annotations.map((annotation) => (
        <li
          key={`${annotation.planId}-${annotation.cohort}-${annotation.kind}`}
          className={annotation.kind === "incomplete" ? "text-destructive" : "text-muted-foreground"}
        >
          {annotation.kind === "incomplete" ? "! " : "~ "}
          {annotation.message}
        </li>
      ))}
    </ul>
  );
}

function PlanDetailCard({ plan }: { plan: PlanDetail }) {
  return (
    <article className="space-y-3 rounded-md border p-3 text-sm">
      <h3 className="font-medium">{plan.planName}</h3>

      <ul className="text-muted-foreground space-y-1 font-mono text-xs">
        {plan.distributions.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>

      <div className="space-y-1">
        <p className="font-medium">Worst cases</p>
        <p className="text-muted-foreground">
          Teacher (gaps): {plan.extremes.worstTeacherGaps ? nameAndValue(plan.extremes.worstTeacherGaps) : "—"}
        </p>
        <p className="text-muted-foreground">
          Student (gaps): {plan.extremes.worstStudentGaps ? nameAndValue(plan.extremes.worstStudentGaps) : "—"}
        </p>
      </div>

      <div className="space-y-1">
        <p className="font-medium">Mirrored cells ({plan.mirroredCells.length})</p>
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
        <p className="font-medium">Time-of-day gradient</p>
        <p className="text-muted-foreground">
          {plan.gradient.length === 0
            ? "(no subjects)"
            : plan.gradient.map((entry) => `${entry.subject} ${entry.meanPeriod}`).join(" · ")}
        </p>
      </div>
    </article>
  );
}

const nameAndValue = (entry: { name: string; value: number }): string => `${entry.name}: ${String(entry.value)}`;
