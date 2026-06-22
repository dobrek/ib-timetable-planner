import { COHORTS, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";

type Props = { planId: string; cohort: Cohort };

/**
 * Segmented DP1/DP2 control. Each inactive cohort is a cohort-scoped link, so selecting it
 * navigates (full SSR remount onto the other cohort — the clean state-reset mechanism, since the
 * placement/slot hooks init once from props). The active segment is marked and non-navigating.
 * Styled with semantic theme tokens only (lessons.md).
 */
export default function CohortSwitcher({ planId, cohort }: Props) {
  return (
    <div
      data-slot="cohort-switcher"
      role="group"
      aria-label="Cohort"
      className="bg-muted inline-flex items-center gap-1 rounded-md p-1"
    >
      {COHORTS.map((option) => {
        const isActive = option.value === cohort;
        const className = cn(
          "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
          isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        );
        return isActive ? (
          <span key={option.value} aria-current="page" className={className}>
            {option.label}
          </span>
        ) : (
          <a key={option.value} href={`/plans/${planId}?cohort=${option.value}`} className={className}>
            {option.label}
          </a>
        );
      })}
    </div>
  );
}
