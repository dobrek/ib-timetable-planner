import { describe, expect, it } from "vitest";
import type { DropHint } from "./drop-hints";
import { resolveCellTone } from "./cell-tone";

const base = { hasBlocking: false, isDropTarget: false, hasWarning: false, hintState: undefined, bundled: false };

describe("resolveCellTone", () => {
  it("returns `base` when every flag is false", () => {
    expect(resolveCellTone(base)).toBe("base");
  });

  describe("precedence", () => {
    it("blocking beats drop-target, hint, warning, and bundled", () => {
      expect(
        resolveCellTone({ hasBlocking: true, isDropTarget: true, hasWarning: true, hintState: "free", bundled: true }),
      ).toBe("blocking");
    });

    it("drop-target beats hint, warning, and bundled", () => {
      expect(resolveCellTone({ ...base, isDropTarget: true, hasWarning: true, hintState: "free", bundled: true })).toBe(
        "drop-target",
      );
    });

    it("hint beats warning and bundled", () => {
      expect(resolveCellTone({ ...base, hasWarning: true, hintState: "free", bundled: true })).toEqual({
        hint: "free",
      });
    });

    it("warning beats bundled", () => {
      expect(resolveCellTone({ ...base, hasWarning: true, bundled: true })).toBe("warning");
    });

    it("bundled wins when only it is set", () => {
      expect(resolveCellTone({ ...base, bundled: true })).toBe("bundled");
    });
  });

  describe("hint value pass-through", () => {
    const hints: (DropHint | "free")[] = ["free", "warn", "opposite-week", "partial", "blocked"];
    for (const hint of hints) {
      it(`carries the \`${hint}\` hint value`, () => {
        expect(resolveCellTone({ ...base, hintState: hint })).toEqual({ hint });
      });
    }
  });
});
