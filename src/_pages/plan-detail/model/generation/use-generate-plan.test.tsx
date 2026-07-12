import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  GenerationDiagnostics,
  GenerationResult,
  GenerationVerdict,
  GeneratorSnapshot,
} from "@/entities/timetable";
import { GENERATION_BUDGET_MS } from "./worker-protocol";
import { useGeneratePlan, type UseGeneratePlanDeps } from "./use-generate-plan";

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) {
    this.posted.push(message);
  }
  terminate() {
    this.terminated = true;
  }
  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

const SNAPSHOT = { days: 5, periods: 10 } as unknown as GeneratorSnapshot;

const diagnostics: GenerationDiagnostics = {
  engine: "greedy",
  elapsedMs: 1234,
  partial: false,
  cohorts: {
    dp1: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 10, unplaced: [] },
    dp2: { occupiedSlotsBefore: 0, occupiedSlotsAfter: 9, unplaced: [] },
  },
};
const result: GenerationResult = {
  placements: [{ cohort: "dp1", courseId: "math", day: 1, period: 1, week: "both" }],
  diagnostics,
};
const okVerdict: GenerationVerdict = { ok: true, reasons: [], softWarnCount: 2 };

function setup(over: Partial<UseGeneratePlanDeps> = {}) {
  const worker = new FakeWorker();
  const applyGenerated = vi.fn().mockResolvedValue({ ok: true });
  const deps: UseGeneratePlanDeps = {
    assemble: () => SNAPSHOT,
    applyGenerated,
    busy: false,
    dp1Placements: [],
    dp2Placements: [],
    createWorker: () => worker as unknown as Worker,
    ...over,
  };
  const view = renderHook((props: UseGeneratePlanDeps) => useGeneratePlan(props), { initialProps: deps });
  return { worker, applyGenerated, deps, ...view };
}

describe("useGeneratePlan", () => {
  it("posts start with the snapshot and budget, and tracks progress", () => {
    const { worker, result: hook } = setup();

    act(() => {
      hook.current.generate();
    });

    expect(worker.posted).toEqual([{ kind: "start", snapshot: SNAPSHOT, config: { budgetMs: GENERATION_BUDGET_MS } }]);
    expect(hook.current.run).toMatchObject({ status: "solving", elapsedMs: 0 });

    act(() => {
      worker.emit({ kind: "progress", elapsedMs: 5000, budgetMs: GENERATION_BUDGET_MS });
    });
    expect(hook.current.run).toMatchObject({ status: "solving", elapsedMs: 5000 });
  });

  it("applies a verified done, sets the summary, and terminates the worker", async () => {
    const { worker, applyGenerated, result: hook } = setup();
    act(() => {
      hook.current.generate();
    });

    act(() => {
      worker.emit({ kind: "done", result, verdict: okVerdict });
    });

    expect(hook.current.run).toEqual({ status: "applying" });
    expect(applyGenerated).toHaveBeenCalledExactlyOnceWith(result.placements);
    await waitFor(() => {
      expect(hook.current.summary).toEqual({ diagnostics, softWarnCount: 2 });
    });
    expect(hook.current.run).toEqual({ status: "idle" });
    expect(worker.terminated).toBe(true);
  });

  it("rejects an unverified done wholesale — nothing is applied", async () => {
    const { worker, applyGenerated, result: hook } = setup();
    act(() => {
      hook.current.generate();
    });

    act(() => {
      worker.emit({ kind: "done", result, verdict: { ok: false, reasons: ["bad"], softWarnCount: 0 } });
    });

    await waitFor(() => {
      expect(hook.current.error).toMatch(/invalid board/);
    });
    expect(applyGenerated).not.toHaveBeenCalled();
    expect(hook.current.run).toEqual({ status: "idle" });
  });

  it("surfaces the apply-time re-verify rejection (board changed under the solve) and sets no summary", async () => {
    const applyGenerated = vi.fn().mockResolvedValue({ ok: false, reason: "stale" });
    const { worker, result: hook } = setup({ applyGenerated });
    act(() => {
      hook.current.generate();
    });

    act(() => {
      worker.emit({ kind: "done", result, verdict: okVerdict });
    });

    expect(applyGenerated).toHaveBeenCalledExactlyOnceWith(result.placements);
    await waitFor(() => {
      expect(hook.current.error).toMatch(/board changed while generating/i);
    });
    expect(hook.current.summary).toBeNull();
    expect(hook.current.run).toEqual({ status: "idle" });
  });

  it("surfaces the fail-fast precondition error inline and returns to idle", async () => {
    const { worker, applyGenerated, result: hook } = setup();
    act(() => {
      hook.current.generate();
    });

    act(() => {
      worker.emit({
        kind: "error",
        message: "the board already has blocking violations — resolve them before generating",
      });
    });

    await waitFor(() => {
      expect(hook.current.error).toMatch(/blocking violations/);
    });
    expect(applyGenerated).not.toHaveBeenCalled();
    expect(hook.current.run).toEqual({ status: "idle" });
    expect(worker.terminated).toBe(true);
  });

  it("surfaces worker errors inline and returns to idle", async () => {
    const { worker, result: hook } = setup();
    act(() => {
      hook.current.generate();
    });

    act(() => {
      worker.emit({ kind: "error", message: "boom" });
    });

    await waitFor(() => {
      expect(hook.current.error).toBe("Generation failed: boom");
    });
    expect(hook.current.run).toEqual({ status: "idle" });
    expect(worker.terminated).toBe(true);
  });

  it("cancel posts Stop & keep and marks the run; done still applies best-so-far", () => {
    const { worker, result: hook } = setup();
    act(() => {
      hook.current.generate();
    });

    act(() => {
      hook.current.cancel();
    });

    expect(worker.posted).toContainEqual({ kind: "cancel" });
    expect(hook.current.run).toMatchObject({ status: "solving", cancelRequested: true });
  });

  it("is a no-op while other writes are busy", () => {
    const { worker, result: hook } = setup({ busy: true });

    act(() => {
      hook.current.generate();
    });

    expect(worker.posted).toEqual([]);
    expect(hook.current.run).toEqual({ status: "idle" });
  });

  it("dismisses the summary on the next board edit", async () => {
    const { worker, deps, result: hook, rerender } = setup();
    act(() => {
      hook.current.generate();
    });
    act(() => {
      worker.emit({ kind: "done", result, verdict: okVerdict });
    });
    await waitFor(() => {
      expect(hook.current.summary).not.toBeNull();
    });

    rerender({ ...deps, dp1Placements: ["changed"] });

    await waitFor(() => {
      expect(hook.current.summary).toBeNull();
    });
  });
});
