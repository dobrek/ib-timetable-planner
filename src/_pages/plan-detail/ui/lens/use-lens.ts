import { useMemo, useState } from "react";
import { criterionId, mergeEffectiveCriteria, type LensCriterion } from "../../model/lens";

/**
 * The highlight lens's one behavioral flow: the committed criteria selection plus its picker
 * disclosure (open state + the highlighted-candidate preview). View state in the UI layer per the
 * `chrome/board-disclosure.ts` precedent — the pure selection logic (`mergeEffectiveCriteria`,
 * matching) lives in `model/lens.ts`. `effectiveCriteria` is what feeds the board derivation:
 * committed criteria plus the picker's live preview while it is open.
 *
 * `_planId` keys the sessionStorage bridge that arrives in Phase 4; accepted now so the shell
 * wiring is final.
 */
export function useLens(_planId: string) {
  const [criteria, setCriteria] = useState<LensCriterion[]>([]);
  const [open, setOpenState] = useState(false);
  const [preview, setPreview] = useState<LensCriterion | null>(null);

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
