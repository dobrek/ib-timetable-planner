import { describe, expect, it } from "vitest";
import type { CellTone } from "../../../model/collision/cell-tone";
import type { DropHint } from "../../../model/drop-hints";
import type { HintMode } from "../../../lib/drag-hint-mode";
import { toneClass } from "./tone-class";

// Strings pinned to the pre-refactor ladder (SlotCell.tsx:124–144 + HINT_CLASS). A typo in the
// hint branch is exactly the silent-ring failure this refactor exists to kill, and it would pass
// every other gate — so it is asserted here by string identity.
describe("toneClass — non-hint tones", () => {
  const cases: [Exclude<CellTone, object>, string][] = [
    ["blocking", "ring-destructive ring-2 ring-inset"],
    ["drop-target", "bg-accent ring-ring ring-2 ring-inset"],
    ["warning", "ring-warning bg-warning/5 ring-2 ring-inset"],
    ["bundled", "ring-ring rounded-md ring-1 ring-inset"],
    ["base", ""],
  ];
  // hintMode is irrelevant for non-hint tones — assert it does not change the mapping.
  for (const [tone, expected] of cases) {
    it(`maps \`${tone}\` regardless of hint mode`, () => {
      expect(toneClass(tone, "dim-blocked")).toBe(expected);
      expect(toneClass(tone, "highlight-free")).toBe(expected);
    });
  }
});

describe("toneClass — hint tone × hint mode", () => {
  const expected: Record<HintMode, Record<DropHint | "free", string>> = {
    "dim-blocked": {
      free: "",
      warn: "bg-warning/10 ring-warning/40 ring-2 ring-inset",
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
  const hints: (DropHint | "free")[] = ["free", "warn", "opposite-week", "partial", "blocked"];
  const modes: HintMode[] = ["dim-blocked", "highlight-free"];

  for (const mode of modes) {
    for (const hint of hints) {
      it(`maps hint \`${hint}\` in \`${mode}\` mode`, () => {
        expect(toneClass({ hint }, mode)).toBe(expected[mode][hint]);
      });
    }
  }
});
