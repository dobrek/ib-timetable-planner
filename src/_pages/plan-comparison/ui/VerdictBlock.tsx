import { Badge } from "@/shared/ui";
import type { PlanDetail } from "../api/load-comparison";

/**
 * The rule verdict the engine's own oracle gives us for free — "would the engine have been ALLOWED to
 * ship this board?" — rendered beside the feature table, plus the catalog warnings.
 *
 * The warnings are **part of the product, not diagnostics**: a `zero-hours` course reads as "complete"
 * and a `no-students` course contributes nothing to the slot census, so an unflagged anomaly is a wrong
 * answer from a tool whose whole product is trustworthy figures. They render next to the numbers.
 *
 * Ports `bench/plan-report.ts:44-58`.
 */
export function VerdictBlock({ plans }: Props) {
  return (
    <section className="space-y-2">
      <h2 className="text-base font-semibold">Rule verdict</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {plans.map((plan) => (
          <article key={plan.planId} className="space-y-2 rounded-md border p-3 text-sm">
            <header className="flex flex-wrap items-center gap-2">
              <Badge variant={plan.verdict.ok ? "secondary" : "destructive"}>
                {plan.verdict.ok ? "oracle-valid: YES" : "oracle-valid: NO"}
              </Badge>
              <span className="font-medium">{plan.planName}</span>
              <span className="text-muted-foreground">soft-availability warns: {plan.verdict.softWarnCount}</span>
            </header>

            {plan.verdict.reasons.length === 0 ? (
              <p className="text-muted-foreground">(no blocking violations, no generated-row stacking)</p>
            ) : (
              <ul className="space-y-1">
                {plan.verdict.reasons.map((reason) => (
                  <li key={reason} className="text-destructive">
                    ✗ {reason}
                  </li>
                ))}
              </ul>
            )}

            {plan.warnings.length > 0 ? (
              <div className="space-y-1">
                <p className="font-medium">
                  catalog warnings: {plan.warnings.length} — these rows distort the metrics below
                </p>
                <ul className="space-y-1">
                  {plan.warnings.map((warning) => (
                    <li key={`${warning.cohort}-${warning.courseId}-${warning.kind}`} className="text-muted-foreground">
                      ! [{warning.cohort}] {warning.kind}: {warning.message}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}

type Props = { plans: PlanDetail[] };
