// Scenario-factory harness for integration suites: own a plan, seed the real
// CSV-derived catalog, build advanced input + computed output, and tear down.
// Barrel only — one concept file per builder.
export { createPlan, type CreatePlanOptions } from "./create-plan";
export { seedPlanCatalog, type SeededCatalog } from "./seed-plan-catalog";
export { addAvailability, type AddAvailabilityInput } from "./add-availability";
export { addCourse, type AddCourseInput } from "./add-course";
export { addMerge, type AddMergeInput } from "./add-merge";
export { addOverlap, type AddOverlapInput } from "./add-overlap";
export { addTeacher, type AddTeacherInput } from "./add-teacher";
export { addStudentWithChoices, type AddStudentWithChoicesInput } from "./add-student-with-choices";
export { placeCourse } from "./place-course";
export { computeGroupingsFor } from "./compute-groupings-for";
export { registerPlan, teardown } from "./teardown";
