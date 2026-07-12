// The greedy engine's public surface. The search driver, problem projection, mutable board, and
// stages are split across sibling files; only the engine factory and its default instance are
// public. Test-only seams (maxWeightCliqueWeight, backboneCliques, the stages) are imported
// relatively by the slice's own tests, never re-exported app-wide.
export { createGreedyEngine, generatePlanGreedy, type GreedyTuning } from "./search";
