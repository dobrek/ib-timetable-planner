import { COHORTS, type Cohort } from "@/shared/config";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";

/** The active surface: a single cohort board (`dp1`/`dp2`) or the combined two-cohort view (S-06). */
export type BoardSurface = Cohort | "combined";

type Props = { planId: string; active: BoardSurface };

type Segment = { value: BoardSurface; label: string; href: string };

/**
 * DP1 / DP2 / Combined surface switcher, rendered with the shared `Tabs` control so it reads the
 * same as the catalog's cohort tabs. The surfaces are separate SSR routes, so each inactive segment
 * is a real `<a>` (via `TabsTrigger asChild`) that navigates (full remount onto that cohort, or onto
 * the combined route) — the active segment is a plain, non-navigating trigger. Folding the combined
 * view in as a third tab keeps the three surfaces one mutually-exclusive choice (no separate link,
 * no disabled-switcher / "back to single cohort" special-casing). Tokens only (lessons.md).
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
    <Tabs value={active} data-slot="cohort-switcher" className="w-fit">
      <TabsList aria-label="Board view">
        {segments.map((segment) =>
          segment.value === active ? (
            <TabsTrigger key={segment.value} value={segment.value}>
              {segment.label}
            </TabsTrigger>
          ) : (
            <TabsTrigger key={segment.value} value={segment.value} asChild>
              <a href={segment.href}>{segment.label}</a>
            </TabsTrigger>
          ),
        )}
      </TabsList>
    </Tabs>
  );
}
