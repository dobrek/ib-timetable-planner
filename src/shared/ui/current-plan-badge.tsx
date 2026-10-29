import { Badge } from "./badge";

/**
 * The "Current" marker beside a plan's name (S-404, FR-420): on the hub row, by the board heading,
 * and in the sidebar label and breadcrumb of every single-plan page. One home because those live in
 * three layers (`_pages/plans-list`, `_pages/plan-detail`, `app`), and `shared/ui` is the one all
 * three may import. It holds no state, so an `.astro` file renders it as static markup too.
 *
 * It reads "Current plan" to a screen reader through a visually hidden word, not `aria-label`: the
 * badge is a plain `span`, and ARIA forbids naming that generic role, so screen readers don't
 * reliably announce one.
 */
export function CurrentPlanBadge({ className }: { className?: string }) {
  return (
    <Badge className={className}>
      Current<span className="sr-only"> plan</span>
    </Badge>
  );
}
