import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Cohort } from "@/shared/config";
import type { AffectedScope, AffectedSlice } from "./history-entry";
import { useHistoryControls, useHistoryRecorder, type CohortHistoryApi } from "./use-history";

// Drives the plan-level orchestration over a FAKE per-cohort board: `snapshot` reads a mutable
// slice, `applyReconcile` writes it (and can fail once). This exercises undo/redo, multi-step,
// cross-cohort interleaving, redo-invalidation, commit-on-success, the before-only-snapshot, and
// the in-flight guard — without the real `usePlacements`/RPC machinery.

const SCOPE: AffectedScope = { cells: ["1:1"], cardSets: [] };
const emptySlice = (): AffectedSlice => ({ placements: [], cards: [] });
const sliceOf = (id: string): AffectedSlice => ({
  placements: [{ id, courseId: id, day: 1, period: 1, week: "both" }],
  cards: [],
});

function makeApis(busy = false) {
  const board: Record<Cohort, AffectedSlice> = { dp1: emptySlice(), dp2: emptySlice() };
  const failOnce: Record<Cohort, boolean> = { dp1: false, dp2: false };
  const make = (cohort: Cohort): CohortHistoryApi => ({
    busy,
    snapshot: () => board[cohort],
    applyReconcile: vi.fn((target: AffectedSlice) => {
      if (failOnce[cohort]) {
        failOnce[cohort] = false;
        return Promise.resolve({ ok: false });
      }
      board[cohort] = target;
      return Promise.resolve({ ok: true });
    }),
  });
  const apis: Record<Cohort, CohortHistoryApi> = { dp1: make("dp1"), dp2: make("dp2") };
  return { apis, board, failOnce };
}

function setup(apis: Record<Cohort, CohortHistoryApi>) {
  return renderHook(() => {
    const recorder = useHistoryRecorder();
    const controls = useHistoryControls(recorder.store, apis);
    return { record: recorder.record, ...controls };
  });
}

type Harness = ReturnType<typeof setup>["result"];

function edit(
  result: Harness,
  board: Record<Cohort, AffectedSlice>,
  cohort: Cohort,
  next: AffectedSlice,
  label: string,
) {
  act(() => {
    const before = board[cohort];
    board[cohort] = next;
    result.current.record(cohort, { scope: SCOPE, target: before, label });
  });
}

describe("undo / redo — single step", () => {
  it("undo restores the before-state; redo re-applies it", async () => {
    const { apis, board } = makeApis();
    const { result } = setup(apis);
    const S1 = sliceOf("c1");
    edit(result, board, "dp1", S1, "place c1");
    expect(result.current.canUndo).toBe(true);
    expect(result.current.undoLabel).toBe("place c1");

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(emptySlice());
    });
    await waitFor(() => {
      expect(result.current.canRedo).toBe(true);
    });
    expect(result.current.canUndo).toBe(false);
    expect(result.current.redoLabel).toBe("place c1");

    act(() => {
      result.current.redo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(S1);
    });
    await waitFor(() => {
      expect(result.current.canUndo).toBe(true);
    });
    expect(result.current.canRedo).toBe(false);
  });
});

describe("undo / redo — multi-step", () => {
  it("walks a 3-edit history back and forward", async () => {
    const { apis, board } = makeApis();
    const { result } = setup(apis);
    const [S1, S2, S3] = [sliceOf("a"), sliceOf("b"), sliceOf("c")];
    edit(result, board, "dp1", S1, "e1");
    edit(result, board, "dp1", S2, "e2");
    edit(result, board, "dp1", S3, "e3");

    for (const expected of [S2, S1, emptySlice()]) {
      act(() => {
        result.current.undo();
      });
      await waitFor(() => {
        expect(board.dp1).toEqual(expected);
      });
    }
    expect(result.current.canUndo).toBe(false);
    expect(result.current.canRedo).toBe(true);

    for (const expected of [S1, S2, S3]) {
      act(() => {
        result.current.redo();
      });
      await waitFor(() => {
        expect(board.dp1).toEqual(expected);
      });
    }
    expect(result.current.canRedo).toBe(false);
  });
});

describe("cross-cohort interleaving", () => {
  it("undo unwinds the most recent cohort first (dp2 then dp1)", async () => {
    const { apis, board } = makeApis();
    const { result } = setup(apis);
    edit(result, board, "dp1", sliceOf("a"), "e-dp1");
    edit(result, board, "dp2", sliceOf("b"), "e-dp2");

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp2).toEqual(emptySlice());
    });
    expect(board.dp1).toEqual(sliceOf("a")); // dp1 untouched
    await waitFor(() => {
      expect(result.current.undoLabel).toBe("e-dp1");
    });

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(emptySlice());
    });
  });
});

describe("redo invalidation", () => {
  it("a fresh edit clears the redo stack", async () => {
    const { apis, board } = makeApis();
    const { result } = setup(apis);
    edit(result, board, "dp1", sliceOf("a"), "e1");
    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(result.current.canRedo).toBe(true);
    });

    edit(result, board, "dp1", sliceOf("b"), "e2");
    expect(result.current.canRedo).toBe(false);
  });
});

describe("commit-on-success", () => {
  it("a failed reconcile leaves both stacks untouched; retry converges", async () => {
    const { apis, board, failOnce } = makeApis();
    const { result } = setup(apis);
    const S1 = sliceOf("a");
    edit(result, board, "dp1", S1, "e1");

    failOnce.dp1 = true;
    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(apis.dp1.applyReconcile).toHaveBeenCalledTimes(1);
    });
    expect(board.dp1).toEqual(S1); // unchanged — the fake did not write on failure
    expect(result.current.canUndo).toBe(true);
    expect(result.current.canRedo).toBe(false);

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(emptySlice());
    });
    expect(result.current.canRedo).toBe(true);
  });
});

describe("before-only snapshot", () => {
  it("editing the same cell twice undoes through the intermediate to the original", async () => {
    const { apis, board } = makeApis();
    const { result } = setup(apis);
    const [S1, S2] = [sliceOf("a"), sliceOf("b")];
    edit(result, board, "dp1", S1, "e1"); // before = S0
    edit(result, board, "dp1", S2, "e2"); // before = S1

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(S1); // intermediate
    });
    await waitFor(() => {
      expect(result.current.undoLabel).toBe("e1");
    });

    act(() => {
      result.current.undo();
    });
    await waitFor(() => {
      expect(board.dp1).toEqual(emptySlice()); // original — e1 carried the pre-edit-1 slice
    });
  });
});

describe("in-flight guard", () => {
  it("undo/redo are no-ops and canUndo/canRedo are false while busy", () => {
    const { apis, board } = makeApis(true);
    const { result } = setup(apis);
    edit(result, board, "dp1", sliceOf("a"), "e1");

    expect(result.current.canUndo).toBe(false);
    act(() => {
      result.current.undo();
    });
    expect(apis.dp1.applyReconcile).not.toHaveBeenCalled();
  });
});
