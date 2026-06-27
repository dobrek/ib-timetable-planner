import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_HINT_MODE } from "../../lib/drag-hint-mode";
import type { CellWiring } from "./slot-cell/SlotCellHost";
import { useCellWiring } from "./use-cell-wiring";

// The manual-memo contract: with referentially-stable inputs the bundled wiring object survives a
// re-render (`toBe`), so an idle board does not hand every cell a fresh wiring on each render. A
// fresh-object regression (dropping the memo) fails the fast gate instead of surfacing only as
// manual drag-lag. There is no React Compiler transform, so this stability is load-bearing.
const stableWiring = (): CellWiring => ({
  dropHints: null,
  hintMode: DEFAULT_HINT_MODE,
  isExploded: vi.fn(() => false),
  justDuplicated: null,
  onRemove: vi.fn(),
  onSetWeek: vi.fn(),
  onToggleBundle: vi.fn(),
  onRemoveBundle: vi.fn(),
  onDuplicateBundle: vi.fn(),
  onLiftBundle: vi.fn(),
  onInspect: vi.fn(),
});

describe("useCellWiring", () => {
  it("returns the SAME object across a re-render when every input is referentially stable", () => {
    const inputs = stableWiring();
    const { result, rerender } = renderHook(({ w }) => useCellWiring(w), { initialProps: { w: inputs } });
    const first = result.current;
    // A NEW wrapper object but identical field references — the memo must hold.
    rerender({ w: { ...inputs } });
    expect(result.current).toBe(first);
  });

  it("returns a NEW object when a single input changes (e.g. a drag tick updates dropHints)", () => {
    const inputs = stableWiring();
    const { result, rerender } = renderHook(({ w }) => useCellWiring(w), { initialProps: { w: inputs } });
    const first = result.current;
    rerender({ w: { ...inputs, dropHints: new Map() } });
    expect(result.current).not.toBe(first);
  });

  it("forwards every field unchanged onto the bundled object", () => {
    const inputs = stableWiring();
    const { result } = renderHook(() => useCellWiring(inputs));
    expect(result.current).toEqual(inputs);
  });
});
