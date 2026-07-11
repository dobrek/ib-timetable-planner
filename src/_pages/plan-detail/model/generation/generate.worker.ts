/// <reference lib="webworker" />
import {
  generatePlanGreedy,
  type GeneratorConfig,
  type GeneratorSnapshot,
  verifyGeneration,
} from "@/entities/timetable";
import { type GenerateWorkerRequest, type GenerateWorkerResponse, PROGRESS_THROTTLE_MS } from "./worker-protocol";

/**
 * Worker seat for plan generation (spiked in Phase 2, hardened in Phase 4 — the protocol
 * lives in `worker-protocol.ts`). The engine and the trust-but-verify judge both run OFF the
 * main thread; the main thread receives a verified result or an error — it never re-runs the
 * engine. One solve per worker instance; the owner terminates it after done/error.
 */

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
  // Fail-fast precondition: pins alone already carry blocking violations, so no engine result
  // can ever pass verify (pins are never moved) — reject in milliseconds instead of burning the
  // full budget on a guaranteed dead-end. `verifyGeneration(snapshot, [])` judges the pins-only
  // board; the hook renders the message over the existing `error` path (no protocol change).
  const precondition = verifyGeneration(snapshot, []);
  if (!precondition.ok) {
    post({ kind: "error", message: "the board already has blocking violations — resolve them before generating" });
    return;
  }

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
