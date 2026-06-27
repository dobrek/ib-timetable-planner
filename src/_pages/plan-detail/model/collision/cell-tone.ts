import type { DropHint } from "../drop-hints";

/**
 * The single visual tone a slot cell resolves to. A cell has exactly one tone — the highest
 * priority among the booleans that drive it — so co-occurring states can never fight over the
 * same Tailwind ring custom property. The `hint` case carries its `DropHint | "free"` value so
 * the class table can pick the per-mode treatment.
 */
export type CellTone = "blocking" | "drop-target" | { hint: DropHint | "free" } | "warning" | "bundled" | "base";

/**
 * Resolve a cell's visual tone from the booleans that previously drove the negated-class ladder.
 * Precedence lives here, once, ordered and exhaustive: blocking → drop-target → hint → warning →
 * bundled → base. The opacity axis (`isDragging`, hint opacities) is deliberately NOT part of
 * tone — it composes separately in the component so a dragging cell can dim independent of tone.
 */
export function resolveCellTone(s: {
  hasBlocking: boolean;
  isDropTarget: boolean;
  hasWarning: boolean;
  hintState: DropHint | "free" | undefined;
  bundled: boolean;
}): CellTone {
  if (s.hasBlocking) return "blocking";
  if (s.isDropTarget) return "drop-target";
  if (s.hintState) return { hint: s.hintState };
  if (s.hasWarning) return "warning";
  if (s.bundled) return "bundled";
  return "base";
}
