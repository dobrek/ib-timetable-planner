import { useEffect, useRef, useState } from "react";
import type { GeneratedPlacement, GenerationDiagnostics, GeneratorSnapshot } from "@/entities/timetable";
import { GENERATION_BUDGET_MS, isGenerateWorkerResponse, type GenerateWorkerRequest } from "./worker-protocol";

/**
 * The Generate orchestration hook — the `useRecomputeGroupings` idiom scaled up: busy guard,
 * assemble snapshot → spawn the worker (lazy: the engine loads inside it on first use) → track
 * progress → on a verified `done`, dispatch the Phase 3 `applyGenerated` batch and set the
 * review summary; inline error on failure; cancel posts "Stop & keep" (the engine resolves
 * best-so-far and the normal done path delivers it). The worker is terminated after
 * done/error/unmount. Board edits after a solve dismiss the summary (it reviews THAT board).
 */

export type GenerationRun =
  | { status: "idle" }
  | { status: "solving"; elapsedMs: number; budgetMs: number; cancelRequested: boolean }
  | { status: "applying" };

export type GenerationSummary = {
  diagnostics: GenerationDiagnostics;
  /** Soft teacher-availability warns the verify judge permitted (review context). */
  softWarnCount: number;
};

/**
 * The combined apply outcome. `reason: "stale"` means the apply-time re-verify rejected the result
 * because the board changed under the solve — nothing was applied and the message is the hook's to
 * surface. A plain `{ ok: false }` is an RPC failure the cohort error banners already surfaced.
 */
export type ApplyGeneratedResult = { ok: true } | { ok: false; reason?: "stale" };

export type UseGeneratePlanDeps = {
  /** Assemble the live combined board state into the engine's snapshot (pure, captured at click). */
  assemble: () => GeneratorSnapshot;
  /** The Phase 3 combined apply: apply-time re-verify, one atomic RPC, one two-cohort history entry. */
  applyGenerated: (placements: GeneratedPlacement[]) => Promise<ApplyGeneratedResult>;
  /** True while other board writes are unsettled — Generate participates in the same gating. */
  busy: boolean;
  /** Identity of each cohort's live placements — a change while a summary shows dismisses it. */
  dp1Placements: unknown;
  dp2Placements: unknown;
  /** Injectable for tests; defaults to the Vite module-worker constructor. */
  createWorker?: () => Worker;
};

export type GeneratePlanControls = {
  run: GenerationRun;
  error: string | null;
  summary: GenerationSummary | null;
  generate: () => void;
  cancel: () => void;
  dismissSummary: () => void;
};

export function useGeneratePlan({
  assemble,
  applyGenerated,
  busy,
  dp1Placements,
  dp2Placements,
  createWorker = createGenerateWorker,
}: UseGeneratePlanDeps): GeneratePlanControls {
  const [run, setRun] = useState<GenerationRun>({ status: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<GenerationSummary | null>(null);
  const workerRef = useRef<Worker | null>(null);

  // Dismiss-on-edit: the first effect run after a summary appears records the (post-apply) board
  // identities as the baseline; any later placement-identity change means the board moved on, so
  // the review panel no longer describes it and closes itself.
  const baselineRef = useRef<{ dp1: unknown; dp2: unknown } | null>(null);
  useEffect(() => {
    if (!summary) {
      baselineRef.current = null;
      return;
    }
    const baseline = baselineRef.current;
    if (!baseline) {
      baselineRef.current = { dp1: dp1Placements, dp2: dp2Placements };
      return;
    }
    if (baseline.dp1 !== dp1Placements || baseline.dp2 !== dp2Placements) {
      setSummary(null);
      baselineRef.current = null;
    }
  }, [summary, dp1Placements, dp2Placements]);

  // Unmount safety: a solve in flight dies with the island.
  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  function releaseWorker() {
    workerRef.current?.terminate();
    workerRef.current = null;
  }

  function generate() {
    if (busy || run.status !== "idle" || workerRef.current) return;
    setError(null);
    setSummary(null);
    const snapshot = assemble();
    const worker = createWorker();
    workerRef.current = worker;
    setRun({ status: "solving", elapsedMs: 0, budgetMs: GENERATION_BUDGET_MS, cancelRequested: false });

    worker.onmessage = (event: MessageEvent) => {
      const message: unknown = event.data;
      if (!isGenerateWorkerResponse(message)) return;
      if (message.kind === "progress") {
        setRun((prev) =>
          prev.status === "solving" ? { ...prev, elapsedMs: message.elapsedMs, budgetMs: message.budgetMs } : prev,
        );
        return;
      }
      releaseWorker();
      if (message.kind === "error") {
        setError(`Generation failed: ${message.message}`);
        setRun({ status: "idle" });
        return;
      }
      if (!message.verdict.ok) {
        // The engine's output failed the trust-but-verify judge — nothing touches the board.
        setError("Generation produced an invalid board — nothing was applied");
        setRun({ status: "idle" });
        return;
      }
      setRun({ status: "applying" });
      void applyGenerated(message.result.placements).then((outcome) => {
        if (outcome.ok) {
          setSummary({ diagnostics: message.result.diagnostics, softWarnCount: message.verdict.softWarnCount });
        } else if (outcome.reason === "stale") {
          // The board changed under the solve — the apply-time re-verify rejected it; nothing applied.
          setError("The board changed while generating — nothing was applied. Generate again.");
        }
        // else: an RPC failure the apply already rolled back and surfaced via the cohort error banners.
        setRun({ status: "idle" });
      });
    };
    worker.onerror = () => {
      releaseWorker();
      setError("Generation failed: the worker crashed");
      setRun({ status: "idle" });
    };

    post(worker, { kind: "start", snapshot, config: { budgetMs: GENERATION_BUDGET_MS } });
  }

  function cancel() {
    const worker = workerRef.current;
    if (!worker || run.status !== "solving") return;
    setRun((prev) => (prev.status === "solving" ? { ...prev, cancelRequested: true } : prev));
    post(worker, { kind: "cancel" }); // the engine resolves best-so-far; done arrives normally
  }

  return {
    run,
    error,
    summary,
    generate,
    cancel,
    dismissSummary: () => {
      setSummary(null);
    },
  };
}

const post = (worker: Worker, message: GenerateWorkerRequest): void => {
  worker.postMessage(message);
};

/** The Vite module-worker constructor — the engine (pure TS) loads inside the worker on start. */
const createGenerateWorker = (): Worker =>
  new Worker(new URL("./generate.worker.ts", import.meta.url), { type: "module" });
