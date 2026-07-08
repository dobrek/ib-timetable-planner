import type { BoardSurface } from "./board-surface";

/**
 * Deterministic, filesystem-safe download name for an exported view: `<plan-slug>-<view>.xlsx`.
 * The plan name is lowercased and every run of non-alphanumerics collapses to a single `-`, with
 * leading/trailing separators trimmed; a name with no alphanumerics falls back to `plan`. The
 * `view` (`combined`/`dp1`/`dp2`) is already slug-safe. Example: `"IB 2027 draft"` + `combined` →
 * `ib-2027-draft-combined.xlsx`.
 */
export const exportFileName = (planName: string, view: BoardSurface): string => `${slugify(planName)}-${view}.xlsx`;

const slugify = (value: string): string => {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "plan";
};
