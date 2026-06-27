import { useState } from "react";
import { TriangleAlert } from "lucide-react";
import type { Cohort } from "@/shared/config";
import { refreshPage } from "@/shared/lib/forms";
import { Button } from "@/shared/ui";
import { computeGroupings } from "../../api/grouping-client";

type Props = {
  planId: string;
  cohort: Cohort;
};

/**
 * Replaces the palette when its suggestions are out of date relative to the live catalog. The
 * whole palette (grouping boxes, leading-course filter, promoted chip) is derived from the stale
 * groupings, so it is hidden rather than annotated — removing the footgun of dragging stale
 * suggestions. The board/grid stays visible and interactive: placements are validated against the
 * live catalog, never the stored groupings, so they remain correct and editable. Recompute is the
 * single action — it calls the existing compute Action, then re-runs the loader (the returning
 * palette is the success signal). On failure an inline `role="alert"` surfaces and the panel stays
 * put for a retry: the plan-detail board mounts no `<Toaster>`, so a toast would render nowhere —
 * this mirrors the sibling `ComputeGroupingsEmptyState`'s inline-error idiom (no `sonner` here).
 *
 * Rendered as the `stale` body of the shared `CollapsibleEdgePanel` (both boards), so it is just the
 * recompute card — the shell owns the surrounding aside/width/header.
 */
export default function GroupingStalePanel({ planId, cohort }: Props) {
  const { busy, error, recompute } = useRecomputeGroupings(planId, cohort);

  return (
    <div
      data-slot="grouping-stale-panel"
      className="border-warning/50 bg-warning/10 text-warning flex flex-col gap-3 rounded-md border p-4"
    >
      <div className="flex items-start gap-2">
        <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="text-sm">
          Suggestions are out of date. Your placed timetable is unchanged — recompute to refresh the palette.
        </p>
      </div>
      <Button onClick={recompute} disabled={busy} className="w-fit">
        {busy ? "Recomputing…" : "Recompute"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

// Busy flag guards re-entry; on success the loader re-run is the success signal (the returning
// palette), so there is nothing to set afterward; on failure the inline error stays and the
// panel persists (stale is still true) so the author can retry.
function useRecomputeGroupings(planId: string, cohort: Cohort) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function recompute() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await computeGroupings({ planId, cohort });
      if (result.error) throw new Error(result.error);
      await refreshPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error recomputing groupings");
      setBusy(false);
    }
  }

  return { busy, error, recompute };
}
