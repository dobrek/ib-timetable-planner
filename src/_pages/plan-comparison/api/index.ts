/**
 * The `api` segment's public surface — and, deliberately, **bench's entire contract with `src/`**.
 *
 * `bench/` imports the shared plan loader from HERE (an ESLint `no-restricted-imports` rule scoped to
 * `bench/**` pins that, verified against a deliberate violation). So this barrel is kept
 * *deliberately narrow*: it re-exports `load-plan-analysis` and nothing else.
 *
 * `load-comparison` is NOT re-exported, on purpose. It value-imports `@/entities/timetable` for
 * `analyzePlan`/`verifyGeneration`, and that barrel re-exports `CollisionDetailsDialog` — a React
 * component — so exporting it here would pull all of `shared/ui` into `pnpm analyze:plans`, a Vitest
 * *node* run. The Astro route imports it by direct path instead, exactly as it imports the island by
 * direct path (Astro's FSD exception). Keep it that way: a `export … from "./load-comparison"` line
 * below would silently re-introduce React into the analyzer's module graph.
 */
export {
  loadPlanAnalysis,
  type LoadedPlan,
  type PlanNaturalKeys,
  type PlanWarning,
  type TeacherNaturalKey,
} from "./load-plan-analysis";
