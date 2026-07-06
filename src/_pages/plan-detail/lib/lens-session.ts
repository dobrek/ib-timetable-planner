import { criterionId, type LensCriterion, type LensKind } from "../model/lens";

/**
 * The lens's per-tab persistence bridge: plain guarded read/write functions over sessionStorage,
 * keyed per plan (`planner-lens:<planId>`) so a focus switch (a full island remount) or an in-tab
 * reload keeps the lens while a new tab starts clean. Deliberately NOT a `useSyncExternalStore`
 * micro-store — one consumer, and sessionStorage needs no cross-tab sync (cloning the
 * `drag-hint-mode.ts` shape here would trip the store adoption trigger for nothing). Guarded per
 * the storage lesson: `typeof window` + try/catch, degrading to the in-code default (reads) or a
 * no-op (writes) when storage is blocked.
 */

export function readLensSession(planId: string): LensCriterion[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(sessionKey(planId));
    if (raw === null) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(isLensCriterion)
      ? dedupeCriteria(parsed).slice(0, MAX_RESTORED_CRITERIA)
      : [];
  } catch {
    return [];
  }
}

export function writeLensSession(planId: string, criteria: LensCriterion[]): void {
  if (typeof window === "undefined") return;
  try {
    if (criteria.length === 0) window.sessionStorage.removeItem(sessionKey(planId));
    else window.sessionStorage.setItem(sessionKey(planId), JSON.stringify(criteria));
  } catch {
    // Storage blocked (private mode, policy, quota) — the lens degrades to in-page-only.
  }
}

const sessionKey = (planId: string): string => `planner-lens:${planId}`;

const LENS_KINDS: readonly LensKind[] = ["course", "teacher", "student"];

/** Hand-edited payloads can hold unbounded duplicates — restore at most one of each, capped. */
const MAX_RESTORED_CRITERIA = 50;

const dedupeCriteria = (criteria: LensCriterion[]): LensCriterion[] => {
  const seen = new Set<string>();
  return criteria.filter((criterion) => {
    const id = criterionId(criterion);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
};

/** Shape gate for stored payloads — anything hand-edited or from an old format reads as empty. */
const isLensCriterion = (value: unknown): value is LensCriterion =>
  typeof value === "object" &&
  value !== null &&
  "kind" in value &&
  (LENS_KINDS as readonly unknown[]).includes(value.kind) &&
  "key" in value &&
  typeof value.key === "string";
