import { useState } from "react";
import { Sparkles } from "lucide-react";
import type { Cohort } from "@/shared/config";
import { refreshPage } from "@/shared/lib/forms";
import { Button } from "@/shared/ui";
import { computeGroupings } from "../api/grouping-client";

type Props = {
  planId: string;
  cohort: Cohort;
};

/**
 * Empty-state for a plan with no persisted `course_groupings` yet. Calls the
 * computeGroupings Action to compute + persist the palette, then reloads so the
 * board renders from the freshly-persisted rows (single render path). Scoped strictly
 * to the empty state — re-compute and staleness UI are S-06.
 */
export default function ComputeGroupingsEmptyState({ planId, cohort }: Props) {
  const { loading, error, compute } = useComputeGroupings(planId, cohort);

  return (
    <div
      data-slot="compute-groupings-empty-state"
      className="flex flex-col items-center justify-center gap-4 rounded-lg border border-dashed p-12 text-center"
    >
      <Sparkles className="text-muted-foreground size-8" />
      <div className="space-y-1">
        <p className="font-medium">No groupings yet</p>
        <p className="text-muted-foreground text-sm">Compute the palette of co-runnable course groupings to begin.</p>
      </div>
      <Button onClick={compute} disabled={loading}>
        {loading ? "Computing…" : "Compute groupings"}
      </Button>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
    </div>
  );
}

function useComputeGroupings(planId: string, cohort: Cohort) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compute() {
    setLoading(true);
    setError(null);
    try {
      const result = await computeGroupings({ planId, cohort });
      if (result.error) throw new Error(result.error);
      await refreshPage();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error computing groupings");
      setLoading(false);
    }
  }

  return { loading, error, compute };
}
