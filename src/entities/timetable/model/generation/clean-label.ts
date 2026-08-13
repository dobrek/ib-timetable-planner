/**
 * How clean is this board, said honestly?
 *
 * Cleanliness is a DERIVED READ, not a stored field — `GenerationDiagnostics` is
 * `additionalProperties: false` on the wire and carries no cleanliness property, and none is needed.
 * Two numbers settle it: the pinned FLOOR (recomputed from the job's stored snapshot,
 * `computePinnedSoftFloor`) and the ACHIEVED tier-5 `best` the solver recorded in
 * `generation_jobs.stages`.
 *
 * The three outcomes matter to an author for different reasons:
 *
 *   achieved === 0          nothing sits on a soft cell. Clean, full stop.
 *   achieved === floor > 0  clean AS PERMITTED — the solve added nothing, but the author's own pins
 *                           occupy soft cells. Calling this "clean" would overclaim, so it names the
 *                           residue and says what would remove it. (`change.md`, UI-labelling decision.)
 *   achieved > floor        the floor was unsatisfiable and the engine dropped the clean constraint.
 *                           A real board, honestly labelled — never refused.
 *
 * The tier-5 entry is found by `tier === 5`, **never by array index**: `stages` is variable-length
 * and possibly sparse (a single completeness report on infeasible/unknown, tiers 1 and 4 only in
 * repair mode). A missing entry, or one with no `best`, yields `unavailable` rather than a throw or a
 * confident wrong number — the board is still deliverable, its cleanliness merely unknown.
 */
export type CleanLabel =
  | { kind: "clean" }
  | { kind: "clean-at-floor"; pinnedHours: number }
  | { kind: "not-clean"; softHits: number; floor: number }
  | { kind: "unavailable" };

/** One camelCase `StageReport` as stored in `generation_jobs.stages` (contract shape, jsonb). */
export type StoredStageReport = {
  tier: number;
  name: string;
  status: string;
  best?: number;
  bound?: number;
  wallClockS: number;
};

const SOFT_HITS_TIER = 5;

/**
 * The achieved `softHits` — tier 5's `best` — or undefined when the ladder never reported it.
 *
 * Exported because the caller can often answer the whole question with it alone: `0` is clean
 * whatever the floor is, and only a NON-zero value needs the floor, which costs a ~124 KB snapshot
 * read to recompute. Short-circuiting on this keeps the common case free.
 */
export const softHitsAchieved = (stages: readonly StoredStageReport[]): number | undefined =>
  stages.find((stage) => stage.tier === SOFT_HITS_TIER)?.best;

export const deriveCleanLabel = (stages: readonly StoredStageReport[], floor: number): CleanLabel => {
  const achieved = softHitsAchieved(stages);
  if (achieved === undefined) return { kind: "unavailable" };
  if (achieved === 0) return { kind: "clean" };
  // `<=`, not `===`: below the floor is arithmetically impossible (the floor is irreducible), so
  // seeing it would mean this side's formula has drifted from the engine's. Reading it as
  // clean-at-floor degrades gracefully — the alternative would be calling a board that added
  // nothing "not clean" on the strength of our own miscount.
  if (achieved <= floor) return { kind: "clean-at-floor", pinnedHours: achieved };
  return { kind: "not-clean", softHits: achieved, floor };
};

/** The author-facing sentence. Kept beside the derivation so the wording and the branches cannot
 *  drift apart, and so both are covered by the same unit tests. */
export const describeCleanLabel = (label: CleanLabel): string => {
  switch (label.kind) {
    case "clean":
      return "Clean — no lesson sits on a soft-unavailable cell.";
    case "clean-at-floor":
      return `Clean — ${pluralHours(label.pinnedHours)} remain on soft cells. Unpin them and regenerate to go fully clean.`;
    case "not-clean":
      return `Not clean — ${String(label.softHits)} hours sit on soft cells (${String(label.floor)} of them pinned). No clean board was possible for this catalog.`;
    case "unavailable":
      return "Cleanliness could not be determined for this run.";
  }
};

const pluralHours = (count: number): string => `${String(count)} pinned hour${count === 1 ? "" : "s"}`;
