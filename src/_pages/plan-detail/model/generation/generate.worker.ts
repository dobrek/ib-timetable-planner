/// <reference lib="webworker" />
import {
  generatePlanGreedy,
  type GenerationResult,
  type GenerationVerdict,
  type GeneratorConfig,
  type GeneratorSnapshot,
  verifyGeneration,
} from "@/entities/timetable";

/**
 * Worker seat for plan generation (spiked in Phase 2, hardened in Phase 4). The engine and
 * the trust-but-verify judge both run OFF the main thread; the main thread receives a
 * verified result or an error — it never re-runs the engine. Protocol:
 *   main → worker: `start { snapshot, config }` | `cancel`
 *   worker → main: `progress { elapsedMs, budgetMs }` (throttled) |
 *                  `done { result, verdict }` | `error { message }`
 * Cancel aborts the engine's signal; the engine resolves with its best-so-far
 * (`diagnostics.partial: true`) and the normal `done` path delivers it.
 */

export type GenerateWorkerRequest =
  | { kind: "start"; snapshot: GeneratorSnapshot; config: GeneratorConfig }
  | { kind: "cancel" };

export type GenerateWorkerResponse =
  | { kind: "progress"; elapsedMs: number; budgetMs: number }
  | { kind: "done"; result: GenerationResult; verdict: GenerationVerdict }
  | { kind: "error"; message: string };

const PROGRESS_THROTTLE_MS = 250;

const scope = self as unknown as DedicatedWorkerGlobalScope;
let controller: AbortController | null = null;

scope.onmessage = (event: MessageEvent<GenerateWorkerRequest>) => {
  const message = event.data;
  if (message.kind === "cancel") {
    controller?.abort();
    return;
  }
  if (controller) return; // one solve per worker instance — a second start is ignored
  controller = new AbortController();
  void run(message.snapshot, message.config, controller.signal);
};

async function run(snapshot: GeneratorSnapshot, config: GeneratorConfig, signal: AbortSignal): Promise<void> {
  let lastProgressAt = 0;
  try {
    const result = await generatePlanGreedy(snapshot, config, {
      signal,
      onProgress: ({ elapsedMs, budgetMs }) => {
        const at = Date.now();
        if (at - lastProgressAt < PROGRESS_THROTTLE_MS) return;
        lastProgressAt = at;
        post({ kind: "progress", elapsedMs, budgetMs });
      },
    });
    const verdict = verifyGeneration(snapshot, result.placements);
    post({ kind: "done", result, verdict });
  } catch (error) {
    post({ kind: "error", message: error instanceof Error ? error.message : String(error) });
  }
}

const post = (message: GenerateWorkerResponse): void => {
  scope.postMessage(message);
};
