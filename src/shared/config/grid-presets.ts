import { z } from "zod";

/**
 * The canonical slot-grid presets (FR-008: small enumerated set, fixed for the
 * lifetime of a plan). `<days>x<periods>` — the convention the grid parser
 * (see `@/shared/lib/grid`) interprets. The DB column stays plain text; this list
 * is the authoring-time gate for plan creation.
 */

export const GRID_PRESET_VALUES = ["5x6", "5x8", "5x10"] as const;

export type GridPreset = (typeof GRID_PRESET_VALUES)[number];

export const GRID_PRESETS: readonly { value: GridPreset; label: string }[] = [
  { value: "5x6", label: "Mon–Fri × 6 periods" },
  { value: "5x8", label: "Mon–Fri × 8 periods" },
  { value: "5x10", label: "Mon–Fri × 10 periods" },
];

/** Matches the seeded plans and plan-detail's DEFAULT_GRID (5 days × 10 periods). */
export const DEFAULT_GRID_PRESET: GridPreset = "5x10";

/** Shared Zod field for the create-plan input — the authoritative gate. */
export const gridPresetSchema = z.enum(GRID_PRESET_VALUES);
