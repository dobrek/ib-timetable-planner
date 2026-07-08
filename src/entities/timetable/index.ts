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
export * from "./model/collision/cell-key";
export * from "./model/collision/collisions";
export * from "./model/collision/cell-occupants";
export * from "./model/collision/intersects";
export * from "./model/collision/constraints";
export * from "./model/perspective";
export * from "./model/perspective-course-list";
export * from "./model/export/sheet-types";
export * from "./model/export/timetable-sheet";
export * from "./model/export/roster-sheet";
// Test-fixture builders travel with the domain; consumer-slice tests import them
// through this barrel so no cross-slice deep import exists.
export * from "./model/__fixtures__/builders";
export * from "./lib/period-breaks";
export * from "./lib/period-times";
export { default as CollisionDetailsDialog, type CollisionInspectionTarget } from "./ui/CollisionDetailsDialog";
