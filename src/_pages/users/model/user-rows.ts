import { buildCreditedUsers, type CreditedUser, type ProfileLabel } from "@/entities/user";
import type { Database } from "@/shared/api";
import type { AppRole } from "@/shared/config";

type Tables = Database["public"]["Tables"];
type AccessChange = Pick<
  Tables["access_changes"]["Row"],
  "id" | "target_id" | "actor_id" | "actor_kind" | "occurred_at"
>;

/** The loader's four reads, each a projection of its generated row. */
export type UserDirectoryInput = {
  directory: readonly Pick<Tables["user_directory"]["Row"], "user_id" | "email" | "is_service_account">[];
  profiles: readonly Pick<Tables["profiles"]["Row"], "user_id" | "display_name">[];
  roles: readonly Pick<Tables["user_roles"]["Row"], "user_id" | "role">[];
  changes: readonly AccessChange[];
};

/**
 * Who made a role change: a user still on file, a user since deleted (the record keeps no
 * snapshot, so a deleted actor has no name), or the operator, meaning a write made outside any
 * session.
 */
export type ChangedBy = { kind: "user"; label: ProfileLabel } | { kind: "deleted" } | { kind: "operator" };

export type UserRow = {
  userId: string;
  label: ProfileLabel;
  role: AppRole | null;
  status: "active" | "no_access";
  isServiceAccount: boolean;
  /** The latest change to this user's role; null when none is recorded. */
  lastChange: { by: ChangedBy; at: string } | null;
};

/**
 * The Users page's rows (S-406): one per directory entry, named the way the sidebar names people,
 * with the role, the status and the latest recorded change. Machine users never arrive, because
 * RLS hides them from the directory. Sorted by label, ignoring case and accents, then by email.
 * The input is never mutated.
 */
export function buildUserRows({ directory, profiles, roles, changes }: UserDirectoryInput): UserRow[] {
  // One credited user per directory entry, named exactly as every credit is (S-407), so a person
  // reads the same here and on a plan. The same map names each change's actor.
  const credited = buildCreditedUsers({ directory, profiles });
  const roleById = new Map(roles.map(({ user_id, role }) => [user_id, role]));

  return [...credited.values()].toSorted(byLabelThenEmail).map(({ id, label, isServiceAccount }) => {
    const role = roleById.get(id) ?? null;
    const latest = latestChangeTo(id, changes);
    return {
      userId: id,
      label,
      role,
      status: role === null ? "no_access" : "active",
      isServiceAccount,
      lastChange: latest ? { by: changedBy(latest, credited), at: latest.occurred_at } : null,
    };
  });
}

const byLabelThenEmail = (a: CreditedUser, b: CreditedUser): number =>
  compareText(a.label.primary, b.label.primary) || compareText(emailOf(a.label), emailOf(b.label));

/** The email is always on the label (FR-413): beneath the name when there is one, or as the name. */
const emailOf = ({ primary, secondary }: ProfileLabel): string => secondary ?? primary;

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
