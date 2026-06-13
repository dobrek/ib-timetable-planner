import { z } from "zod";
import type { Database } from "@/shared/api/database.types";

/**
 * Teacher-availability storage severity, single-sourced from the generated
 * `availability_severity` enum — mirroring the cohort config precedent. This is the
 * DB/authoring vocabulary: `strong` (cannot teach) vs `soft` (prefers not to). The
 * validation/render core uses a separate `block`/`warn` vocabulary; the mapping
 * (`strong → block`, `soft → warn`) lives only in the board constraint.
 */

export type AvailabilitySeverity = Database["public"]["Enums"]["availability_severity"];

export const AVAILABILITY_SEVERITY_VALUES = ["strong", "soft"] as const satisfies readonly AvailabilitySeverity[];

/** Shared Zod field for availability severity inputs — the authoritative gate mirrors the DB enum. */
export const availabilitySeveritySchema = z.enum(AVAILABILITY_SEVERITY_VALUES);
