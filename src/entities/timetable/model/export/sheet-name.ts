import { cohortLabel, type Cohort } from "@/shared/config";

/**
 * Excel worksheet-name hygiene — the single highest-risk detail of the export, isolated and unit-tested.
 * `write-excel-file` VALIDATES (throws on empty / >31 chars / the illegal set `[ ] / \ : * ?`) but does
 * NOT sanitize, and does NOT enforce the case-insensitive uniqueness Excel itself requires. So the caller
 * owns all three: strip illegal chars, cap at 31, and de-duplicate case-insensitively.
 */

/** Excel's hard cap on worksheet-name length. */
export const SHEET_NAME_MAX = 31;

const ILLEGAL_CHARS = /[[\]/\\:*?]+/g;

/** Replace the Excel-illegal set with a space, collapse runs of whitespace, and trim. */
export const sanitizeSheetName = (raw: string): string => raw.replace(ILLEGAL_CHARS, " ").replace(/\s+/g, " ").trim();

/** `Mathematics HL · DP1` — sanitized name trimmed to leave room for the ` · DPx` cohort suffix within 31 chars. */
export const courseSheetName = (courseName: string, cohort: Cohort): string => {
  const suffix = ` · ${cohortLabel(cohort)}`;
  const base = sanitizeSheetName(courseName)
    .slice(0, SHEET_NAME_MAX - suffix.length)
    .trimEnd();
  return `${base}${suffix}`;
};

/**
 * Case-insensitive de-dup: the first occurrence keeps its name; each later collision gets a `~2`/`~3`/…
 * suffix, trimming its base so the total stays ≤31. The scan is sequential (each pick depends on all
 * prior picks), so a growing lowercased `used` set threads through a single pass.
 */
export const dedupeSheetNames = (names: string[]): string[] => {
  const used = new Set<string>();
  const result: string[] = [];
  for (const name of names) {
    const unique = disambiguate(name, used, names.length + 1);
    used.add(unique.toLowerCase());
    result.push(unique);
  }
  return result;
};

/** The first non-colliding name for `name`: itself, else `~n` variants up to `limit` (always terminates). */
const disambiguate = (name: string, used: Set<string>, limit: number): string => {
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; n <= limit; n++) {
    const candidate = withSuffix(name, `~${n}`);
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
  return withSuffix(name, `~${limit + 1}`);
};

/** Append `suffix`, trimming `name`'s base so the combined length stays ≤31. */
const withSuffix = (name: string, suffix: string): string =>
  `${name.slice(0, SHEET_NAME_MAX - suffix.length).trimEnd()}${suffix}`;
