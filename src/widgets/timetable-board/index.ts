// Public API of the timetable-board widget: the composed read-only board UI shared by
// the perspective views (`_pages/teacher-plan-view`, `_pages/student-plan-view`) — the
// static schedule grid and the per-course card list. Persona-specific derivations (which
// occupants, which rosters, which decorations) stay in the page slices; this layer only
// renders what it is given.
export { default as ScheduleGrid, type GridOccupant } from "./ui/ScheduleGrid";
export { default as PerspectiveCourseList, type PerspectiveCard } from "./ui/PerspectiveCourseList";
export type { CourseInfo } from "./model/course-info";
