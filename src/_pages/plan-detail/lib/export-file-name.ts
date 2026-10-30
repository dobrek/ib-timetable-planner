import { planFileStem } from "@/shared/lib/slugify";
import type { BoardSurface } from "./board-surface";

/**
 * Deterministic, filesystem-safe download name for an exported view: `<plan-stem>-<view>.xlsx`.
 * The stem is `planFileStem`: the plan name lowercased, diacritics folded to ASCII, every run of
 * non-alphanumerics collapsed to a single `-` with leading/trailing separators trimmed (a name with
 * no alphanumerics falls back to `plan`), plus `-current` while the plan is the current one. The
 * `view` (`combined`/`dp1`/`dp2`) is already slug-safe. Example: `"IB 2027 draft"` + `combined` →
 * `ib-2027-draft-combined.xlsx`, or `ib-2027-draft-current-combined.xlsx` for the current plan.
 */
export const exportFileName = (planName: string, isCurrent: boolean, view: BoardSurface): string =>
  `${planFileStem(planName, isCurrent)}-${view}.xlsx`;
