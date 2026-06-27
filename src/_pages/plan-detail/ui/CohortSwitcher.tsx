import { COHORTS, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";

/** The active surface: a single cohort board (`dp1`/`dp2`) or the combined two-cohort view (S-06). */
export type BoardSurface = Cohort | "combined";

type Props = { planId: string; active: BoardSurface };

type Segment = { value: BoardSurface; label: string; href: string };

/**
 * Segmented DP1 / DP2 / Combined control — the single entry point for switching the board surface.
 * Each inactive segment is a link, so selecting it navigates (a full SSR remount onto that cohort,
 * or onto the combined route — the clean init-once/remount model). The active segment is marked and
 * non-navigating. Folding the combined view into the switcher (rather than a separate link beside
 * it) keeps the three surfaces as one mutually-exclusive choice and removes the disabled-switcher /
 * "back to single cohort" special-casing. Styled with semantic theme tokens only (lessons.md).
 */
export default function CohortSwitcher({ planId, active }: Props) {
  const segments: Segment[] = [
    ...COHORTS.map((option) => ({
      value: option.value,
      label: option.label,
      href: `/plans/${planId}?cohort=${option.value}`,
    })),
    { value: "combined", label: "Combined", href: `/plans/${planId}/combined` },
  ];

  return (
    <div
      data-slot="cohort-switcher"
      role="group"
      aria-label="Cohort"
      className="bg-muted inline-flex items-center gap-1 rounded-md p-1"
    >
      {segments.map((segment) => {
        const isActive = segment.value === active;
        const className = cn(
          "rounded-sm px-3 py-1 text-sm font-medium transition-colors",
          isActive ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
        );
        return isActive ? (
          <span key={segment.value} aria-current="page" className={className}>
            {segment.label}
          </span>
        ) : (
          <a key={segment.value} href={segment.href} className={className}>
            {segment.label}
          </a>
        );
      })}
    </div>
  );
}
