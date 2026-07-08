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

/**
 * Concrete sRGB hex for each palette hue — the non-CSS companion of `SUBJECT_CHIP_CLASS`, for
 * consumers that cannot resolve Tailwind classes (the XLSX export's cell fills; any future
 * canvas/PDF path). `fill`/`text` mirror the **light-mode** chip pair — the `<hue>-100` background +
 * `<hue>-900` foreground bound to `--subject-<hue>` / `--subject-<hue>-foreground` in
 * `src/app/styles/global.css:47-64`.
 *
 * Tailwind v4's palette is defined in **OKLCH** (`node_modules/tailwindcss/theme.css`), not hex, so
 * each value below is that hue's v4 `-100`/`-900` OKLCH converted to sRGB hex (D65, standard OKLab
 * matrices — approximation). Do NOT substitute Tailwind v3 hex values: v4's palette was recalibrated
 * and its hexes differ subtly. Re-derive from `theme.css` if the tokens ever change.
 */
export const SUBJECT_COLOR_HEX: Record<SubjectColor, { fill: string; text: string }> = {
  rose: { fill: "#FFE4E6", text: "#8B0836" },
  amber: { fill: "#FEF3C6", text: "#7B3306" },
  emerald: { fill: "#D0FAE5", text: "#004F3B" },
  sky: { fill: "#DFF2FE", text: "#024A70" },
  violet: { fill: "#EDE9FE", text: "#4D179A" },
  teal: { fill: "#CBFBF1", text: "#0B4F4A" },
  orange: { fill: "#FFEDD4", text: "#7E2A0C" },
  indigo: { fill: "#E0E7FF", text: "#312C85" },
};

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
