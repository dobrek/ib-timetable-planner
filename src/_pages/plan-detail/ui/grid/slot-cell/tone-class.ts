import type { CellTone } from "../../../model/collision/cell-tone";
import type { DropHint } from "../../../model/drop-hints";
import type { HintMode } from "../../../lib/drag-hint-mode";

/**
 * The single `CellTone → Tailwind` lookup, replacing the negated-class ladder. Precedence is
 * already decided by `resolveCellTone`; this only maps the chosen tone to its ring/bg classes.
 * The `hint` case indexes the per-mode `HINT_CLASS` table below.
 */
export function toneClass(tone: CellTone, hintMode: HintMode): string {
  if (typeof tone === "object") return HINT_CLASS[hintMode][tone.hint];
  switch (tone) {
    case "blocking":
      return "ring-destructive ring-2 ring-inset";
    case "drop-target":
      return "bg-accent ring-ring ring-2 ring-inset";
    case "warning":
      return "ring-warning bg-warning/5 ring-2 ring-inset";
    case "bundled":
      return "ring-ring rounded-md ring-1 ring-inset";
    case "base":
      return "";
  }
}

/**
 * Per-mode cell treatment for each hint state, token-driven (`--valid`, `--warning`,
 * `--muted`). The derivation is encoding-agnostic — only this table decides which side gets
 * visual ink: `dim-blocked` recedes blocked/partial and leaves free neutral; `highlight-free`
 * tints free with `--valid` and leaves blocked neutral. `warn` (soft-NO, a valid-but-advisory
 * drop) always reads amber, never dimmed. Empty strings are no-ops in `cn`.
 */
const HINT_CLASS: Record<HintMode, Record<DropHint | "free", string>> = {
  "dim-blocked": {
    free: "",
    warn: "bg-warning/10 ring-warning/40 ring-2 ring-inset",
    // A legal opposite-week share — never dimmed; a distinct primary ring marks "needs A/B".
    "opposite-week": "bg-primary/5 ring-primary/50 ring-2 ring-inset",
    partial: "bg-muted/60 opacity-70",
    blocked: "bg-muted opacity-40",
  },
  "highlight-free": {
    free: "bg-valid/10 ring-valid ring-2 ring-inset",
    warn: "bg-warning/10 ring-warning/50 ring-2 ring-inset",
    "opposite-week": "bg-primary/10 ring-primary/60 ring-2 ring-inset",
    partial: "bg-valid/5 ring-valid/40 ring-2 ring-inset",
    blocked: "",
  },
};
