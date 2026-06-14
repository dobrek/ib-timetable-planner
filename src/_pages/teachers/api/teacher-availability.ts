import { z } from "zod";
import type { SupabaseClient } from "@/shared/api";
import { availabilitySeveritySchema, GRID_BOUNDS } from "@/shared/config";
import { DomainError } from "@/shared/lib/errors";

/**
 * Teacher-availability persistence: tri-state per-cell edits (set a severity / clear a
 * cell) plus a whole-column bulk op. Schemas + framework-free domain functions co-located
 * like `plan-detail/api/slot-bundles.ts` (the marker-table template). Every write carries
 * `planId` + `teacherId`; the composite FK pins both to a real plan teacher.
 *
 * Storage severity is `strong`/`soft` here — the board's `block`/`warn` render vocabulary
 * is a separate concern mapped only in the validator.
 */

const ON_CONFLICT = "plan_id,teacher_id,day,period";

const cellCoordinate = {
  planId: z.uuid(),
  teacherId: z.uuid(),
  day: z.int().min(1).max(GRID_BOUNDS.maxDays),
  period: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
};

export const setAvailabilityCellInput = z.object({
  ...cellCoordinate,
  severity: availabilitySeveritySchema,
});

export const clearAvailabilityCellInput = z.object(cellCoordinate);

export const setAvailabilityColumnInput = z.object({
  planId: z.uuid(),
  teacherId: z.uuid(),
  day: z.int().min(1).max(GRID_BOUNDS.maxDays),
  /** How many periods the plan's grid has — the column spans periods 1..periods. */
  periods: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
  /** A severity sets every period in the column; `null` clears the whole column. */
  severity: availabilitySeveritySchema.nullable(),
});

export const setAvailabilityRowInput = z.object({
  planId: z.uuid(),
  teacherId: z.uuid(),
  period: z.int().min(1).max(GRID_BOUNDS.maxPeriods),
  /** How many days the plan's grid has — the row spans days 1..days. */
  days: z.int().min(1).max(GRID_BOUNDS.maxDays),
  /** A severity sets every day in the row; `null` clears the whole row. */
  severity: availabilitySeveritySchema.nullable(),
});

export type SetAvailabilityCellInput = z.infer<typeof setAvailabilityCellInput>;
export type ClearAvailabilityCellInput = z.infer<typeof clearAvailabilityCellInput>;
export type SetAvailabilityColumnInput = z.infer<typeof setAvailabilityColumnInput>;
export type SetAvailabilityRowInput = z.infer<typeof setAvailabilityRowInput>;

type Supabase = SupabaseClient;

/** Set one cell's severity. Upserts on the unique coordinate, so it overwrites in place. */
export const setCell = async (supabase: Supabase, input: SetAvailabilityCellInput): Promise<void> => {
  const { planId, teacherId, day, period, severity } = input;
  const { error } = await supabase
    .from("teacher_availability")
    .upsert({ plan_id: planId, teacher_id: teacherId, day, period, severity }, { onConflict: ON_CONFLICT });
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to set availability cell: ${error.message}`);
  }
};

/** Clear one cell by coordinate. No-op when the cell is already available (no row). */
export const clearCell = async (supabase: Supabase, input: ClearAvailabilityCellInput): Promise<void> => {
  const { planId, teacherId, day, period } = input;
  const { error } = await supabase
    .from("teacher_availability")
    .delete()
    .eq("plan_id", planId)
    .eq("teacher_id", teacherId)
    .eq("day", day)
    .eq("period", period);
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to clear availability cell: ${error.message}`);
  }
};

/**
 * Bulk-set a whole day column for a teacher in one round-trip: a severity upserts every
 * period 1..periods; `null` deletes the column. Whole-day authoring convenience on top
 * of per-cell editing.
 */
export const setColumn = async (supabase: Supabase, input: SetAvailabilityColumnInput): Promise<void> => {
  const { planId, teacherId, day, periods, severity } = input;

  if (severity === null) {
    const { error } = await supabase
      .from("teacher_availability")
      .delete()
      .eq("plan_id", planId)
      .eq("teacher_id", teacherId)
      .eq("day", day);
    if (error) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to clear availability column: ${error.message}`);
    }
    return;
  }

  const rows = Array.from({ length: periods }, (_, index) => ({
    plan_id: planId,
    teacher_id: teacherId,
    day,
    period: index + 1,
    severity,
  }));
  const { error } = await supabase.from("teacher_availability").upsert(rows, { onConflict: ON_CONFLICT });
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to set availability column: ${error.message}`);
  }
};

/**
 * Bulk-set a whole period row for a teacher in one round-trip: a severity upserts every
 * day 1..days; `null` deletes the row. The row-axis mirror of {@link setColumn}.
 */
export const setRow = async (supabase: Supabase, input: SetAvailabilityRowInput): Promise<void> => {
  const { planId, teacherId, period, days, severity } = input;

  if (severity === null) {
    const { error } = await supabase
      .from("teacher_availability")
      .delete()
      .eq("plan_id", planId)
      .eq("teacher_id", teacherId)
      .eq("period", period);
    if (error) {
      throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to clear availability row: ${error.message}`);
    }
    return;
  }

  const rows = Array.from({ length: days }, (_, index) => ({
    plan_id: planId,
    teacher_id: teacherId,
    day: index + 1,
    period,
    severity,
  }));
  const { error } = await supabase.from("teacher_availability").upsert(rows, { onConflict: ON_CONFLICT });
  if (error) {
    throw new DomainError("INTERNAL_SERVER_ERROR", `Failed to set availability row: ${error.message}`);
  }
};
