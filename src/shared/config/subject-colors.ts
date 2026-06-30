import { z } from "zod";

/**
 * The fixed subject-color palette (FR: an optional, visual-only per-course color shown on the
 * plan-detail chips). Mirrors the config-enum precedent (`grid-presets.ts`, `cohorts.ts`): a
 * `VALUES` tuple + display list + Zod `z.enum` gate, with the DB `courses.color` column staying
 * plain `text` (the enum is app-gated, not DB-checked).
 *
 * Each value is a Tailwind accent hue. Color resolves to a paired chip class via
 * `subjectChipClass`, which maps each key to a *literal* `bg-subject-<hue>
 * text-subject-<hue>-foreground` string — Tailwind only generates a utility when it sees the
 * full literal, so the map must never construct `` `bg-subject-${key}` ``. The paired tokens
 * live in `src/app/styles/global.css` (light/dark flip via `:root`/`.dark`).
 */

export const SUBJECT_COLOR_VALUES = ["rose", "amber", "emerald", "sky", "violet", "teal", "orange", "indigo"] as const;

export type SubjectColor = (typeof SUBJECT_COLOR_VALUES)[number];

/** A subject color presented for the swatch picker: enum value + display label. */
export const SUBJECT_COLORS: readonly { value: SubjectColor; label: string }[] = [
  { value: "rose", label: "Rose" },
  { value: "amber", label: "Amber" },
  { value: "emerald", label: "Emerald" },
  { value: "sky", label: "Sky" },
  { value: "violet", label: "Violet" },
  { value: "teal", label: "Teal" },
  { value: "orange", label: "Orange" },
  { value: "indigo", label: "Indigo" },
];

/** Shared Zod field for the optional course color — the authoritative gate for form + action. */
export const subjectColorSchema = z.enum(SUBJECT_COLOR_VALUES);

/**
 * Coerce a stored `courses.color` (plain text, possibly hand-edited) to a known key, else `null`.
 * Defensive against manual DB edits — mirrors `toGroupIndex`.
 */
export const toSubjectColor = (value: string | null): SubjectColor | null => (isSubjectColor(value) ? value : null);

/** Paired chip classes for a color key; "" when no color (caller keeps its default background). */
export const subjectChipClass = (color: SubjectColor | null): string => (color ? SUBJECT_CHIP_CLASS[color] : "");

/** Whether a stored string is one of the known palette keys. */
const isSubjectColor = (value: string | null): value is SubjectColor =>
  value !== null && (SUBJECT_COLOR_VALUES as readonly string[]).includes(value);

/**
 * Literal class pairs — one entry per `SUBJECT_COLOR_VALUES` member. Static strings only, so
 * Tailwind generates each `bg-subject-<hue>` / `text-subject-<hue>-foreground` utility.
 */
const SUBJECT_CHIP_CLASS: Record<SubjectColor, string> = {
  rose: "bg-subject-rose text-subject-rose-foreground",
  amber: "bg-subject-amber text-subject-amber-foreground",
  emerald: "bg-subject-emerald text-subject-emerald-foreground",
  sky: "bg-subject-sky text-subject-sky-foreground",
  violet: "bg-subject-violet text-subject-violet-foreground",
  teal: "bg-subject-teal text-subject-teal-foreground",
  orange: "bg-subject-orange text-subject-orange-foreground",
  indigo: "bg-subject-indigo text-subject-indigo-foreground",
};
