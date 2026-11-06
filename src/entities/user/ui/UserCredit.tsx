import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui";
import type { Credit } from "../model/credit";

type Props = {
  credit: Credit;
  /**
   * - `stacked`, the default, puts the email beneath the name, as the Users page does.
   * - `inline` keeps one line, with the email in brackets, for a line of text.
   * - `inverse` is `stacked` on an inverted surface, such as a tooltip: it takes the surface's own
   *   ink and mutes the email by opacity, since the page's muted ink would vanish there.
   *
   * The caller says what the credit is for ("Created by", "Requested by").
   */
  variant?: "stacked" | "inline" | "inverse";
};

/**
 * The person a plan or a job is credited to (S-407), shown the one way the app names people
 * (FR-413): the display name with the email beside it, so a look-alike name cannot pass for a
 * colleague, or the email alone. A service account carries its badge. A credit that names nobody
 * reads "Unknown", muted.
 */
export default function UserCredit({ credit, variant = "stacked" }: Props) {
  const ink = variant === "inverse" ? INVERSE_INK : PAGE_INK;
  if (credit.kind === "unknown") return <span className={ink.muted}>Unknown</span>;

  const { label, isServiceAccount } = credit.user;
  const badge = isServiceAccount && (
    <Badge variant="outline" className={ink.badge}>
      Service account
    </Badge>
  );

  if (variant === "inline") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5">
        <span className={cn(ink.strong, "truncate font-medium")}>{label.primary}</span>
        {label.secondary && <span className={cn(ink.muted, "truncate")}>({label.secondary})</span>}
        {badge}
      </span>
    );
  }

  return (
    <span className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className={cn(ink.strong, "font-medium")}>{label.primary}</span>
        {badge}
      </span>
      {label.secondary && <span className={cn(ink.muted, "text-xs")}>{label.secondary}</span>}
    </span>
  );
}

type Ink = { strong: string | undefined; muted: string; badge: string | undefined };

const PAGE_INK: Ink = { strong: "text-foreground", muted: "text-muted-foreground", badge: undefined };

// The surface sets `text-background`; the name inherits it.
const INVERSE_INK: Ink = { strong: undefined, muted: "opacity-70", badge: "border-background/40 text-background" };
