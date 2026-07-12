import type { GeneratePlan, GenerationHooks, GenerationResult, GeneratorConfig, GeneratorSnapshot } from "./types";
import { type GenerationVerdict, verifyGeneration } from "./verify";

/**
 * The trust-but-verify runner seam: precondition → engine → verdict. Every present and future runner
 * (the Web Worker today, a possible HTTP/CLI runner later) calls this instead of re-implementing the
 * fail-fast precondition and the post-solve re-judge, so the engine's index-integrity assumption
 * (conflict-free pins) can never be forgotten. The engine is injected, keeping the seam
 * engine-agnostic; transport concerns (progress throttling, message formatting) stay in the caller.
 */

export type VerifiedGenerationOutcome =
  | { ok: false; reason: "precondition"; verdict: GenerationVerdict }
  | { ok: true; result: GenerationResult; verdict: GenerationVerdict };

export const runVerifiedGeneration = async (
  engine: GeneratePlan,
  snapshot: GeneratorSnapshot,
  config: GeneratorConfig,
  hooks?: GenerationHooks,
): Promise<VerifiedGenerationOutcome> => {
  // Fail-fast precondition: pins alone already carry blocking violations, so no engine result could
  // ever pass verify (pins are never moved) — reject in milliseconds instead of burning the whole
  // budget on a guaranteed dead-end. `verifyGeneration(snapshot, [])` judges the pins-only board.
  const precondition = verifyGeneration(snapshot, []);
  if (!precondition.ok) return { ok: false, reason: "precondition", verdict: precondition };

  const result = await engine(snapshot, config, hooks);
  const verdict = verifyGeneration(snapshot, result.placements);
  return { ok: true, result, verdict };
};
