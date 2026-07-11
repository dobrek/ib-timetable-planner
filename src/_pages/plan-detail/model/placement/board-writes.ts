import type { Dispatch, SetStateAction } from "react";
import type { PlacementWeek, WeekMode } from "@/shared/config";
import {
  type AvailabilityIndex,
  cellKey,
  type CrossCohortIndex,
  type LocalPlacement,
  type PlannerPlacement,
} from "@/entities/timetable";
import type { CellData } from "../drag";
import type { GroupingCourse } from "../grouping/grouping";
import type { AffectedScope } from "../history/history-entry";
import type { EditKind } from "../history/history-label";
import { findDuplicateTarget } from "./duplicate-target";
import {
  addManyOptimistic,
  addOptimistic,
  addRollback,
  canAdd,
  eligibleMembers,
  errorOf,
  groupFailureError,
  messageOf,
  moveIntent,
  moveManyOptimistic,
  moveManyRollback,
  occupantsAt,
  oppositeWeekAssignment,
  outcomesByCourse,
  partitionBundleMove,
  patchRow,
  removeManyOptimistic,
  removeManyRollback,
  removeTarget,
  replaceRow,
  resolveDropWeek,
  settleMany,
  type MemberOutcome,
} from "./placement-transitions";
import type { WriteContext } from "./write-context";

/** Transient outcome of a successful duplicate: the target cell, plus a nonce so a same-cell
 *  re-duplicate (impossible today, but cheap to guarantee) still re-fires the board's feedback. */
export type DuplicateOutcome = CellData & { nonce: number };

/**
 * The board-only dependencies the writer factory needs beyond the shared `WriteContext`. `weekModeOf`
 * lives here (not in `ctx`) because only the board persisters read it; the rest are the duplicate
 * search's oracle inputs plus the `lastDuplicated` setter the board owns.
 */
export type BoardDeps = {
  catalogById: Map<string, GroupingCourse>;
  availabilityIndex: AvailabilityIndex;
  crossCohortIndex: CrossCohortIndex;
  /** Flagged-id set so the auto-duplicate search skips cells the early-finish edge rule blocks. */
  finishesEarlyByCourseId: Set<string>;
  days: number;
  periods: number;
  weekModeOf: (courseId: string) => WeekMode;
  setLastDuplicated: Dispatch<SetStateAction<DuplicateOutcome | null>>;
};

export type BoardWrites = {
  addCourse: (courseId: string, cell: CellData) => void;
  addGroup: (
    memberIds: string[],
    cell: CellData,
    opts?: { oppositeWeek?: boolean; weekByMember?: Map<string, PlacementWeek>; editKind?: EditKind },
  ) => void;
  movePlacement: (placementId: string, cell: CellData) => void;
  removePlacement: (placementId: string) => void;
  setWeek: (placementId: string, week: PlacementWeek) => void;
  setOptional: (placementId: string, isOptional: boolean) => void;
  moveBundle: (day: number, period: number, target: CellData) => void;
  removeBundle: (day: number, period: number) => void;
  duplicateBundle: (day: number, period: number) => void;
};

/**
 * The board (placement-store) forward write path, lifted out of `usePlacements`. Each public verb is a
 * thin wrapper over one of the member-set primitives — `placeCourse` (add — one call per member),
 * `moveBundleMembers` (move/merge), `removeBundleMembers` (remove), `updatePlacementWeek` (A/B flip) —
 * driven off the injected `ctx` + board-only `boardDeps`. Behavior is byte-for-byte identical to the
 * inline persisters: same optimistic/rollback sequencing, week precedence, partial-failure banners, and
 * the duplicate search's two-tier target selection + nonce pulse.
 */
export function createBoardWrites(ctx: WriteContext, boardDeps: BoardDeps): BoardWrites {
  const { placementsRef, setPlacements, setError, rpcs, recordEdit, snapshot } = ctx;
  const {
    catalogById,
    availabilityIndex,
    crossCohortIndex,
    finishesEarlyByCourseId,
    days,
    periods,
    weekModeOf,
    setLastDuplicated,
  } = boardDeps;

  function movePlacement(placementId: string, cell: CellData) {
    const result = moveIntent(placementsRef.current, placementId, cell);
    if (!result.ok) return; // not-found / pending / same-cell / occupied (own twin)
    const { value: intent } = result;
    void persistMoveMembers(intent.origin, [intent.courseId], cell);
  }

  function removePlacement(placementId: string) {
    const result = removeTarget(placementsRef.current, placementId);
    if (!result.ok) return; // not-found / pending
    const { value: row } = result;
    void persistRemoveMembers({ day: row.day, period: row.period }, [row.courseId]);
  }

  // The missing third whole-slot verb. Reads the source cell's occupants (and their weeks),
  // runs the pure conflict-free search (a COPY context — the source stays on the board), and
  // either fans the member-set out at the target with the source weeks mirrored or sets the
  // message error. On dispatch it publishes the target (fresh nonce) so the board pulses it —
  // optimistically, before the fan-out settles (a fully-failed copy briefly pulses the emptied cell).
  function duplicateBundle(day: number, period: number) {
    const occupants = occupantsAt(placementsRef.current, { day, period });
    if (occupants.length === 0) return; // empty-source no-op
    if (occupants.some((p) => p.pending)) return; // pending-source no-op (mirrors move/remove)

    // Only occupants resolvable in the validation catalog can be searched + placed.
    const placeable = occupants.filter((p) => catalogById.has(p.courseId));
    if (placeable.length === 0) return;
    const members = placeable
      .map((p) => catalogById.get(p.courseId))
      .filter((course): course is GroupingCourse => course !== undefined);

    const target = findDuplicateTarget({
      source: { day, period },
      members,
      placements: placementsRef.current,
      catalogById,
      availability: availabilityIndex,
      occupiedByTeacher: crossCohortIndex,
      finishesEarlyByCourseId,
      days,
      periods,
    });
    if (!target) {
      setError({ kind: "message", message: "No empty slot available to duplicate into" });
      return;
    }

    // Mirror the source's exact layout — each member spec carries its week explicitly so the
    // fan-out does not re-resolve it (which could swap A/B between members for a bi-weekly pair),
    // and its optional flag the same way: a duplicated optional member stays optional.
    void persistAddGroup(
      placeable.map((p) => ({ courseId: p.courseId, week: p.week, isOptional: p.isOptional })),
      target,
      { editKind: "duplicate" },
    );
    setLastDuplicated((prev) => ({ ...target, nonce: (prev?.nonce ?? 0) + 1 }));
  }

  const courseIdsAt = (day: number, period: number): string[] =>
    occupantsAt(placementsRef.current, { day, period }).map((p) => p.courseId);

  async function persistAdd(courseId: string, cell: CellData) {
    if (!canAdd(placementsRef.current, courseId, cell)) return;

    const scope = cellScope(cell);
    // KNOWN LIMIT: `before` is read from the live refs, which lag the prior edit's optimistic `setState`
    // by one commit (see `useLatest`). Back-to-back same-cell gestures rely on commit timing being
    // faster than the gesture; the forward path is not busy-gated (only undo/redo is).
    const before = snapshot(scope);
    const week = resolveDropWeek(weekModeOf(courseId), placementsRef.current, cell);
    const tempId = crypto.randomUUID();
    setPlacements((prev) => addOptimistic(prev, tempId, courseId, cell, week));

    try {
      const row = await rpcs.placeCourse({ courseId, day: cell.day, period: cell.period, week, isOptional: false });
      setPlacements((prev) => replaceRow(prev, tempId, row));
      recordEdit("add", scope, before, cell);
      setError(null); // a fully-successful settle dismisses any stale banner from a prior failure
    } catch (err: unknown) {
      setPlacements((prev) => addRollback(prev, tempId));
      setError(errorOf(err));
    }
  }

  // Group fan-out: one idempotent place_course per eligible member. They share the cell's
  // bundle (find-or-create), members already in the cell are skipped, and the optimistic batch
  // and settlement each land in one state update so collision/hours derivations recompute once.
  // Each member spec carries its own week/flag — a new per-member attribute extends the spec,
  // not the parameter list (no parallel maps to keep aligned, no silent trailing-arg default).
  async function persistAddGroup(
    members: GroupMemberSpec[],
    cell: CellData,
    opts: { oppositeWeek?: boolean; editKind?: EditKind } = {},
  ) {
    const eligibleIds = new Set(
      eligibleMembers(
        placementsRef.current,
        members.map((m) => m.courseId),
        cell,
      ),
    );
    const eligible = members.filter((m) => eligibleIds.has(m.courseId));
    if (eligible.length === 0) return;

    const scope = cellScope(cell);
    const before = snapshot(scope);

    // Week precedence: an explicit per-member week (a duplicate mirroring the source's A/B layout)
    // wins; else an opposite-week grouping alternates a/b; else each member resolves by its own
    // eligibility (agnostic ⇒ both, bi-weekly ⇒ first free week).
    const oppositeWeekByMember = opts.oppositeWeek ? oppositeWeekAssignment(eligible.map((m) => m.courseId)) : null;
    const weekOf = (member: GroupMemberSpec): PlacementWeek =>
      member.week ??
      oppositeWeekByMember?.get(member.courseId) ??
      resolveDropWeek(weekModeOf(member.courseId), placementsRef.current, cell);

    // Only a duplicate supplies per-member flags (mirroring the source); fresh drops are never optional.
    const entries = eligible.map((member) => ({
      tempId: crypto.randomUUID(),
      courseId: member.courseId,
      week: weekOf(member),
      isOptional: member.isOptional ?? false,
    }));
    setPlacements((prev) => addManyOptimistic(prev, entries, cell));

    try {
      const outcomes = await Promise.all(entries.map((entry) => persistMember(entry, cell)));
      setPlacements((prev) => settleMany(prev, outcomes));

      // Record once if at least one member landed (a fully-failed batch leaves the cell unchanged).
      if (outcomes.some(({ result }) => result !== null)) recordEdit(opts.editKind ?? "addGroup", scope, before, cell);

      // Clear a stale banner on a successful settle BEFORE the partial-failure setError below — so a
      // real groupFailure still surfaces. The obvious "clear at the very end" ordering would wipe it.
      setError(null);
      const failure = groupFailureError(outcomes, outcomes.length);
      if (failure) setError(failure);
    } catch (err: unknown) {
      setPlacements((prev) =>
        settleMany(
          prev,
          entries.map(({ tempId }) => ({ tempId, result: null })),
        ),
      );
      setError(errorOf(err));
    }
  }

  async function persistMember(
    {
      tempId,
      courseId,
      week,
      isOptional,
    }: { tempId: string; courseId: string; week: PlacementWeek; isOptional: boolean },
    cell: CellData,
  ): Promise<MemberOutcome> {
    try {
      const row = await rpcs.placeCourse({ courseId, day: cell.day, period: cell.period, week, isOptional });
      return { tempId, courseId, result: row };
    } catch (err: unknown) {
      // The banner names which members failed; keep the underlying reason traceable.
      // eslint-disable-next-line no-console
      console.error(`[persistAddGroup] place failed for course ${courseId}: ${messageOf(err)}`);
      return { tempId, courseId, result: null };
    }
  }

  // The unified member-set move (single move, whole-bundle move, merge). One optimistic
  // `moveManyOptimistic` pass (movers → target + pending; mergers filtered, never moved onto a
  // twin), one atomic `moveBundleMembers` RPC, one `settleMany` pass swapping the movers for the
  // server rows (id preserved on relocation). The board derives only the initial and final
  // states — never a transient duplicate. An atomic failure rolls the whole move back.
  async function persistMoveMembers(source: CellData, courseIds: string[], target: CellData) {
    if (target.day === source.day && target.period === source.period) return; // same-cell no-op
    const courseSet = new Set(courseIds);
    const occupants = occupantsAt(placementsRef.current, source).filter((p) => courseSet.has(p.courseId));
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of moveIntent's pending reject

    const { movers, mergers } = partitionBundleMove(
      placementsRef.current,
      occupants.map((p) => p.id),
      target,
    );
    const moverRows = occupants.filter((p) => movers.includes(p.id));

    const scope: AffectedScope = {
      cells: [cellKey(source.day, source.period), cellKey(target.day, target.period)],
      cardSets: [],
    };
    const before = snapshot(scope);

    setPlacements((prev) => moveManyOptimistic(prev, movers, mergers, target));

    try {
      const serverRows = await rpcs.moveBundleMembers({
        day: source.day,
        period: source.period,
        courseIds,
        targetDay: target.day,
        targetPeriod: target.period,
      });
      // Reconcile each mover by course → its server row (relocation preserves the placement id,
      // so settleMany matches by the unchanged id and picks up the settled bundleId).
      const outcomes = outcomesByCourse(
        moverRows.map((row) => ({ tempId: row.id, courseId: row.courseId })),
        serverRows,
      );
      setPlacements((prev) => settleMany(prev, outcomes));

      recordEdit(courseIds.length > 1 ? "moveBundle" : "move", scope, before, target);

      setError(null); // clear before the partial-failure setError so a real groupFailure still surfaces
      const failure = groupFailureError(outcomes, moverRows.length);
      if (failure) setError(failure);
    } catch (err: unknown) {
      setPlacements((prev) => moveManyRollback(prev, movers, occupants));
      setError(errorOf(err));
    }
  }

  // The unified member-set remove (single remove, whole-bundle remove). One optimistic pass,
  // one atomic `removeBundleMembers` RPC (which deletes the bundle at == 0 membership); a
  // failure restores the removed rows.
  async function persistRemoveMembers(cell: CellData, courseIds: string[]) {
    const courseSet = new Set(courseIds);
    const occupants = occupantsAt(placementsRef.current, cell).filter((p) => courseSet.has(p.courseId));
    if (occupants.length === 0) return;
    if (occupants.some((p) => p.pending)) return; // batch analogue of removeTarget's pending reject

    const scope = cellScope(cell);
    const before = snapshot(scope);

    setPlacements((prev) =>
      removeManyOptimistic(
        prev,
        occupants.map((p) => p.id),
      ),
    );

    try {
      await rpcs.removeBundleMembers({ day: cell.day, period: cell.period, courseIds });
      recordEdit(courseIds.length > 1 ? "removeBundle" : "remove", scope, before, cell);
      setError(null);
    } catch (err: unknown) {
      setPlacements((prev) => removeManyRollback(prev, occupants));
      setError(errorOf(err));
    }
  }

  // Flip one field of a placed chip. One skeleton serves every single-field verb: guard (missing /
  // pending / no-op), snapshot scope, optimistic patch, RPC, reconcile to the server row, record
  // the edit; a failure re-patches the previous value. The descriptor spells a field's
  // read/patch/RPC/edit-kind once, so a fix to the skeleton reaches every verb.
  async function persistSetField<V>(placementId: string, value: V, edit: SingleFieldEdit<V>) {
    const row = placementsRef.current.find((p) => p.id === placementId);
    if (!row || row.pending || edit.read(row) === value) return;
    const prevValue = edit.read(row);
    const cell: CellData = { day: row.day, period: row.period };
    const scope = cellScope(cell);
    const before = snapshot(scope);

    setPlacements((prev) => patchRow(prev, placementId, edit.patch(value)));

    try {
      const updated = await edit.rpc(placementId, value);
      setPlacements((prev) => replaceRow(prev, placementId, updated));
      recordEdit(edit.editKind(value), scope, before, cell);
      setError(null);
    } catch (err: unknown) {
      setPlacements((prev) => patchRow(prev, placementId, edit.patch(prevValue)));
      setError(errorOf(err));
    }
  }

  // The two single-field verbs: the A/B week lane flip, and the optional mark ⇄ accept — whose
  // direction picks the edit kind so the undo tooltip names it ("Mark optional at …" / "Accept
  // course at …").
  const weekEdit: SingleFieldEdit<PlacementWeek> = {
    read: (row) => row.week,
    patch: (week) => ({ week }),
    rpc: (placementId, week) => rpcs.updatePlacementWeek(placementId, week),
    editKind: () => "setWeek",
  };
  const optionalEdit: SingleFieldEdit<boolean> = {
    read: (row) => row.isOptional,
    patch: (isOptional) => ({ isOptional }),
    rpc: (placementId, isOptional) => rpcs.updatePlacementOptional(placementId, isOptional),
    editKind: (isOptional) => (isOptional ? "markOptional" : "acceptOptional"),
  };

  return {
    addCourse: (courseId, cell) => void persistAdd(courseId, cell),
    addGroup: (memberIds, cell, opts) =>
      void persistAddGroup(
        memberIds.map((courseId) => ({ courseId, week: opts?.weekByMember?.get(courseId) })),
        cell,
        { oppositeWeek: opts?.oppositeWeek, editKind: opts?.editKind },
      ),
    movePlacement,
    removePlacement,
    setWeek: (placementId, week) => void persistSetField(placementId, week, weekEdit),
    setOptional: (placementId, isOptional) => void persistSetField(placementId, isOptional, optionalEdit),
    moveBundle: (day, period, target) => void persistMoveMembers({ day, period }, courseIdsAt(day, period), target),
    removeBundle: (day, period) => void persistRemoveMembers({ day, period }, courseIdsAt(day, period)),
    duplicateBundle,
  };
}

/**
 * One member of a group fan-out. `week` absent ⇒ resolved by the drop rules (opposite-week
 * alternation, then per-member eligibility); `isOptional` absent ⇒ false (fresh drops are never
 * optional — only a duplicate mirrors flags from its source).
 */
type GroupMemberSpec = { courseId: string; week?: PlacementWeek; isOptional?: boolean };

/** Descriptor for a single-field chip edit — the one home for a field's read/patch/RPC/edit-kind. */
type SingleFieldEdit<V> = {
  read: (row: LocalPlacement) => V;
  patch: (value: V) => Partial<PlannerPlacement>;
  rpc: (placementId: string, value: V) => Promise<PlannerPlacement>;
  editKind: (value: V) => EditKind;
};

/** A single-cell scope (the common case: add/move/remove/setWeek touch one or two cells, no cards). */
const cellScope = (cell: CellData): AffectedScope => ({ cells: [cellKey(cell.day, cell.period)], cardSets: [] });
