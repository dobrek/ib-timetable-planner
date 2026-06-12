/** Day/period display labels, shared by the grid headers and the collision details dialog. */
export const dayLabel = (day: number): string => DAY_LABELS[day - 1] ?? `Day ${day}`;

export const periodLabel = (period: number): string => `P${period}`;

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
