import type { AccessOutcome, PublicTable, UserKeyedTable } from "./access-probe";
import type { TablePrivilege } from "./postgres-client";

/**
 * The access spec as data: what each principal may do, which `role-matrix.integration.test.ts`
 * runs live, cell by cell. An access change starts here, as a diff to this file. S-403 flipped these
 * cells to the fail-closed posture before its policy migration existed, ran them red against the
 * old policies (the `fail-closed-roles` change's deny drill), and then
 * `20261028200630_fail_closed_policies.sql` turned them green.
 *
 * The posture since S-403, with S-406's admin write path:
 *
 * - Every `public` table but the user-keyed ones (`USER_KEY_COLUMN`) has RLS on and the four
 *   policies in `CAPABILITY_POLICIES`. Reading needs a role (`private.can_read()`); writing needs
 *   `admin` or `author` (`private.can_edit()`). So a viewer reads every plan and writes none, and a
 *   signed-in user without a role reaches none of it. The behavioural cells cover five
 *   representative tables, and the suite's structural check proves the four policies on all sixteen.
 * - A viewer's INSERT and UPDATE fail with 42501 and its DELETE matches no rows, so its write cells
 *   read "denied" either way: the probe judges a write by the service role's read-back.
 * - `profiles` (S-401): a user reads their own row, and anyone holding a role reads every row. A
 *   user inserts and updates only their own row, whatever their role, and nobody deletes one.
 *   `PROFILE_WRITES` holds the "whose row" cells.
 * - `user_roles`: a signed-in human reads their own role row; an admin (`private.can_manage_users()`)
 *   reads every row, and gives, changes and removes anyone's role (`ROLE_WRITES`), never a machine
 *   user's (`MACHINE_ROLE_GRANT`). Nobody else writes one, their own included (`SELF_GRANTS`). An
 *   admin's own row is never probed here: the last-admin guard's suite owns that, on a throwaway
 *   admin, so this file never demotes its own principal.
 * - `access_changes` (S-406): the record of every role write, written by `user_roles`' trigger. Only
 *   an admin reads it, and no session writes it directly, an admin included (`ACCESS_CHANGE_WRITES`).
 *   A row is "a user's" through `target_id`, the user the change was made to.
 * - `user_directory` (S-406): the Auth trigger's mirror of `auth.users`. It is read like `profiles`
 *   (own row, or any row with a role), never shows a machine user to anyone
 *   (`MACHINE_DIRECTORY_READ`), and no session writes it (`DIRECTORY_WRITES`).
 * - `generation_jobs` (S-407): a job records who requested it and who first asked it to stop.
 *   Stopping it, by either of `stopGeneration`'s two writes, is allowed to its requester or an admin
 *   (`private.can_stop_any_job()`), and to any editor when the job records no requester (`JOB_STOPS`).
 *   No session rewrites either column (`JOB_ATTRIBUTION_REWRITES`). A trigger enforces both: RLS
 *   judges rows, not column changes, and the job keeps the four capability policies, so delivery
 *   and reclaim stay open to any editor.
 * - admin holds an author's access to every plan, plus the two admin-only tables above.
 * - `anon` holds no DML grant on any table, so PostgREST refuses it outright (42501). It still holds
 *   Supabase's auto-granted TRUNCATE, REFERENCES, TRIGGER and MAINTAIN on 15 tables, which
 *   PostgREST cannot reach; `generation_jobs` and the user-keyed tables revoked all eight
 *   (lessons.md, "granting a role is not excluding the others").
 * - `authenticated` holds all eight privileges everywhere except the user-keyed tables: `profiles`
 *   (INSERT, SELECT, UPDATE), `user_directory` (SELECT), `user_roles` (the four DML verbs) and
 *   `access_changes` (INSERT, SELECT: no UPDATE or DELETE, so the record is append-only). So, for a
 *   signed-in user, RLS is the lock, and the role it holds is what RLS judges.
 *
 * Completeness is enforced: a missing principal or table is a type error, so a new principal, or a
 * new table in `database.types.ts`, fails `pnpm check` until every cell is declared. A table that
 * exists live but not in `GRANTS` fails the suite's catalog check, a plan-scoped table without
 * exactly the four capability policies fails its structural check, and a user-keyed table whose
 * policies differ from `USER_KEYED_POLICIES` fails its own.
 */

/**
 * Who attempts the access: no session, a session without a role, an admin whose temporary password is
 * still pending (S-409), and a session per app role.
 */
export type Principal = "anon" | "noRole" | "pendingAdmin" | "viewer" | "author" | "admin";

/** Every public table whose rows belong to a plan (the root included), rather than to a user. */
export type PlanScopedTable = Exclude<PublicTable, UserKeyedTable>;

/** One table per policy family: plan root, catalog, student data, board state, generation jobs. */
export type RepresentativeTable = "plans" | "courses" | "students" | "placements" | "generation_jobs";

export type WriteOperation = "insert" | "update" | "delete";

/** Whose row a cell on a user-keyed table targets: the principal's own, or another user's. */
export type RowOwner = "own" | "others";

/** A profile has no DELETE cell: `GRANTS.profiles` holds no DELETE, which the catalog check proves. */
export type ProfileWriteOperation = "insert" | "update";

/**
 * `clone_plan` and `set_current_plan` write; `own_app_role` only answers the caller's own role (the
 * app's role read). `set_current_plan` moves the one current-plan marker (S-404).
 * `apply_generated_placements` lands a generated board (delivery's write) and
 * `replace_cohort_groupings` persists computed groupings: both INVOKER, so RLS judges every write
 * inside them, and S-405 records that a viewer can do neither.
 */
export type Rpc =
  | "apply_generated_placements"
  | "clone_plan"
  | "own_app_role"
  | "replace_cohort_groupings"
  | "set_current_plan";

/**
 * Whose job a stop targets: the principal's own, another user's, or a legacy job that records no
 * requester (it predates S-407, or its requester was deleted).
 */
export type JobRequester = "own" | "others" | "legacy";

/** The two writes `stopGeneration` sends: `queued → stopped`, and the flag on a `running` job. */
export type StopWrite = "stop queued" | "stop running";

/** The attribution columns on a job, which only the guard trigger and the service role write. */
export type JobAttributionColumn = "requested_by" | "stop_requested_by";

/** A principal writing its own `user_roles` row (see `SELF_GRANTS`). */
export type SelfGrant = "claim admin" | "drop own role";

/** Every principal but admin, whose own role row the matrix never writes (see `SELF_GRANTS`). */
export type SelfGrantPrincipal = Exclude<Principal, "admin">;

/**
 * A cell that targets the principal's own row, which the principal may not hold. noRole holds no
 * `user_roles` row, and so no `access_changes` record names it either: its cells there are
 * `"no-row"`, stated rather than faked as `denied`, and checked live as the row's absence instead of
 * probed. pendingAdmin does hold both rows, so its own-row cells are real: it reads its own role row
 * (the policy asks only for ownership) and is refused its own access record (admins only).
 */
export type OwnRowOutcome = AccessOutcome | "no-row";

type Cell = Record<Principal, AccessOutcome>;

type OwnRowCell = Record<Principal, OwnRowOutcome>;

export type TableGrants = { anon: readonly TablePrivilege[]; authenticated: readonly TablePrivilege[] };

export const PRINCIPAL_NOTES: Record<Principal, string> = {
  anon: "no session is denied everywhere, at the grant layer",
  noRole: "a signed-in user without a role reaches only its own profile and directory row, and no plan data at all",
  pendingAdmin:
    "an admin row whose temporary password is still pending (S-409) reaches exactly what noRole reaches: the role reads as none until the first real password change",
  viewer: "a viewer reads every plan, profile and directory row, and writes only its own profile",
  author: "an author reads and writes every plan, and writes only its own profile",
  admin: "an admin holds an author's access, and also reads every role and access change and writes others' roles",
};

// The cells most tables share, named like the grant lists below. A cell that differs from these is
// written out in full, so it stands out. Declared before the tables that use them.
const NOBODY: Cell = {
  anon: "denied",
  noRole: "denied",
  pendingAdmin: "denied",
  viewer: "denied",
  author: "denied",
  admin: "denied",
};
const SIGNED_IN: Cell = {
  anon: "denied",
  noRole: "allowed",
  pendingAdmin: "allowed",
  viewer: "allowed",
  author: "allowed",
  admin: "allowed",
};
const ANY_ROLE: Cell = {
  anon: "denied",
  noRole: "denied",
  pendingAdmin: "denied",
  viewer: "allowed",
  author: "allowed",
  admin: "allowed",
};
const EDITORS: Cell = {
  anon: "denied",
  noRole: "denied",
  pendingAdmin: "denied",
  viewer: "denied",
  author: "allowed",
  admin: "allowed",
};
const ADMIN_ONLY: Cell = {
  anon: "denied",
  noRole: "denied",
  pendingAdmin: "denied",
  viewer: "denied",
  author: "denied",
  admin: "allowed",
};

export const READS: Record<PlanScopedTable, Cell> = {
  bundles: ANY_ROLE,
  course_grouping_members: ANY_ROLE,
  course_groupings: ANY_ROLE,
  course_merges: ANY_ROLE,
  course_overlaps: ANY_ROLE,
  course_teachers: ANY_ROLE,
  courses: ANY_ROLE,
  generation_jobs: ANY_ROLE,
  placements: ANY_ROLE,
  plans: ANY_ROLE,
  shelf_bundle_courses: ANY_ROLE,
  shelf_bundles: ANY_ROLE,
  student_choices: ANY_ROLE,
  students: ANY_ROLE,
  teacher_availability: ANY_ROLE,
  teachers: ANY_ROLE,
};

/**
 * Reads of the user-keyed tables, by whose row the read names. A targeted read never sees "other
 * rows but not this one", so an own-row policy reads as allowed on the principal's own row and
 * denied on another user's. `others` is the fixture owner, who holds a profile, a role row, and the
 * operator's record of that role being given. Each principal holding a role is named by the same
 * record of its own, from its factory's insert.
 */
export const USER_KEYED_READS: Record<UserKeyedTable, Record<RowOwner, OwnRowCell>> = {
  access_changes: {
    own: {
      anon: "denied",
      noRole: "no-row",
      pendingAdmin: "denied",
      viewer: "denied",
      author: "denied",
      admin: "allowed",
    },
    others: ADMIN_ONLY,
  },
  profiles: { own: SIGNED_IN, others: ANY_ROLE },
  user_directory: { own: SIGNED_IN, others: ANY_ROLE },
  user_roles: {
    own: {
      anon: "denied",
      noRole: "no-row",
      pendingAdmin: "allowed",
      viewer: "allowed",
      author: "allowed",
      admin: "allowed",
    },
    others: ADMIN_ONLY,
  },
};

/**
 * A machine user's directory row, which the read policy hides from every human session: the list a
 * role-holder reads is the school's people, never the solver. The row exists (the suite proves it
 * as the service role before probing), so an empty read can only mean the policy refused it.
 */
export const MACHINE_DIRECTORY_READ: Cell = NOBODY;

export const WRITES: Record<RepresentativeTable, Record<WriteOperation, Cell>> = {
  plans: { insert: EDITORS, update: EDITORS, delete: EDITORS },
  courses: { insert: EDITORS, update: EDITORS, delete: EDITORS },
  students: { insert: EDITORS, update: EDITORS, delete: EDITORS },
  placements: { insert: EDITORS, update: EDITORS, delete: EDITORS },
  generation_jobs: { insert: EDITORS, update: EDITORS, delete: EDITORS },
};

/**
 * The "whose row" dimension `WRITES` cannot hold. The `own` cells are the evidence that each
 * payload is valid; the `others` cells, which deny everyone, are the claim under test. The
 * expectations test checks each `others` row through its `own` counterpart.
 */
export const PROFILE_WRITES: Record<RowOwner, Record<ProfileWriteOperation, Cell>> = {
  own: { insert: SIGNED_IN, update: SIGNED_IN },
  others: { insert: NOBODY, update: NOBODY },
};

/**
 * Stopping a job (S-407), by whose job it is. Each cell stops a fresh job the service role made with
 * an explicit requester, by sending exactly the UPDATE `stopGeneration` sends.
 *
 * - **own.** The principal's own job. An author or admin stops it. A viewer passes the guard (it is
 *   their job), then the UPDATE policy's WITH CHECK, which runs after BEFORE triggers, refuses them:
 *   a requester demoted to viewer loses Stop. noRole matches no row. Anon has no id, so it requests
 *   no job: `"no-row"`.
 * - **others.** Another user's job: only `stop_any_job` (admin) stops it. An author or a viewer is
 *   refused by the guard trigger, with 42501.
 * - **legacy.** A job with no requester stays stoppable by every editor, exactly as any job was
 *   before S-407: the same cell as `WRITES.generation_jobs.update`, which the expectations test checks.
 */
export const JOB_STOPS: Record<JobRequester, Record<StopWrite, OwnRowCell>> = {
  own: {
    "stop queued": {
      anon: "no-row",
      noRole: "denied",
      pendingAdmin: "denied",
      viewer: "denied",
      author: "allowed",
      admin: "allowed",
    },
    "stop running": {
      anon: "no-row",
      noRole: "denied",
      pendingAdmin: "denied",
      viewer: "denied",
      author: "allowed",
      admin: "allowed",
    },
  },
  others: { "stop queued": ADMIN_ONLY, "stop running": ADMIN_ONLY },
  legacy: { "stop queued": EDITORS, "stop running": EDITORS },
};

/**
 * Rewriting a job's attribution: an UPDATE of another user's job that points the column at the
 * principal (anon, which has no id, at a fresh user). The guard refuses it for every signed-in
 * session, an admin included: claiming a job's requester would hand its Stop to the claimant, and
 * the stopper is recorded only by the stop itself. A viewer reaches the guard too (the UPDATE
 * policy's WITH CHECK runs only after BEFORE triggers) and is refused by it, and noRole matches no
 * row. No app principal is allowed, so `JOB_ATTRIBUTION_REWRITE_EVIDENCE`
 * evidences the payloads.
 */
export const JOB_ATTRIBUTION_REWRITES: Record<JobAttributionColumn, Cell> = {
  requested_by: NOBODY,
  stop_requested_by: NOBODY,
};

/**
 * The same rewrites, sent by the service role, which the guard lets through so the factories and
 * the matrix can name explicit ids: each payload's evidence.
 */
export const JOB_ATTRIBUTION_REWRITE_EVIDENCE: Record<JobAttributionColumn, AccessOutcome> = {
  requested_by: "allowed",
  stop_requested_by: "allowed",
};

/**
 * Re-keying: an UPDATE of the principal's own profile that names another user's `user_id`. The
 * UPDATE policy's `with check` is its only lock, so S-403's policy rewrite must keep this denied.
 * Its payload differs from `PROFILE_WRITES.own.update` only in that column, which is its evidence.
 */
export const PROFILE_REKEY: Cell = NOBODY;

/**
 * Self-grants: a principal without `manage_users` writing its own `user_roles` row. Since S-406
 * `authenticated` holds the write grants, so RLS refuses these: an INSERT fails its WITH CHECK
 * (42501), and an UPDATE or DELETE matches no row.
 *
 * - **claim admin.** A principal holding no role row INSERTs one as `admin` (noRole); one holding
 *   a row UPDATEs it to `admin` (viewer, author).
 * - **drop own role.** A principal holding a role row DELETEs it. noRole holds none: `"no-row"`.
 *
 * Admin has no cell. It may write its own row, and doing so through the shared principal would
 * demote it mid-file, so its self-change is proven on a throwaway admin by the last-admin guard's
 * and the access record's suites. Anon owns no row, so its cells aim at a fresh user in the state
 * each write needs. No principal here is allowed, so `SELF_GRANT_EVIDENCE` evidences the payloads.
 */
export const SELF_GRANTS: Record<SelfGrant, Record<SelfGrantPrincipal, OwnRowOutcome>> = {
  "claim admin": { anon: "denied", noRole: "denied", pendingAdmin: "denied", viewer: "denied", author: "denied" },
  "drop own role": { anon: "denied", noRole: "no-row", pendingAdmin: "denied", viewer: "denied", author: "denied" },
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

/**
 * An admin's role writes, each against a fresh user in the state the write needs: give a role to a
 * user holding none (INSERT), change one (UPDATE), remove one (DELETE). None ever names an admin's
 * row, so the last-admin guard never binds here. The role written is `viewer`, so the matrix makes
 * no extra admins either. Only `manage_users` (admin) may; every other principal is refused by RLS.
 */
export const ROLE_WRITES: Record<WriteOperation, Cell> = {
  insert: ADMIN_ONLY,
  update: ADMIN_ONLY,
  delete: ADMIN_ONLY,
};

/**
 * Giving the machine fixture a role, which even an admin may not: the INSERT policy's WITH CHECK
 * asks for the target's directory row, and the directory's read policy hides every machine. Its
 * payload differs from `ROLE_WRITES.insert` only in whose `user_id` it names, which is its evidence.
 */
export const MACHINE_ROLE_GRANT: Cell = NOBODY;

/**
 * Direct writes to the access-change record. Only `user_roles`' trigger writes it: the INSERT policy
 * holds only in trigger context (`pg_trigger_depth() > 0`), so a direct INSERT is refused even for
 * an admin naming itself as the actor, and `authenticated` holds no UPDATE or DELETE grant. No app
 * principal is allowed, so `ACCESS_CHANGE_WRITE_EVIDENCE` evidences the payloads.
 */
export const ACCESS_CHANGE_WRITES: Record<WriteOperation, Cell> = {
  insert: NOBODY,
  update: NOBODY,
  delete: NOBODY,
};

/** The same record writes, sent by the service role to a fresh user's record: each payload's evidence. */
export const ACCESS_CHANGE_WRITE_EVIDENCE: Record<WriteOperation, AccessOutcome> = {
  insert: "allowed",
  update: "allowed",
  delete: "allowed",
};

/**
 * Writes to the directory, each against a fresh user's row. Only the Auth trigger and the
 * migration's backfill write it: `authenticated` holds SELECT alone, so the grant layer refuses
 * every cell, whoever's row it names. No app principal is allowed, so `DIRECTORY_WRITE_EVIDENCE`
 * evidences the payloads.
 */
export const DIRECTORY_WRITES: Record<WriteOperation, Cell> = {
  insert: NOBODY,
  update: NOBODY,
  delete: NOBODY,
};

/** The same directory writes, sent by the service role to a fresh user: each payload's evidence. */
export const DIRECTORY_WRITE_EVIDENCE: Record<WriteOperation, AccessOutcome> = {
  insert: "allowed",
  update: "allowed",
  delete: "allowed",
};

export const RPCS: Record<Rpc, Cell> = {
  apply_generated_placements: EDITORS,
  clone_plan: EDITORS,
  own_app_role: SIGNED_IN,
  replace_cohort_groupings: EDITORS,
  set_current_plan: EDITORS,
};

/** A policy's command, as `pg_policies.cmd` spells it. */
export type PolicyCommand = "ALL" | "SELECT" | "INSERT" | "UPDATE" | "DELETE";

/** A policy as `pg_policies` states it: a predicate is Postgres' own deparse, and null when absent. */
export type PolicyShape = {
  name: string;
  command: PolicyCommand;
  roles: readonly string[];
  using: string | null;
  withCheck: string | null;
};

// The deparse of `(select private.can_read())`: the `( SELECT … AS …)` form is the wrapper itself,
// which makes the helper an InitPlan, run once per table reference rather than once per row.
const CAN_READ = "( SELECT private.can_read() AS can_read)";
const CAN_EDIT = "( SELECT private.can_edit() AS can_edit)";
const CAN_MANAGE_USERS = "( SELECT private.can_manage_users() AS can_manage_users)";

/**
 * The policies a human session falls under on every plan-scoped table, and nothing else: reading
 * needs a role, writing needs `admin` or `author`. UPDATE reaches a row by `can_read` and checks it
 * by `can_edit`, so a viewer's UPDATE fails with 42501 instead of matching no rows and reporting
 * success. The structural check proves this list on all sixteen tables, which is what covers the
 * eleven that hold no behavioural cell. Sorted by command, the way that check reads them.
 */
export const CAPABILITY_POLICIES: readonly PolicyShape[] = [
  { name: "Editors delete rows", command: "DELETE", roles: ["authenticated"], using: CAN_EDIT, withCheck: null },
  { name: "Editors insert rows", command: "INSERT", roles: ["authenticated"], using: null, withCheck: CAN_EDIT },
  { name: "Readers read every row", command: "SELECT", roles: ["authenticated"], using: CAN_READ, withCheck: null },
  { name: "Editors update rows", command: "UPDATE", roles: ["authenticated"], using: CAN_READ, withCheck: CAN_EDIT },
];

const OWN_ROW = "(user_id = ( SELECT auth.uid() AS uid))";

// A role row's target must be a user the admin can see in the directory, which no machine is.
// Whitespace-normalised, as the structural check reads it: Postgres deparses a subquery over lines.
const LISTED_TARGET = `(${CAN_MANAGE_USERS} AND (EXISTS ( SELECT 1 FROM user_directory d WHERE (d.user_id = user_roles.user_id))))`;

/**
 * Every policy on each user-keyed table, whatever role it names, as `pg_policies` deparses it and
 * sorted by command, then name. These tables do not fit the four capability policies: a user owns
 * their row whatever their role. The structural check compares the live catalog against this map,
 * so a new policy, a drifted predicate or a widened role list fails it. Only the solver's
 * `to solver_job_writer` policies, which no human session holds, are left out.
 *
 * `user_directory`'s mirror policy names `supabase_auth_admin`, the role GoTrue writes `auth.users`
 * as and the Auth trigger therefore runs as: the recorded exception to "every policy names
 * `to authenticated`". It is never PUBLIC, and the grant layer withholds DELETE from it.
 *
 * Predicates are compared with runs of whitespace collapsed to one space, because Postgres deparses
 * a subquery across several lines.
 */
export const USER_KEYED_POLICIES: Record<UserKeyedTable, readonly PolicyShape[]> = {
  access_changes: [
    {
      name: "Role triggers record changes",
      command: "INSERT",
      roles: ["authenticated"],
      using: null,
      withCheck: `((pg_trigger_depth() > 0) AND (NOT (actor_id IS DISTINCT FROM ( SELECT auth.uid() AS uid))) AND ${CAN_MANAGE_USERS})`,
    },
    {
      name: "Admins read access changes",
      command: "SELECT",
      roles: ["authenticated"],
      using: CAN_MANAGE_USERS,
      withCheck: null,
    },
  ],
  profiles: [
    {
      name: "Users insert their own profile",
      command: "INSERT",
      roles: ["authenticated"],
      using: null,
      withCheck: OWN_ROW,
    },
    {
      name: "Users read their own profile, readers every profile",
      command: "SELECT",
      roles: ["authenticated"],
      using: `(${OWN_ROW} OR ${CAN_READ})`,
      withCheck: null,
    },
    {
      name: "Users update their own profile",
      command: "UPDATE",
      roles: ["authenticated"],
      using: OWN_ROW,
      withCheck: OWN_ROW,
    },
  ],
  user_directory: [
    { name: "Auth mirrors users", command: "ALL", roles: ["supabase_auth_admin"], using: "true", withCheck: "true" },
    {
      name: "Readers read the directory",
      command: "SELECT",
      roles: ["authenticated"],
      using: `((NOT is_machine) AND (${OWN_ROW} OR ${CAN_READ}))`,
      withCheck: null,
    },
  ],
  user_roles: [
    {
      name: "Admins remove roles",
      command: "DELETE",
      roles: ["authenticated"],
      using: CAN_MANAGE_USERS,
      withCheck: null,
    },
    { name: "Admins grant roles", command: "INSERT", roles: ["authenticated"], using: null, withCheck: LISTED_TARGET },
    {
      name: "Users read their own role, admins every role",
      command: "SELECT",
      roles: ["authenticated"],
      using: `(${OWN_ROW} OR ${CAN_MANAGE_USERS})`,
      withCheck: null,
    },
    {
      name: "Admins change roles",
      command: "UPDATE",
      roles: ["authenticated"],
      using: CAN_MANAGE_USERS,
      withCheck: LISTED_TARGET,
    },
  ],
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
const DML: readonly TablePrivilege[] = ["DELETE", "INSERT", "SELECT", "UPDATE"];
const APPEND_ONLY: readonly TablePrivilege[] = ["INSERT", "SELECT"];

export const GRANTS: Record<PublicTable, TableGrants> = {
  access_changes: { anon: NONE, authenticated: APPEND_ONLY },
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
  user_directory: { anon: NONE, authenticated: READ_ONLY },
  user_roles: { anon: NONE, authenticated: DML },
};
