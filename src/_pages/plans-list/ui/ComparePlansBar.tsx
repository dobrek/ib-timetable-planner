import { Scale } from "lucide-react";
import { Button } from "@/shared/ui";

/**
 * The live selection count plus the way out of it — the same shape as the students catalog's
 * `BulkActionBar`, which is where this interaction is already established.
 *
 * Renders nothing on an empty selection, and the Compare action stays disabled until a second plan is
 * ticked: one plan's feature vector is just that plan's feature vector, not a comparison.
 */
export default function ComparePlansBar({ count, href, canCompare, onClear }: Props) {
  if (count === 0) return null;

  return (
    <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2">
      <span className="text-foreground text-sm font-medium">{count} selected</span>

      <Button size="sm" className="gap-2" disabled={!canCompare} asChild={canCompare}>
        {canCompare ? (
          <a href={href}>
            <Scale aria-hidden="true" />
            Compare
          </a>
        ) : (
          <span className="inline-flex items-center gap-2">
            <Scale aria-hidden="true" />
            Compare
          </span>
        )}
      </Button>

      {canCompare ? null : <span className="text-muted-foreground text-sm">Pick one more plan to compare.</span>}

      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}

type Props = {
  count: number;
  /** `/plans/compare?plans=…` for the current selection. */
  href: string;
  canCompare: boolean;
  onClear: () => void;
};
