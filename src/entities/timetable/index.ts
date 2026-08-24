// Public API of the timetable entity: the pure read-side scheduling domain
// (placements, weeks, hours, perspective predicates/course lists, collision
// derivation, availability/cross-cohort indexes) shared by the editing board
// (`_pages/plan-detail`) and the read-only perspective views.
export * from "./model/placement";
export * from "./model/placement-row";
export * from "./model/week";
export * from "./model/course-display";
export * from "./model/hours";
export * from "./model/availability-index";
export * from "./model/cross-cohort-index";
export * from "./model/day-occupancy-index";
export * from "./model/collision/cell-key";
export * from "./model/collision/collisions";
export * from "./model/collision/cell-occupants";
export * from "./model/collision/intersects";
export * from "./model/collision/constraints";
export * from "./model/generation/types";
export * from "./model/generation/assemble-snapshot";
export * from "./model/generation/wire";
export * from "./model/generation/deficits";
export * from "./model/generation/auto-park";
export * from "./model/generation/course-map";
export * from "./model/generation/soft-floor";
export * from "./model/generation/clean-label";
export * from "./model/generation/job-status";
export * from "./model/generation/job-staleness";
export * from "./model/generation/stage-report";
export * from "./model/generation/tier-labels";
export * from "./model/generation/verify";
export * from "./model/generation/occupied-slots";
export * from "./model/generation/objective";
export * from "./model/generation/golden-sets";
export * from "./model/generation/run";
// Only the engine's public surface — not test-only internals (maxWeightCliqueWeight,
// backboneCliques, …), which the slice's own tests import relatively.
export { createGreedyEngine, generatePlanGreedy, type GreedyTuning } from "./model/generation/engines/greedy";
// The read-only plan-quality extractor (feature vector, never a score) — consumed by the
// `analyze:plans` runner and by the in-app comparison surface (`_pages/plan-comparison`) unchanged.
// Only the entry point and its input/output shapes; the per-lens derivations and the lane primitive
// are module internals, imported relatively by the module's own tests.
//
// The feature *sub*-shapes below are exported deliberately, widening the narrowing F7 applied during
// `plan-quality-analyzer` (which had a single terminal consumer and needed no sub-shape in a
// signature). The comparison scoreboard types its props as `CohortFeatures`, `TeacherFeatures`, … —
// naming them here is what keeps `_pages` off deep imports into the entity's internals.
export {
  analyzePlan,
  type AnalyzerCourse,
  type AnalyzerRow,
  type CohortFeatures,
  type CrossCohortFeatures,
  type DayEdgeProfile,
  type Distribution,
  type Extreme,
  type GapExtreme,
  type GoldenCell,
  type GoldenCensusFeatures,
  type MirroredCell,
  type PlanAnalysisInput,
  type PlanQualityFeatures,
  type SubjectRollup,
  type TeacherFeatures,
  type ThinSlot,
} from "./model/analysis";
export * from "./model/perspective";
export * from "./model/perspective-course-list";
export * from "./model/export/sheet-types";
export * from "./model/export/timetable-sheet";
export * from "./model/export/roster-sheet";
export * from "./model/export/perspective-course-sheet";
export * from "./model/export/sheet-name";
export * from "./model/export/perspective-workbook";
// Test-fixture builders travel with the domain; consumer-slice tests import them
// through this barrel so no cross-slice deep import exists.
export * from "./model/__fixtures__/builders";
// The CP-SAT solver seam — the PURE factory only.
//
// Its sibling `api/solver-config.ts` is deliberately NOT re-exported here: it imports
// `astro:env/server`, and this barrel is pulled into the CLIENT bundle — `PlannerBoard.tsx` is a
// `client:load` island (`_pages/plan-detail/ui/PlanDetailPage.astro`) and ~20 more client
// components import it. Astro's env plugin throws `[ServerOnlyModule]` at LOAD time in a client
// build, before tree-shaking could drop the unused export, so a single server-only module in this
// barrel fails `pnpm build` outright.
//
// Everything in this file must therefore stay client-safe. Server-side callers reach the env-gated
// factory at its own path (`@/entities/timetable/api/solver-config`), the same way `createClient`
// in `shared/api` is only ever reached from server code.
export * from "./api/solver-transport";
export * from "./lib/period-breaks";
export * from "./lib/period-times";
export { default as CollisionDetailsDialog, type CollisionInspectionTarget } from "./ui/CollisionDetailsDialog";
