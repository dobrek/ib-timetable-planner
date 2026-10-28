import type { AccessOutcome, PublicTable, UserKeyedTable } from "./access-probe";
import type { TablePrivilege } from "./postgres-client";

/**
 * The access spec as data: what each principal may do, which `role-matrix.integration.test.ts`
 * runs live, cell by cell. This is the file S-403 edits. Every principal and cell exists already,
 * pinned to today's facts, so its flip changes only values: it goes red before the policy migration
 * turns it green, and the diff to this file is the access change under review.
 *
 * Every fact here is **today's** posture (2026-10-28), not a target:
 *
 * - Every `public` table but `profiles` and `user_roles` has RLS on and one
 *   `ALL to authenticated using (true)` policy, so any signed-in human reads and writes everything.
 * - `profiles` (S-401) is one exception: every signed-in human reads every row, but inserts and
 *   updates only their own, and nobody deletes one. `PROFILE_WRITES` holds the "whose row" cells.
 * - `user_roles` (S-403) is the other: a signed-in human reads only their own role row, and nobody
 *   writes one through the Data API (`SELF_GRANTS`).
 * - No policy reads a role yet. So viewer, author and admin hold exactly noRole's access, plus a
 *   role row of their own to read.
 * - `anon` holds no DML grant on any table, so PostgREST refuses it outright (42501). It still holds
 *   Supabase's auto-granted TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 15 tables, which
 *   PostgREST cannot reach; `generation_jobs`, `profiles` and `user_roles` revoked all eight
 *   (lessons.md, "granting a role is not excluding the others").
 * - `authenticated` holds all eight privileges everywhere except `profiles` (INSERT, SELECT and
 *   UPDATE only) and `user_roles` (SELECT only), so RLS is its only lock.
 *
 * Completeness is enforced: a missing principal or table is a type error, so a new principal, or a
 * new table in `database.types.ts`, fails `pnpm check` until every cell is declared. A table that
 * exists live but not in `GRANTS` fails the suite's catalog check.
 */

/** Who attempts the access: no session, a session without a role, and a session per app role. */
export type Principal = "anon" | "noRole" | "viewer" | "author" | "admin";

/** Every public table whose rows belong to a plan (the root included), rather than to a user. */
export type PlanScopedTable = Exclude<PublicTable, UserKeyedTable>;

/** One table per policy family: plan root, catalog, student data, board state, generation jobs. */
export type RepresentativeTable = "plans" | "courses" | "students" | "placements" | "generation_jobs";

export type WriteOperation = "insert" | "update" | "delete";

/** Whose row a cell on a user-keyed table targets: the principal's own, or another user's. */
export type RowOwner = "own" | "others";

/** A profile has no DELETE cell: `GRANTS.profiles` holds no DELETE, which the catalog check proves. */
export type ProfileWriteOperation = "insert" | "update";

/** `clone_plan` writes; `own_app_role` only answers the caller's own role (the app's role read). */
export type Rpc = "clone_plan" | "own_app_role";

/** A principal writing its own `user_roles` row (see `SELF_GRANTS`). */
export type SelfGrant = "claim admin" | "drop own role";

/**
 * A cell that targets the principal's own row, which the principal may not hold. noRole holds no
 * `user_roles` row, so its cells there are `"no-row"`: stated rather than faked as `denied`, and
 * checked live as the row's absence instead of probed.
 */
export type OwnRowOutcome = AccessOutcome | "no-row";

type Cell = Record<Principal, AccessOutcome>;

type OwnRowCell = Record<Principal, OwnRowOutcome>;

export type TableGrants = { anon: readonly TablePrivilege[]; authenticated: readonly TablePrivilege[] };

export const PRINCIPAL_NOTES: Record<Principal, string> = {
  anon: "TODAY: no session is denied everywhere, at the grant layer",
  noRole:
    "TODAY: a signed-in user without a role is allowed everywhere except other users' profile and role rows — the hole S-403 closes",
  viewer: "TODAY: a viewer holds noRole's access plus its own role row — no policy reads the role yet",
  author: "TODAY: an author holds noRole's access plus its own role row — no policy reads the role yet",
  admin: "TODAY: an admin holds noRole's access plus its own role row — no policy reads the role yet",
};

export const READS: Record<PlanScopedTable, Cell> = {
  bundles: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  course_grouping_members: {
    anon: "denied",
    noRole: "allowed",
    viewer: "allowed",
    author: "allowed",
    admin: "allowed",
  },
  course_groupings: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  course_merges: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  course_overlaps: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  course_teachers: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  courses: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  generation_jobs: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  placements: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  plans: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  shelf_bundle_courses: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  shelf_bundles: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  student_choices: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  students: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  teacher_availability: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  teachers: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
};

/**
 * Reads of the user-keyed tables, by whose row the read names. A targeted read never sees "other
 * rows but not this one", so an own-row policy reads as allowed on the principal's own row and
 * denied on another user's. `others` is the fixture owner, who holds a profile and a role row.
 */
export const USER_KEYED_READS: Record<UserKeyedTable, Record<RowOwner, OwnRowCell>> = {
  profiles: {
    own: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    others: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  user_roles: {
    own: { anon: "denied", noRole: "no-row", viewer: "allowed", author: "allowed", admin: "allowed" },
    others: { anon: "denied", noRole: "denied", viewer: "denied", author: "denied", admin: "denied" },
  },
};

export const WRITES: Record<RepresentativeTable, Record<WriteOperation, Cell>> = {
  plans: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    delete: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  courses: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    delete: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  students: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    delete: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  placements: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    delete: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  generation_jobs: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    delete: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
};

/**
 * The "whose row" dimension `WRITES` cannot hold. The `own` cells are the evidence that each
 * payload is valid; the `others` cells, which deny everyone, are the claim under test. The
 * expectations test checks each `others` row through its `own` counterpart.
 */
export const PROFILE_WRITES: Record<RowOwner, Record<ProfileWriteOperation, Cell>> = {
  own: {
    insert: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
    update: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  },
  others: {
    insert: { anon: "denied", noRole: "denied", viewer: "denied", author: "denied", admin: "denied" },
    update: { anon: "denied", noRole: "denied", viewer: "denied", author: "denied", admin: "denied" },
  },
};

/**
 * Re-keying: an UPDATE of the principal's own profile that names another user's `user_id`. The
 * UPDATE policy's `with check` is its only lock, so S-403's policy rewrite must keep this denied.
 * Its payload differs from `PROFILE_WRITES.own.update` only in that column, which is its evidence.
 */
export const PROFILE_REKEY: Cell = {
  anon: "denied",
  noRole: "denied",
  viewer: "denied",
  author: "denied",
  admin: "denied",
};

/**
 * Self-grants: a principal writing its own `user_roles` row, which nobody may do through the Data
 * API until S-406. `GRANTS.user_roles` gives `authenticated` SELECT alone, so the grant layer
 * refuses every cell.
 *
 * - **claim admin.** A principal holding no role row INSERTs one as `admin` (noRole); one holding
 *   a row UPDATEs it to `admin` (viewer, author, admin).
 * - **drop own role.** A principal holding a role row DELETEs it. noRole holds none: `"no-row"`.
 *
 * Anon owns no row, so its cells aim at a fresh user in the state each write needs. No app
 * principal is allowed, so no cell here evidences its payload: `SELF_GRANT_EVIDENCE` does.
 */
export const SELF_GRANTS: Record<SelfGrant, OwnRowCell> = {
  "claim admin": { anon: "denied", noRole: "denied", viewer: "denied", author: "denied", admin: "denied" },
  "drop own role": { anon: "denied", noRole: "no-row", viewer: "denied", author: "denied", admin: "denied" },
};

/**
 * The same self-grant writes, sent by the service role to a fresh user in the same starting state:
 * each `SELF_GRANTS` row's evidence that its payload is valid. The expectations test requires every
 * one to be allowed.
 */
export const SELF_GRANT_EVIDENCE: Record<SelfGrant, AccessOutcome> = {
  "claim admin": "allowed",
  "drop own role": "allowed",
};

export const RPCS: Record<Rpc, Cell> = {
  clone_plan: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
  own_app_role: { anon: "denied", noRole: "allowed", viewer: "allowed", author: "allowed", admin: "allowed" },
};

// Sorted the way `heldPrivileges` returns them, so the catalog check compares like with like.
const NONE: readonly TablePrivilege[] = [];
const ANON_AUTO_GRANT_RESIDUE: readonly TablePrivilege[] = ["MAINTAIN", "REFERENCES", "TRIGGER", "TRUNCATE"];
const ALL_EIGHT: readonly TablePrivilege[] = [
  "DELETE",
  "INSERT",
  "MAINTAIN",
  "REFERENCES",
  "SELECT",
  "TRIGGER",
  "TRUNCATE",
  "UPDATE",
];
const OWN_ROW_DML: readonly TablePrivilege[] = ["INSERT", "SELECT", "UPDATE"];
const READ_ONLY: readonly TablePrivilege[] = ["SELECT"];

export const GRANTS: Record<PublicTable, TableGrants> = {
  bundles: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  course_grouping_members: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  course_groupings: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  course_merges: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  course_overlaps: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  course_teachers: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  courses: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  generation_jobs: { anon: NONE, authenticated: ALL_EIGHT },
  placements: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  plans: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  profiles: { anon: NONE, authenticated: OWN_ROW_DML },
  shelf_bundle_courses: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  shelf_bundles: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  student_choices: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  students: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  teacher_availability: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  teachers: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  user_roles: { anon: NONE, authenticated: READ_ONLY },
};
