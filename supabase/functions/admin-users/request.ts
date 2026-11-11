// What the function accepts, as a pure parser: an exact shape per operation, nothing else. Anything
// else is `null`, which the handler answers with one 422, whatever the reason.
//
// `app_metadata` is never accepted: the Custom Access Token Hook trusts only `app_metadata.machine_role`,
// so a field that could reach it through this function would be a way to mint a machine user. An
// unknown key is refused rather than ignored, for the same reason. An invitation never carries `data`
// (user metadata, which the invitee can edit) or a `redirectTo`: the role lives in `user_roles`, and
// the email builds its link from the Site URL.

export type Role = "viewer" | "author" | "admin";

export type AdminRequest =
  | { op: "create"; email: string; role: Role | null }
  | { op: "invite"; email: string; role: Role }
  | { op: "reissue"; userId: string }
  | { op: "resend"; userId: string }
  | { op: "revoke"; userId: string };

const ROLES: readonly string[] = ["viewer", "author", "admin"];

// Deliberately plain: the Auth server is the real judge of an address, and answers `email_exists` or
// a validation error. This only keeps obvious garbage, and anything absurdly long, from reaching it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequest(body: unknown): AdminRequest | null {
  if (!isRecord(body)) return null;
  switch (body.op) {
    case "create":
      return parseCreate(body);
    case "invite":
      return parseInvite(body);
    case "reissue":
    case "resend":
    case "revoke":
      return parseTarget(body, body.op);
    default:
      return null;
  }
}

/** A role may be null: the admin creates an account with no access yet. */
const parseCreate = (body: Record<string, unknown>): AdminRequest | null => {
  if (!hasExactKeys(body, ["op", "email", "role"])) return null;
  const email = normaliseEmail(body.email);
  const { role } = body;
  if (email === null || (role !== null && !isRole(role))) return null;
  return { op: "create", email, role };
};

/** A role is required: an invitation that grants nothing would land the colleague nowhere (FR-401). */
const parseInvite = (body: Record<string, unknown>): AdminRequest | null => {
  if (!hasExactKeys(body, ["op", "email", "role"])) return null;
  const email = normaliseEmail(body.email);
  const { role } = body;
  if (email === null || !isRole(role)) return null;
  return { op: "invite", email, role };
};

const parseTarget = (body: Record<string, unknown>, op: "reissue" | "resend" | "revoke"): AdminRequest | null => {
  if (!hasExactKeys(body, ["op", "userId"])) return null;
  const { userId } = body;
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  return { op, userId: userId.toLowerCase() };
};

/** Trimmed and lowercased, or null when it is not plausibly an address. */
const normaliseEmail = (email: unknown): string | null => {
  if (typeof email !== "string") return null;
  const normalised = email.trim().toLowerCase();
  return normalised.length <= MAX_EMAIL_LENGTH && EMAIL.test(normalised) ? normalised : null;
};

const isRole = (role: unknown): role is Role => typeof role === "string" && ROLES.includes(role);

const hasExactKeys = (body: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(body);
  return present.length === keys.length && keys.every((key) => present.includes(key));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
