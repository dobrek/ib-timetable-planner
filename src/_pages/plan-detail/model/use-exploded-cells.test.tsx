import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useExplodedCells } from "./use-exploded-cells";

describe("useExplodedCells", () => {
  it("starts all-grouped — every cell reads as not exploded", () => {
    const { result } = renderHook(() => useExplodedCells());
    expect(result.current.isExploded(1, 1)).toBe(false);
    expect(result.current.isExploded(5, 10)).toBe(false);
  });

  it("explodes a currently-bundled cell (ungroup)", () => {
    const { result } = renderHook(() => useExplodedCells());
    act(() => {
      result.current.toggleExploded(2, 3, true);
    });
    expect(result.current.isExploded(2, 3)).toBe(true);
  });

  it("collapses a currently-exploded cell (regroup)", () => {
    const { result } = renderHook(() => useExplodedCells());
    act(() => {
      result.current.toggleExploded(2, 3, true);
    });
    act(() => {
      result.current.toggleExploded(2, 3, false);
    });
    expect(result.current.isExploded(2, 3)).toBe(false);
  });

  it("tracks cells independently", () => {
    const { result } = renderHook(() => useExplodedCells());
    act(() => {
      result.current.toggleExploded(1, 1, true);
    });
    act(() => {
      result.current.toggleExploded(4, 2, true);
    });
    expect(result.current.isExploded(1, 1)).toBe(true);
    expect(result.current.isExploded(4, 2)).toBe(true);
    expect(result.current.isExploded(3, 3)).toBe(false);
  });

  it("is ephemeral — a fresh mount resets to all-grouped (reload returns to the bundled default)", () => {
    const first = renderHook(() => useExplodedCells());
    act(() => {
      first.result.current.toggleExploded(1, 1, true);
    });
    expect(first.result.current.isExploded(1, 1)).toBe(true);

    // A new mount (the reload analogue) seeds its own empty set — no cross-instance persistence.
    const second = renderHook(() => useExplodedCells());
    expect(second.result.current.isExploded(1, 1)).toBe(false);
  });
});
