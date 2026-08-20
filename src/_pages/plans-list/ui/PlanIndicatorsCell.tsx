import { Loader2 } from "lucide-react";
import { Badge } from "@/shared/ui";
import {
  describeGenerationIndicator,
  type IndicatorDescription,
  type IndicatorTone,
  type PlanIndicator,
} from "../model/plan-indicators";
import { useHydrated } from "../model/use-hydrated";

type Props = {
  indicators: readonly PlanIndicator[];
};

/**
 * The Activity cell: what is happening to this plan right now, or nothing at all.
 *
 * An empty cell is the common and correct case — most plans have no job — so this renders nothing
 * rather than a placeholder dash, keeping the hub's scan-down-the-column read honest.
 *
 * `role="status"` on the active badge only (the precedent is `GenerationStatusStrip`): a live region
 * that announced every terminal badge on load would read the whole table aloud, while an advancing
 * stage is exactly the kind of unprompted change assistive tech should hear about.
 */
export default function PlanIndicatorsCell({ indicators }: Props) {
  // One hook for the whole cell rather than one per badge: whether we are past hydration is a
  // property of the render, not of an indicator.
  const hydrated = useHydrated();
  if (indicators.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {indicators.map((indicator) => (
        <IndicatorBadge
          key={indicator.jobId}
          description={describeGenerationIndicator(indicator)}
          hydrated={hydrated}
        />
      ))}
    </div>
  );
}

function IndicatorBadge({ description, hydrated }: { description: IndicatorDescription; hydrated: boolean }) {
  const { tone, label, href, startedAt } = description;
  const active = tone === "active";
  const content = (
    <>
      {active && <Loader2 className="animate-spin" aria-hidden />}
      {label}
      {startedAt !== null && (
        // The instant is always in `dateTime`, so the badge is machine-readable and correct even
        // before hydration; the READABLE time appears once there is a reader whose zone we know.
        // See `useHydrated` — rendering it on the server would show every non-UTC author the wrong
        // time, which is exactly what this shape avoids rather than suppresses.
        <time dateTime={startedAt}>{hydrated ? formatStarted(startedAt) : null}</time>
      )}
    </>
  );

  if (href === null) {
    return (
      <Badge variant={VARIANTS[tone]} {...(active ? { role: "status" } : {})}>
        {content}
      </Badge>
    );
  }
  return (
    <Badge variant={VARIANTS[tone]} asChild>
      <a href={href} className="underline-offset-2 hover:underline">
        {content}
      </a>
    </Badge>
  );
}

/** Semantic variants only — the theme stays drivable from `global.css` alone. */
const VARIANTS: Record<IndicatorTone, "secondary" | "default" | "destructive" | "outline"> = {
  active: "secondary",
  done: "default",
  failed: "destructive",
  other: "outline",
};

/** The reader's own locale and zone — see `suppressHydrationWarning` above. */
const formatStarted = (iso: string): string =>
  new Date(iso).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
