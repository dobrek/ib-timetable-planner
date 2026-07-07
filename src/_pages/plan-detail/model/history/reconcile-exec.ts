import type { CellData } from "../drag";
import type { ParkedMember } from "../placement/parked";
import type { PlannerPlacement } from "@/entities/timetable";
import { memberSetKey } from "./affected-slice";
import type { PlacementKey, PlacementSpec, ReconcilePlan } from "./history-entry";

/**
 * The injectable write surface a reconcile runs over. Two tiers: the **atomic ops**
 * (`moveMembers` / `shelve` / `unshelve` / `setOptional`) that preserve the DB-level atomicity the
 * forward path has, and the **decomposed primitives** (`place` / `removeMembers` / `createCard` /
 * `deleteCard`) the multi-cell fallback (merge-undo) sequences. `resolveCardId` maps a member-set
 * to the current shelf card id; `resolvePlacementId` maps a business key to the live row's id
 * (an optional-flip updates in place, and ids are never carried in the plan). The React hook
 * injects the `api/*-client` wrappers; the integration test injects the `api/*` domain fns over a
 * real Supabase client — both share this one sequencing path.
 */
export type ReconcileDeps = {
  moveMembers: (source: CellData, target: CellData, courseIds: string[]) => Promise<PlannerPlacement[]>;
  shelve: (cell: CellData) => Promise<{ id: string }>;
  unshelve: (shelfBundleId: string, target: CellData) => Promise<PlannerPlacement[]>;
  setOptional: (placementId: string, isOptional: boolean) => Promise<PlannerPlacement>;
  place: (spec: PlacementSpec) => Promise<PlannerPlacement>;
  removeMembers: (cell: CellData, courseIds: string[]) => Promise<void>;
  createCard: (members: ParkedMember[]) => Promise<{ id: string }>;
  deleteCard: (shelfBundleId: string) => Promise<void>;
  resolveCardId: (members: ParkedMember[]) => string | undefined;
  resolvePlacementId: (key: PlacementKey) => string | undefined;
};

export type ReconcileResult = {
  /** Server rows for placed/relocated courses, for client id-remap by business key. */
  placed: PlannerPlacement[];
  /** Created shelf cards (member-set → server id), for client id-remap. */
  createdCards: { members: ParkedMember[]; id: string }[];
};

/**
 * Translate a `ReconcilePlan` into RPC calls. **Atomicity-preserving dispatch:** recognize the
 * plan's shape before decomposing — a pure board relocation → one `move_bundle_members`; a lift
 * (board-removes + one card-create) → one `shelve_bundle`; a place-back (one card-delete +
 * board-places) → one `unshelve_bundle`; a pure optional-flip (same cells, only flags differ) →
 * in-place `update_placement_optional` per member. Only a diff no single RPC covers (notably
 * merge-*undo*, which re-places at two cells) falls back to the decomposed sequence
 * (card-deletes → board-removes → board-places → card-creates) — the lone non-atomic path.
 */
export async function executeReconcilePlan(plan: ReconcilePlan, deps: ReconcileDeps): Promise<ReconcileResult> {
  const relocation = asPureRelocation(plan);
  if (relocation) {
    const placed = await deps.moveMembers(relocation.source, relocation.target, relocation.courseIds);
    return { placed, createdCards: [] };
  }

  const lift = asLift(plan);
  if (lift) {
    const card = await deps.shelve(lift.cell);
    return { placed: [], createdCards: [{ members: lift.members, id: card.id }] };
  }

  const placeBack = asPlaceBack(plan, deps);
  if (placeBack) {
    const placed = await deps.unshelve(placeBack.shelfBundleId, placeBack.target);
    return { placed, createdCards: [] };
  }

  const flips = asOptionalFlips(plan, deps);
  if (flips) {
    const placed = await Promise.all(flips.map((flip) => deps.setOptional(flip.placementId, flip.isOptional)));
    return { placed, createdCards: [] };
  }

  return executeDecomposed(plan, deps);
}

// --- The decomposed fallback: ordered so a re-place never collides with a row still pending delete ---

async function executeDecomposed(plan: ReconcilePlan, deps: ReconcileDeps): Promise<ReconcileResult> {
  await Promise.all(
    plan.cardsToDelete.map((members) => {
      const id = deps.resolveCardId(members);
      return id ? deps.deleteCard(id) : Promise.resolve();
    }),
  );
  await Promise.all(groupByCell(plan.toRemove).map((group) => deps.removeMembers(group.cell, group.courseIds)));
  const placed = await Promise.all(plan.toPlace.map((spec) => deps.place(spec)));
  const createdCards = await Promise.all(
    plan.cardsToCreate.map(async (members) => ({ members, id: (await deps.createCard(members)).id })),
  );
  return { placed, createdCards };
}

// --- Shape recognizers (atomic dispatch) ---

/** A move/relocation: removes all at one cell, places all at a different cell, identical member-set. */
function asPureRelocation(plan: ReconcilePlan): { source: CellData; target: CellData; courseIds: string[] } | null {
  if (plan.cardsToDelete.length > 0 || plan.cardsToCreate.length > 0) return null;
  if (plan.toRemove.length === 0 || plan.toPlace.length === 0) return null;
  const source = singleCell(plan.toRemove);
  const target = singleCell(plan.toPlace);
  if (!source || !target || sameCell(source, target)) return null;
  if (memberWeekKey(plan.toRemove) !== memberWeekKey(plan.toPlace)) return null;
  return { source, target, courseIds: plan.toPlace.map((spec) => spec.courseId) };
}

/** A lift: board-removes at one cell + exactly one card-create whose members equal those occupants. */
function asLift(plan: ReconcilePlan): { cell: CellData; members: ParkedMember[] } | null {
  if (plan.cardsToCreate.length !== 1 || plan.cardsToDelete.length > 0) return null;
  if (plan.toPlace.length > 0 || plan.toRemove.length === 0) return null;
  const cell = singleCell(plan.toRemove);
  if (!cell) return null;
  const members = plan.cardsToCreate[0];
  if (memberWeekKey(plan.toRemove) !== memberSetKey(members)) return null;
  return { cell, members };
}

/** A place-back: exactly one card-delete + board-places at one cell, no board-removes. */
function asPlaceBack(plan: ReconcilePlan, deps: ReconcileDeps): { shelfBundleId: string; target: CellData } | null {
  if (plan.cardsToDelete.length !== 1 || plan.cardsToCreate.length > 0) return null;
  if (plan.toRemove.length > 0 || plan.toPlace.length === 0) return null;
  const target = singleCell(plan.toPlace);
  if (!target) return null;
  const shelfBundleId = deps.resolveCardId(plan.cardsToDelete[0]);
  if (!shelfBundleId) return null;
  return { shelfBundleId, target };
}

type OptionalFlip = { placementId: string; isOptional: boolean };

/**
 * A pure optional-flip: no card changes, and every remove pairs 1:1 with a place at the same
 * (course, cell, week) — only the flag differs. Executed as one in-place `update_placement_optional`
 * per member: decomposing would delete the row and re-insert it, so a failure between the two RPCs
 * loses the placement outright for what is semantically a one-column revert. Requires every flipped
 * row to resolve to a live id; otherwise falls back to the decomposed sequence.
 */
function asOptionalFlips(plan: ReconcilePlan, deps: ReconcileDeps): OptionalFlip[] | null {
  if (plan.cardsToDelete.length > 0 || plan.cardsToCreate.length > 0) return null;
  if (plan.toRemove.length === 0 || plan.toRemove.length !== plan.toPlace.length) return null;
  const partnerByIdentity = new Map(plan.toPlace.map((spec) => [flipIdentity(spec), spec]));
  const flips: OptionalFlip[] = [];
  for (const removed of plan.toRemove) {
    const partner = partnerByIdentity.get(flipIdentity(removed));
    if (!partner || partner.isOptional === removed.isOptional) return null;
    const placementId = deps.resolvePlacementId(removed);
    if (!placementId) return null;
    flips.push({ placementId, isOptional: partner.isOptional });
  }
  return flips;
}

/** A placement's identity minus the flag — what an optional-flip preserves. */
const flipIdentity = ({ courseId, day, period, week }: PlacementKey): string => `${courseId}|${day}|${period}|${week}`;

// --- Cell / member-set helpers ---

type Coord = { day: number; period: number };

const sameCell = (a: Coord, b: Coord): boolean => a.day === b.day && a.period === b.period;

/** The shared cell of a non-empty coord list, or null if it is empty or straddles more than one cell. */
function singleCell(rows: Coord[]): CellData | null {
  if (rows.length === 0) return null;
  const [first, ...rest] = rows;
  return rest.every((row) => sameCell(row, first)) ? { day: first.day, period: first.period } : null;
}

type GridGroup = { cell: CellData; courseIds: string[] };

function groupByCell(keys: { courseId: string; day: number; period: number }[]): GridGroup[] {
  const byCell = new Map<string, GridGroup>();
  for (const key of keys) {
    const cellId = `${key.day}:${key.period}`;
    const group = byCell.get(cellId) ?? { cell: { day: key.day, period: key.period }, courseIds: [] };
    group.courseIds.push(key.courseId);
    byCell.set(cellId, group);
  }
  return [...byCell.values()];
}

/** Order-free key over a placement set's `{courseId, week, isOptional}` triples — comparable against `memberSetKey`. */
const memberWeekKey = (rows: { courseId: string; week: ParkedMember["week"]; isOptional: boolean }[]): string =>
  memberSetKey(rows.map((row) => ({ courseId: row.courseId, week: row.week, isOptional: row.isOptional })));
