import { COHORTS } from "@/shared/config";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";
import type { BoardSurface } from "../../lib/board-surface";

type Props = { planId: string; active: BoardSurface };

type Segment = { value: BoardSurface; label: string; href: string };

/**
 * DP1 / DP2 / Combined surface switcher, rendered with the shared `Tabs` control so it reads the
 * same as the catalog's cohort tabs. All three surfaces are now ONE route parameterized by `?focus=`,
 * so each inactive segment is a real `<a>` (via `TabsTrigger asChild`) that navigates to that focus
 * (a full remount of the one board) — the active segment is a plain, non-navigating trigger. The
 * three surfaces stay one mutually-exclusive choice (no separate link, no special-casing). Tokens only.
 */
export default function CohortSwitcher({ planId, active }: Props) {
  const segments: Segment[] = [
    ...COHORTS.map((option) => ({
      value: option.value,
      label: option.label,
      href: `/plans/${planId}?focus=${option.value}`,
    })),
    { value: "combined", label: "Combined", href: `/plans/${planId}?focus=combined` },
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
