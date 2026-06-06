import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";

type Props = {
  planId: string;
  cohortId: string;
};

/**
 * Empty-state for a plan with no persisted `course_groupings` yet. POSTs to the
 * existing `/api/grouping` to compute + persist the palette, then reloads so the
 * board renders from the freshly-persisted rows (single render path). Scoped strictly
 * to the empty state — re-compute and staleness UI are S-06.
 */
export default function ComputeGroupingsEmptyState({ planId, cohortId }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function compute() {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/grouping", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planId, cohortId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Compute failed (${response.status})`);
      }
      location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error computing groupings");
      setLoading(false);
    }
  }

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
