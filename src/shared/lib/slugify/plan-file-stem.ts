import { slugify } from "./slugify";

/**
 * The plan's part of every export file name: the slugged plan name, plus `-current` while the plan is
 * the current one (S-405). The workbooks carry no title row, so the file name is the only place an
 * export can say it came from the current plan. One home because four builders name exports across
 * two layers — the board's view and batch exports and the student view (`_pages`), and the perspective
 * workbook (`entities/timetable`) — and all four must agree.
 *
 * The marker is a snapshot of the moment of export: a file saved while the plan was current keeps the
 * name after the marker moves, which is honest, since it was current when exported.
 */
export const planFileStem = (planName: string, isCurrent: boolean): string =>
  isCurrent ? `${slugify(planName)}-current` : slugify(planName);
