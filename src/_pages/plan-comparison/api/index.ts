// The `api` segment's public surface. `bench/` imports the loader from HERE, never from the slice
// root — the root barrel re-exports `ui/`, and dragging React into `pnpm analyze:plans` (a Vitest
// *node* run) would break it. An ESLint `no-restricted-imports` rule scoped to `bench/**` pins that.
export {
  loadPlanAnalysis,
  type LoadedPlan,
  type PlanNaturalKeys,
  type PlanWarning,
  type TeacherNaturalKey,
} from "./load-plan-analysis";
