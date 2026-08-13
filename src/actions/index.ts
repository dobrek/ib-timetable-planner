import { getSolverTransport } from "@/entities/timetable/api/solver-config";
import { courseActions } from "@/_pages/courses/api";
import { createGenerationActions, groupingActions, placementActions, shelfActions } from "@/_pages/plan-detail/api";
import { planActions } from "@/_pages/plans-list/api";
import { studentActions } from "@/_pages/students/api";
import { teacherActions } from "@/_pages/teachers/api";

/**
 * The Actions composition root — and, since S-301, the place environment-bound dependencies are
 * resolved and injected into the slices that need them.
 *
 * `getSolverTransport` reads `astro:env/server`. No `_pages` or `entities` module may reach it:
 * importing `@/entities/timetable/api/solver-config` from a slice is a public-API sidestep that
 * `pnpm steiger` fails on, and re-exporting it from the entity barrel would drag a server-only
 * virtual module into every React island that imports `@/entities/timetable`. This file is outside
 * the FSD graph, runs server-side only, and is already where slice actions are composed — so it is
 * the one place that can hold both halves.
 */
export const server = {
  ...courseActions,
  ...teacherActions,
  ...studentActions,
  ...placementActions,
  ...shelfActions,
  ...groupingActions,
  ...planActions,
  ...createGenerationActions({ getTransport: getSolverTransport }),
};
