import type { AccessOutcome, PublicTable } from "./access-probe";
import type { TablePrivilege } from "./postgres-client";

/**
 * The access spec as data: what each principal may do, which `role-matrix.integration.test.ts`
 * runs live, cell by cell. This is the file S-403 edits. Its flip — new principals, `noRole`
 * turned to denied — goes red before the policy migration turns it green, and the diff to this file
 * is the access change under review.
 *
 * Every fact here is **today's** posture (2026-10-12), not a target:
 *
 * - Every `public` table has RLS on and one `ALL to authenticated using (true)` policy, so any
 *   signed-in human reads and writes everything.
 * - `anon` holds no DML grant on any table, so PostgREST refuses it outright (42501). It still holds
 *   Supabase's auto-granted TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 15 tables, which
 *   PostgREST cannot reach; `generation_jobs` revoked all eight (lessons.md, "granting a role is not
 *   excluding the others").
 * - `authenticated` holds all eight privileges everywhere, so RLS is its only lock.
 *
 * Completeness is enforced: a missing principal or table is a type error, so S-403 adding a
 * principal, or `database.types.ts` gaining `user_roles`, fails `pnpm check` until every cell is
 * declared. A table that exists live but not in `GRANTS` fails the suite's catalog check.
 */

/** Who attempts the access. S-403 adds `"admin" | "author" | "viewer"`. */
export type Principal = "anon" | "noRole";

/** One table per policy family: plan root, catalog, student data, board state, generation jobs. */
export type RepresentativeTable = "plans" | "courses" | "students" | "placements" | "generation_jobs";

export type WriteOperation = "insert" | "update" | "delete";

export type Rpc = "clone_plan";

type Cell = Record<Principal, AccessOutcome>;

export type TableGrants = { anon: readonly TablePrivilege[]; authenticated: readonly TablePrivilege[] };

export const PRINCIPAL_NOTES: Record<Principal, string> = {
  anon: "TODAY: no session is denied everywhere, at the grant layer",
  noRole: "TODAY: a signed-in user without a role is allowed everywhere — the hole S-403 closes",
};

export const READS: Record<PublicTable, Cell> = {
  bundles: { anon: "denied", noRole: "allowed" },
  course_grouping_members: { anon: "denied", noRole: "allowed" },
  course_groupings: { anon: "denied", noRole: "allowed" },
  course_merges: { anon: "denied", noRole: "allowed" },
  course_overlaps: { anon: "denied", noRole: "allowed" },
  course_teachers: { anon: "denied", noRole: "allowed" },
  courses: { anon: "denied", noRole: "allowed" },
  generation_jobs: { anon: "denied", noRole: "allowed" },
  placements: { anon: "denied", noRole: "allowed" },
  plans: { anon: "denied", noRole: "allowed" },
  shelf_bundle_courses: { anon: "denied", noRole: "allowed" },
  shelf_bundles: { anon: "denied", noRole: "allowed" },
  student_choices: { anon: "denied", noRole: "allowed" },
  students: { anon: "denied", noRole: "allowed" },
  teacher_availability: { anon: "denied", noRole: "allowed" },
  teachers: { anon: "denied", noRole: "allowed" },
};

export const WRITES: Record<RepresentativeTable, Record<WriteOperation, Cell>> = {
  plans: {
    insert: { anon: "denied", noRole: "allowed" },
    update: { anon: "denied", noRole: "allowed" },
    delete: { anon: "denied", noRole: "allowed" },
  },
  courses: {
    insert: { anon: "denied", noRole: "allowed" },
    update: { anon: "denied", noRole: "allowed" },
    delete: { anon: "denied", noRole: "allowed" },
  },
  students: {
    insert: { anon: "denied", noRole: "allowed" },
    update: { anon: "denied", noRole: "allowed" },
    delete: { anon: "denied", noRole: "allowed" },
  },
  placements: {
    insert: { anon: "denied", noRole: "allowed" },
    update: { anon: "denied", noRole: "allowed" },
    delete: { anon: "denied", noRole: "allowed" },
  },
  generation_jobs: {
    insert: { anon: "denied", noRole: "allowed" },
    update: { anon: "denied", noRole: "allowed" },
    delete: { anon: "denied", noRole: "allowed" },
  },
};

export const RPCS: Record<Rpc, Cell> = {
  clone_plan: { anon: "denied", noRole: "allowed" },
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
  shelf_bundle_courses: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  shelf_bundles: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  student_choices: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  students: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  teacher_availability: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
  teachers: { anon: ANON_AUTO_GRANT_RESIDUE, authenticated: ALL_EIGHT },
};
