import { Eye } from "lucide-react";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "./badge";

/**
 * The "View only" marker for an account that reads but does not edit (S-405): one global chip in the
 * sidebar footer, so a user whose role was changed knows the missing controls are gone on purpose.
 *
 * Deliberately unlike `CurrentPlanBadge`: an outline in muted ink with an eye icon, never the filled
 * primary chip, because it describes the account rather than marking a plan. It holds no state, so an
 * `.astro` file renders it as static markup.
 *
 * The label is text, not `aria-label` (a plain `span` may not be named, as with `CurrentPlanBadge`), so
 * a caller that shows the icon alone — the collapsed sidebar rail — hides the label visually through
 * `labelClassName` (`sr-only` under its own variant) and keeps "View only" readable. `title` is its
 * tooltip there.
 */
export function ViewOnlyBadge({ className, labelClassName }: { className?: string; labelClassName?: string }) {
  return (
    <Badge variant="outline" title="View only" className={cn("text-muted-foreground", className)}>
      <Eye aria-hidden="true" />
      <span className={labelClassName}>View only</span>
    </Badge>
  );
}
