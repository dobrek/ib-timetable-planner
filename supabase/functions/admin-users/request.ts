// What the function accepts, as a pure parser: an exact shape per operation, nothing else.
//
// `app_metadata` is never accepted: the Custom Access Token Hook trusts only `app_metadata.machine_role`,
// so a field that could reach it through this function would be a way to mint a machine user. An
// unknown key is refused rather than ignored, for the same reason.

export type Role = "viewer" | "author" | "admin";

export type AdminRequest = { op: "create"; email: string; role: Role | null } | { op: "reissue"; userId: string };

export type ParseResult = { ok: true; request: AdminRequest } | { ok: false; reason: string };

const ROLES: readonly string[] = ["viewer", "author", "admin"];

// Deliberately plain: the Auth server is the real judge of an address, and answers `email_exists` or
// a validation error. This only keeps obvious garbage, and anything absurdly long, from reaching it.
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LENGTH = 254;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseRequest(body: unknown): ParseResult {
  if (!isRecord(body)) return refuse("the body must be a JSON object");
  if (body.op === "create") return parseCreate(body);
  if (body.op === "reissue") return parseReissue(body);
  return refuse("op must be create or reissue");
}

const parseCreate = (body: Record<string, unknown>): ParseResult => {
  if (!hasExactKeys(body, ["op", "email", "role"])) return refuse("create takes exactly op, email and role");
  const { email, role } = body;
  if (typeof email !== "string") return refuse("email must be a string");
  const normalised = email.trim().toLowerCase();
  if (normalised.length > MAX_EMAIL_LENGTH || !EMAIL.test(normalised)) return refuse("email is not valid");
  if (role !== null && !(typeof role === "string" && ROLES.includes(role))) {
    return refuse("role must be viewer, author, admin or null");
  }
  return { ok: true, request: { op: "create", email: normalised, role: role as Role | null } };
};

const parseReissue = (body: Record<string, unknown>): ParseResult => {
  if (!hasExactKeys(body, ["op", "userId"])) return refuse("reissue takes exactly op and userId");
  const { userId } = body;
  if (typeof userId !== "string" || !UUID.test(userId)) return refuse("userId must be a UUID");
  return { ok: true, request: { op: "reissue", userId: userId.toLowerCase() } };
};

const hasExactKeys = (body: Record<string, unknown>, keys: readonly string[]): boolean => {
  const present = Object.keys(body);
  return present.length === keys.length && keys.every((key) => present.includes(key));
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const refuse = (reason: string): ParseResult => ({ ok: false, reason });
