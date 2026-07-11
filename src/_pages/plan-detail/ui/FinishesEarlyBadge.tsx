import { Sunset } from "lucide-react";

/**
 * The `finishes_early` cue shared by board chips and palette chips: a small icon badge whose
 * native `title` explains why the generator (and the author) keep these courses at the edges
 * of students' days. Display-only — the blocking edge rule itself lives in the constraint core.
 */
export default function FinishesEarlyBadge() {
  return (
    <span
      data-slot="finishes-early-badge"
      title="Finishes early in the year — belongs at the edge of students' days"
      aria-label="Finishes early"
      className="text-muted-foreground inline-flex shrink-0"
    >
      <Sunset className="size-3" aria-hidden />
    </span>
  );
}
