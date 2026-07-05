import { useEffect, useMemo, useRef, useState } from "react";
import {
  criterionId,
  mergeEffectiveCriteria,
  pruneCriteria,
  type LensCriterion,
  type LensKeyUniverse,
} from "@/entities/timetable";
import { readLensSession, writeLensSession } from "../../lib/lens-session";

/**
 * The highlight lens's one behavioral flow: the committed criteria selection plus its picker
 * disclosure (open state + the highlighted-candidate preview). View state in the UI layer per the
 * `chrome/board-disclosure.ts` precedent — the pure selection logic (`mergeEffectiveCriteria`,
 * matching, pruning) lives in `model/lens.ts`. `effectiveCriteria` is what feeds the board
 * derivation: committed criteria plus the picker's live preview while it is open.
 *
 * Persistence: the criteria survive focus switches (a full island remount) and in-tab reloads via
 * the plan-keyed sessionStorage bridge (`lib/lens-session.ts`). Rehydration happens in a
 * POST-MOUNT effect, never a lazy `useState` initializer — the server renders no lens, so an
 * initializer read would desync hydration (first paint without the lens, then it applies). Stored
 * criteria are pruned against the PLAN-WIDE `universe` (both cohorts), so an off-screen cohort's
 * criteria survive but deleted entities drop.
 */
export function useLens(planId: string, universe: LensKeyUniverse) {
  const [criteria, setCriteria] = useState<LensCriterion[]>([]);
  const [open, setOpenState] = useState(false);
  const [preview, setPreview] = useState<LensCriterion | null>(null);
  const hydrated = useRef(false);

  // Write-through — declared BEFORE the rehydration effect so the mount-order run sees
  // `hydrated=false` and skips, never clobbering a stored lens with the initial empty state.
  useEffect(() => {
    if (!hydrated.current) return;
    writeLensSession(planId, criteria);
  }, [planId, criteria]);

  useEffect(() => {
    if (hydrated.current) return;
    hydrated.current = true;
    const restored = pruneCriteria(readLensSession(planId), universe);
    // One-shot post-mount rehydration from sessionStorage: the hydration render must stay
    // lens-free (a lazy initializer would desync it against the SSR HTML), so the external read
    // commits here — one extra render, once per mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- see above
    if (restored.length > 0) setCriteria(restored);
  }, [planId, universe]);

  // The preview belongs to the open picker: closing it (any path — Esc, outside click, commit)
  // drops the candidate so the board falls back to the committed criteria.
  const setOpen = (next: boolean) => {
    if (!next) setPreview(null);
    setOpenState(next);
  };

  const effectiveCriteria = useMemo(
    () => mergeEffectiveCriteria(criteria, open ? preview : null),
    [criteria, open, preview],
  );

  const toggleCriterion = (criterion: LensCriterion) => {
    setCriteria((current) => {
      const id = criterionId(criterion);
      const without = current.filter((c) => criterionId(c) !== id);
      return without.length < current.length ? without : [...current, criterion];
    });
  };

  const removeCriterion = (criterion: LensCriterion) => {
    setCriteria((current) => current.filter((c) => criterionId(c) !== criterionId(criterion)));
  };

  const clearAll = () => {
    setCriteria([]);
  };

  return {
    criteria,
    toggleCriterion,
    removeCriterion,
    clearAll,
    open,
    setOpen,
    preview,
    setPreview,
    effectiveCriteria,
  };
}

export type LensState = ReturnType<typeof useLens>;
