import type { GenerationResult, GenerationVerdict, GeneratorConfig, GeneratorSnapshot } from "@/entities/timetable";

/**
 * The typed message protocol between the board and the generation worker. The worker runs the
 * engine AND the trust-but-verify judge off the main thread; the main thread receives a
 * verified result (or an error) and never re-runs either. Cancel aborts the engine's signal;
 * the engine resolves best-so-far (`diagnostics.partial: true`) and the normal `done` path
 * delivers it — "Stop & keep". The worker is one-shot: terminated after done/error.
 */

/** The production solve budget (~20 s) — the zero-config constant, no picker (author decision). */
export const GENERATION_BUDGET_MS = 20_000;

/** Progress messages are throttled inside the worker so the main thread re-renders coarsely. */
export const PROGRESS_THROTTLE_MS = 250;

export type GenerateWorkerRequest =
  | { kind: "start"; snapshot: GeneratorSnapshot; config: GeneratorConfig }
  | { kind: "cancel" };

export type GenerateWorkerResponse =
  | { kind: "progress"; elapsedMs: number; budgetMs: number }
  | { kind: "done"; result: GenerationResult; verdict: GenerationVerdict }
  | { kind: "error"; message: string };

/** Runtime guard for messages crossing the worker boundary — anything else is ignored. */
export const isGenerateWorkerResponse = (data: unknown): data is GenerateWorkerResponse => {
  if (typeof data !== "object" || data === null || !("kind" in data)) return false;
  const { kind } = data;
  return kind === "progress" || kind === "done" || kind === "error";
};
