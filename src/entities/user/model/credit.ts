import type { ProfileLabel } from "./profile-label";

/** A person a plan or a job is credited to, named as the app names everyone (FR-413). */
export type CreditedUser = {
  id: string;
  label: ProfileLabel;
  /** Flagged as a service account (S-406), such as the calibration campaign's: badged, never passed off as a person. */
  isServiceAccount: boolean;
};

/**
 * Who a plan or a job is credited to (S-407). Serializable, so a route computes it and an island
 * renders it.
 *
 * `unknown` covers every row that names nobody we can show: one that predates S-407, one the service
 * role wrote, one whose person was deleted (the foreign key sets it to null), and an id the directory
 * does not list. A deleted person stays Unknown; S-411 keeps it that way.
 */
export type Credit = { kind: "user"; user: CreditedUser } | { kind: "unknown" };

/**
 * A credit as one line of text: "Name (email)", the email alone when there is no name, or "Unknown".
 * For an accessible name, or a sentence that says who did something.
 */
export function creditText(credit: Credit): string {
  if (credit.kind === "unknown") return "Unknown";
  const { primary, secondary } = credit.user.label;
  return secondary ? `${primary} (${secondary})` : primary;
}

/** The credit for `id`, looked up among the users a page loaded. */
export function creditFor(id: string | null, users: ReadonlyMap<string, CreditedUser>): Credit {
  const user = id === null ? undefined : users.get(id);
  return user ? { kind: "user", user } : { kind: "unknown" };
}
