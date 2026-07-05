import type { Dispatch, RefObject, SetStateAction } from "react";
import type { Rpcs } from "../../api/rpcs";
import type { CellData } from "../drag";
import type { AffectedScope, AffectedSlice } from "../history/history-entry";
import type { EditKind } from "../history/history-label";
import type { LocalParkedBundle } from "./parked";
import type { LocalPlacement } from "@/entities/timetable";
import type { PlacementError } from "./placement-transitions";

/**
 * The injected dependency bundle the forward writer factories (`createBoardWrites`,
 * `createShelfWrites`) and the reconcile executor consume. It is a SUPERSET of the executor's
 * `ReconcileExecutorDeps`: the two stores stay unified in the hook and are passed in by ref + setter,
 * plus `recordEdit` and `snapshot` for the forward path.
 *
 * The executor keeps its narrower param type (`ReconcileExecutorDeps`), so passing a `WriteContext`
 * to it typechecks by structural subtyping while `recordEdit` stays out of its scope — the
 * recorder-bypass invariant remains structural, not a convention.
 *
 * `weekModeOf` is deliberately NOT here: only the board persisters read it, so it rides in the board
 * factory's `boardDeps` rather than this genuinely-shared context.
 */
export type WriteContext = {
  rpcs: Rpcs;
  placementsRef: RefObject<LocalPlacement[]>;
  parkedBundlesRef: RefObject<LocalParkedBundle[]>;
  setPlacements: Dispatch<SetStateAction<LocalPlacement[]>>;
  setParkedBundles: Dispatch<SetStateAction<LocalParkedBundle[]>>;
  setError: Dispatch<SetStateAction<PlacementError | null>>;
  /** Records a settled user edit for undo/redo. Fired only on settled success, never on rollback. */
  recordEdit: (kind: EditKind, scope: AffectedScope, before: AffectedSlice, cell?: CellData) => void;
  /** Read the live affected slice — captures the pre-edit `before` slice at edit time. */
  snapshot: (scope: AffectedScope) => AffectedSlice;
};
