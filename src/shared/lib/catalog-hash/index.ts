// Deep-importable, astro-free module (Vitest rule: never reach it via the
// `@/shared/lib` barrel, which pulls astro-coupled modules).
export { computeCatalogHash } from "./compute-catalog-hash";
export { loadCohortCourses } from "./load-cohort-courses";
export type { CatalogSnapshot, CohortCatalog, ComputeWarning, GroupingCourse } from "./types";
