/**
 * Canonical day/period display labels for the timetable grid — declared-fixed, like
 * the grid presets. Shared by the board grid headers, the collision details dialog,
 * and the teacher-availability authoring grid.
 */
export const dayLabel = (day: number): string => DAY_LABELS[day - 1] ?? `Day ${day}`;

export const periodLabel = (period: number): string => `P${period}`;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
