const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DAY_MIN = 1;
const DAY_MAX = 5;
const PERIOD_MIN = 1;
const PERIOD_MAX = 10;

/** A validated create-placement request, ready to hand to a typed insert. */
export type PlacementInsert = {
  variantId: string;
  cohortId: string;
  courseId: string;
  day: number;
  period: number;
};

export type PlacementValidation = { ok: true; row: PlacementInsert } | { ok: false; error: string };

/** A validated delete-placement request. */
export type PlacementDeleteValidation = { ok: true; id: string } | { ok: false; error: string };

/**
 * Pure request-shape validation for `POST /api/placements`. Checks the three UUIDs
 * and the grid bounds (day 1–5, period 1–10) without touching Supabase or `Request`,
 * so the route can validate after `request.json()` and the rules stay unit-testable.
 */
export const validatePlacementInsert = (input: unknown): PlacementValidation => {
  if (!isRecord(input)) return fail("Request body must be an object");

  const { variantId, cohortId, courseId, day, period } = input;

  if (!isUuid(variantId)) return fail("variantId is required and must be a UUID");
  if (!isUuid(cohortId)) return fail("cohortId is required and must be a UUID");
  if (!isUuid(courseId)) return fail("courseId is required and must be a UUID");
  if (!isInRange(day, DAY_MIN, DAY_MAX)) return fail(`day must be an integer in ${DAY_MIN}..${DAY_MAX}`);
  if (!isInRange(period, PERIOD_MIN, PERIOD_MAX))
    return fail(`period must be an integer in ${PERIOD_MIN}..${PERIOD_MAX}`);

  return { ok: true, row: { variantId, cohortId, courseId, day, period } };
};

/** Pure request-shape validation for `DELETE /api/placements` — a single row id. */
export const validatePlacementDelete = (input: unknown): PlacementDeleteValidation => {
  if (!isRecord(input)) return fail("Request body must be an object");
  if (!isUuid(input.id)) return fail("id is required and must be a UUID");
  return { ok: true, id: input.id };
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

const isUuid = (value: unknown): value is string => typeof value === "string" && UUID_RE.test(value);

const isInRange = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

const fail = (error: string): { ok: false; error: string } => ({ ok: false, error });
