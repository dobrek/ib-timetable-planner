import { buildCreditedUsers, type CreditedUser, type ProfileLabel } from "@/entities/user";
import type { Database } from "@/shared/api";
import { type AppRole, EMAIL_LINK_LIFETIME_MS } from "@/shared/config";

type Tables = Database["public"]["Tables"];
type AccessChange = Pick<
  Tables["access_changes"]["Row"],
  "id" | "target_id" | "actor_id" | "actor_kind" | "occurred_at"
>;

/** The loader's four reads, each a projection of its generated row. */
export type UserDirectoryInput = {
  directory: readonly Pick<
    Tables["user_directory"]["Row"],
    | "user_id"
    | "email"
    | "is_service_account"
    | "must_change_password"
    | "invited_at"
    | "email_confirmed_at"
    | "banned_at"
  >[];
  profiles: readonly Pick<Tables["profiles"]["Row"], "user_id" | "display_name">[];
  roles: readonly Pick<Tables["user_roles"]["Row"], "user_id" | "role" | "deactivated_at">[];
  changes: readonly AccessChange[];
};

/**
 * Who made a role change: a user still on file, a user since deleted (the record keeps no
 * snapshot, so a deleted actor has no name), or the operator, meaning a write made outside any
 * session.
 */
export type ChangedBy = { kind: "user"; label: ProfileLabel } | { kind: "deleted" } | { kind: "operator" };

/**
 * Why a row can or cannot act. A pending state outranks the role: the person holds no access until
 * they choose a password of their own, even with a role waiting.
 *
 * - `banned` (S-411): the function recorded a GoTrue ban. It outranks every other state, including a
 *   pending password and a deactivation, so Reactivate and Re-issue are not offered.
 * - `invited` / `invitation_expired` (S-410): an invitation not yet accepted, whose newest link still
 *   works or has passed its lifetime. Either can be re-sent.
 * - `invitation_accepted`: the link was spent, and the person has not chosen a password yet.
 * - `temporary_password` (S-409): an account an admin created, not yet given a password of its own.
 * - `deactivated` (S-408): an admin deactivated the person. Their role is kept, and reactivating
 *   restores it; until then they hold no access.
 */
export type UserStatus =
  | "banned"
  | "active"
  | "deactivated"
  | "no_access"
  | "temporary_password"
  | "invited"
  | "invitation_expired"
  | "invitation_accepted";

export type UserRow = {
  userId: string;
  label: ProfileLabel;
  role: AppRole | null;
  status: UserStatus;
  /** Only a pending row can have its temporary password re-issued: derived here, not in the table. */
  canReissuePassword: boolean;
  /** An unaccepted invitation, expired or not: GoTrue re-sends only to an unconfirmed address. */
  canResendInvitation: boolean;
  /** Any invitation until the person chooses a password, so the admin always has a stop. */
  canRevokeInvitation: boolean;
  /**
   * Only an active row can be deactivated (S-408): a pending row has its own stop, and a row without
   * a role has nothing to keep. The table also withholds it from the admin's own row.
   */
  canDeactivate: boolean;
  /** Only a deactivated row can be reactivated, which restores the role it holds. A ban outranks it. */
  canReactivate: boolean;
  /**
   * Ban, delete and a new email (S-411) on an active, deactivated or temporary-password account, and
   * on a banned one for delete and a new email. Never on an invitation, a service account or a row
   * with no role. The table also withholds Ban and Delete from the admin's own row.
   */
  canBan: boolean;
  /** Only a banned row offers Unban. */
  canUnban: boolean;
  /** Remove the account. The plans it created stay. */
  canDelete: boolean;
  /** Give the account a new email, including the admin's own row. */
  canChangeEmail: boolean;
  isServiceAccount: boolean;
  /** The latest change to this user's role; null when none is recorded. */
  lastChange: { by: ChangedBy; at: string } | null;
};

/**
 * The Users page's rows (S-406): one per directory entry, named the way the sidebar names people,
 * with the role, the status and the latest recorded change. Machine users never arrive, because
 * RLS hides them from the directory. Sorted by label, ignoring case and accents, then by email.
 * `now` (epoch milliseconds) decides whether an invitation's link has expired, so this stays pure.
 * The input is never mutated.
 */
export function buildUserRows({ directory, profiles, roles, changes }: UserDirectoryInput, now: number): UserRow[] {
  // One credited user per directory entry, named exactly as every credit is (S-407), so a person
  // reads the same here and on a plan. The same map names each change's actor.
  const credited = buildCreditedUsers({ directory, profiles });
  const entryById = new Map(directory.map((entry) => [entry.user_id, entry]));
  const roleById = new Map(roles.map((row) => [row.user_id, row]));

  return [...credited.values()].toSorted(byLabelThenEmail).map(({ id, label, isServiceAccount }) => {
    const roleRow = roleById.get(id);
    const latest = latestChangeTo(id, changes);
    const status = statusOf(roleRow, entryById.get(id), now);
    // An invitation, a service account and a row with no role stay on their own actions (S-411).
    const canManageAccount =
      !isServiceAccount &&
      (status === "active" || status === "deactivated" || status === "temporary_password" || status === "banned");
    return {
      userId: id,
      label,
      role: roleRow?.role ?? null,
      status,
      canReissuePassword: status === "temporary_password",
      canResendInvitation: RESENDABLE.has(status),
      canRevokeInvitation: REVOCABLE.has(status),
      canDeactivate: status === "active",
      canReactivate: status === "deactivated",
      canBan: canManageAccount && status !== "banned",
      canUnban: !isServiceAccount && status === "banned",
      canDelete: canManageAccount,
      canChangeEmail: canManageAccount,
      isServiceAccount,
      lastChange: latest ? { by: changedBy(latest, credited), at: latest.occurred_at } : null,
    };
  });
}

/** The email is always on the label (FR-413): beneath the name when there is one, or as the name. */
export function emailOf({ primary, secondary }: ProfileLabel): string {
  return secondary ?? primary;
}

type DirectoryEntry = UserDirectoryInput["directory"][number];
type RoleRow = UserDirectoryInput["roles"][number];

const RESENDABLE: ReadonlySet<UserStatus> = new Set(["invited", "invitation_expired"]);
const REVOCABLE: ReadonlySet<UserStatus> = new Set(["invited", "invitation_expired", "invitation_accepted"]);

/**
 * First match wins: a recorded ban (S-411), then an unaccepted invitation, then a pending account
 * (by how it came to be), then a deactivation (S-408), then the role. A link expires once `now` is
 * past `invited_at` plus the lifetime, as GoTrue judges it (`now > sent + exp`), so the exact
 * boundary still reads as invited. An invitee who finished reads as any other account.
 */
const statusOf = (role: RoleRow | undefined, entry: DirectoryEntry | undefined, now: number): UserStatus => {
  if ((entry?.banned_at ?? null) !== null) return "banned";
  const invitedAt = entry?.invited_at ?? null;
  if (invitedAt !== null && (entry?.email_confirmed_at ?? null) === null) {
    return now > Date.parse(invitedAt) + EMAIL_LINK_LIFETIME_MS ? "invitation_expired" : "invited";
  }
  if (entry?.must_change_password) return invitedAt === null ? "temporary_password" : "invitation_accepted";
  if (!role) return "no_access";
  return role.deactivated_at === null ? "active" : "deactivated";
};

const byLabelThenEmail = (a: CreditedUser, b: CreditedUser): number =>
  compareText(a.label.primary, b.label.primary) || compareText(emailOf(a.label), emailOf(b.label));

/**
 * The newest record naming `userId` as its target: the latest `occurred_at`, then the greater `id`.
 * `occurred_at` is the transaction's start, so two records written in one transaction tie, and the
 * id, which counts up, puts them in write order. This does not depend on the loader's order.
 */
const latestChangeTo = (userId: string, changes: readonly AccessChange[]): AccessChange | undefined =>
  changes.filter((change) => change.target_id === userId).toSorted(newestFirst)[0];

const newestFirst = (a: AccessChange, b: AccessChange): number =>
  Date.parse(b.occurred_at) - Date.parse(a.occurred_at) || b.id - a.id;

/**
 * A deleted actor's id is nulled by its foreign key. An id missing from the directory belongs to an
 * account deleted between the loader's reads, so it reads as deleted too.
 */
const changedBy = (change: AccessChange, credited: ReadonlyMap<string, CreditedUser>): ChangedBy => {
  if (change.actor_kind === "operator") return { kind: "operator" };
  const label = change.actor_id === null ? undefined : credited.get(change.actor_id)?.label;
  return label ? { kind: "user", label } : { kind: "deleted" };
};

const compareText = (a: string, b: string): number => a.localeCompare(b, undefined, { sensitivity: "base" });
