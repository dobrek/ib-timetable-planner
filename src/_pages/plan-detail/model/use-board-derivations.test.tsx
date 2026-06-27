import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_AVAILABILITY_INDEX } from "./cross-cohort/availability-index";
import { catalog as buildCatalog, course, placement } from "./__fixtures__/builders";
import { cellKey } from "./collision/cell-key";
import { EMPTY_CROSS_COHORT_INDEX } from "./cross-cohort/cross-cohort-index";
import type { CourseDrag } from "./drag";
import type { CellData } from "./drag";
import { useCatalogById, useCollisions, useDragHints, useDuplicateHighlight, useHours } from "./use-board-derivations";

// Characterizes the shared per-cohort derivation hooks the assembler routes through, before Phase 5
// makes both boards consume them from one place. Two contracts are pinned per hook: the derived
// OUTPUT for fixed inputs, and REFERENTIAL STABILITY across a re-render with the same input refs
// (the manual-memo guarantee — there is no React Compiler transform, so a fresh object each render
// would silently re-render every cell consumer against the <200ms drag budget).

// Two same-teacher courses → a teacher conflict whenever both share a cell+week.
const CATALOG = [course("c1", "t1"), course("c2", "t1"), course("c3", "t2")];
const CATALOG_BY_ID = buildCatalog(...CATALOG);

describe("useCatalogById", () => {
  it("keys the catalog by course id", () => {
    const { result } = renderHook(() => useCatalogById(CATALOG));
    expect(result.current.get("c1")).toBe(CATALOG[0]);
    expect(result.current.size).toBe(3);
  });

  it("is referentially stable across a re-render with the same catalog ref", () => {
    const { result, rerender } = renderHook(() => useCatalogById(CATALOG));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useCollisions", () => {
  const placements = [placement("p1", "c1", 1, 1), placement("p2", "c2", 1, 1)];

  it("flags the shared-teacher conflict at the occupied cell", () => {
    const { result } = renderHook(() =>
      useCollisions(placements, CATALOG_BY_ID, EMPTY_AVAILABILITY_INDEX, EMPTY_CROSS_COHORT_INDEX),
    );
    expect(result.current.has(cellKey(1, 1))).toBe(true);
  });

  it("is referentially stable across a re-render with the same inputs", () => {
    const { result, rerender } = renderHook(() =>
      useCollisions(placements, CATALOG_BY_ID, EMPTY_AVAILABILITY_INDEX, EMPTY_CROSS_COHORT_INDEX),
    );
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe("useHours", () => {
  const placements = [placement("p1", "c1", 1, 1)];

  it("derives hours and the incomplete-course count", () => {
    const { result } = renderHook(() => useHours(placements, CATALOG));
    // c1 has 4 hours but only one period placed → incomplete; c2/c3 unplaced → also incomplete.
    expect(result.current.incompleteCount).toBeGreaterThan(0);
  });

  it("keeps both derived values referentially stable across a re-render", () => {
    const { result, rerender } = renderHook(() => useHours(placements, CATALOG));
    const first = result.current.hours;
    rerender();
    expect(result.current.hours).toBe(first);
  });
});

describe("useDragHints", () => {
  const placements = [placement("p1", "c1", 1, 1)];

  it("yields no hint map while idle, then a sparse map once a drag starts", () => {
    const { result } = renderHook(() =>
      useDragHints(CATALOG_BY_ID, placements, [], EMPTY_AVAILABILITY_INDEX, EMPTY_CROSS_COHORT_INDEX),
    );
    expect(result.current.dropHints).toBeNull();

    // Drag a same-teacher course → its only legal-conflict cell is the occupied (1,1) → blocked.
    const drag: CourseDrag = { kind: "course", courseId: "c2" };
    act(() => {
      result.current.startDragHints(drag);
    });
    expect(result.current.dropHints?.get(cellKey(1, 1))).toBe("blocked");

    act(() => {
      result.current.clearDragHints();
    });
    expect(result.current.dropHints).toBeNull();
  });

  it("keeps the idle hint map referentially stable across a re-render", () => {
    const { result, rerender } = renderHook(() =>
      useDragHints(CATALOG_BY_ID, placements, [], EMPTY_AVAILABILITY_INDEX, EMPTY_CROSS_COHORT_INDEX),
    );
    const first = result.current.dropHints;
    rerender();
    expect(result.current.dropHints).toBe(first);
  });
});

describe("useDuplicateHighlight", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const highlight: CellData & { nonce: number } = { day: 2, period: 3, nonce: 1 };

  it("returns null when nothing was just duplicated", () => {
    const { result } = renderHook(() => useDuplicateHighlight(null));
    expect(result.current).toBeNull();
  });

  it("surfaces the highlight, then self-clears after the timeout", () => {
    const { result } = renderHook(() => useDuplicateHighlight(highlight));
    expect(result.current).toBe(highlight);
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(result.current).toBeNull();
  });
});
