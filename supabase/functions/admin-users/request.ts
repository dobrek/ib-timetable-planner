// What the function accepts, as a pure parser: an exact shape per operation, nothing else. Anything
// else is `null`, which the handler answers with one 422, whatever the reason.
//
// `app_metadata` is never accepted: the Custom Access Token Hook trusts only `app_metadata.machine_role`,
// so a field that could reach it through this function would be a way to mint a machine user. An
// unknown key is refused rather than ignored, for the same reason.

export type Role = "viewer" | "author" | "admin";

export type AdminRequest = { op: "create"; email: string; role: Role | null } | { op: "reissue"; userId: string };

const ROLES: readonly string[] = ["viewer", "author", "admin"];

// Deliberately plain: the Auth server is the real judge of an address, and answers `email_exists` or
// a validation error. This only keeps obvious garbage, and anything absurdly long, from reaching it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequest(body: unknown): AdminRequest | null {
  if (!isRecord(body)) return null;
  if (body.op === "create") return parseCreate(body);
  if (body.op === "reissue") return parseReissue(body);
  return null;
}

const parseCreate = (body: Record<string, unknown>): AdminRequest | null => {
  if (!hasExactKeys(body, ["op", "email", "role"])) return null;
  const { email, role } = body;
  if (typeof email !== "string") return null;
  const normalised = email.trim().toLowerCase();
  if (normalised.length > MAX_EMAIL_LENGTH || !EMAIL.test(normalised)) return null;
  if (role !== null && !(typeof role === "string" && ROLES.includes(role))) return null;
  return { op: "create", email: normalised, role: role as Role | null };
};

const parseReissue = (body: Record<string, unknown>): AdminRequest | null => {
  if (!hasExactKeys(body, ["op", "userId"])) return null;
  const { userId } = body;
  if (typeof userId !== "string" || !UUID.test(userId)) return null;
  return { op: "reissue", userId: userId.toLowerCase() };
};

const hasExactKeys = (body: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(body);
  return present.length === keys.length && keys.every((key) => present.includes(key));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
