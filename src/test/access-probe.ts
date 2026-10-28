import type { SupabaseClient as UntypedSupabaseClient } from "@supabase/supabase-js";
import type { Database, SupabaseClient } from "@/shared/api";

/**
 * Turns an access attempt into an established outcome, for the integration lane's role matrix.
 *
 * A denial comes in four shapes, and three of them are not errors:
 *
 * | Denial                 | Surfaces as                                                  |
 * | ---------------------- | ------------------------------------------------------------ |
 * | missing grant          | 42501 "permission denied for table …"                        |
 * | RLS on INSERT          | 42501 "new row violates row-level security policy …"         |
 * | RLS on SELECT          | an empty result, no error                                    |
 * | RLS on UPDATE / DELETE | 0 rows affected, no error                                    |
 *
 * So no outcome is read off `error` alone. A read is judged from what the principal can see; a
 * write by reading back as the service role ("assert on the row, not on `error`", the
 * solver-credential guard's rule). Any error that is not an access denial — a bad payload
 * (23503, 23505, 22P02), a 401, Kong's 502 — throws instead of passing as "denied". Otherwise every
 * denied cell would pass trivially.
 *
 * **Writes never ask for rows back.** A `return=representation` write (`.select()` chained onto it)
 * adds a RETURNING clause, which Postgres checks against the table's SELECT policy. Once S-403
 * splits read from write, a read denial would then masquerade as an INSERT denial. That isolation
 * is INSERT's alone: an UPDATE or DELETE that filters in its WHERE (`.eq("id", id)` does) is held
 * to the SELECT policy too, so a principal that may write a row but not read it reaches 0 rows,
 * and its cell reads "denied". That is the honest answer — such a principal cannot do the write
 * through the app either — but a write-only cell cannot be expressed.
 *
 * Test lane only, like `postgres-client.ts` beside it.
 */

/** An access attempt's outcome, as established by the probe. */
export type AccessOutcome = "allowed" | "denied";

export type PublicTable = keyof Database["public"]["Tables"];

/** An error as supabase-js reports one: PostgREST's (with a SQLSTATE), or a fetch failure (no code). */
export type ProbeError = { code?: string; message: string };

/**
 * The fixture's rows, by what owns them: most tables hang off a plan, `profiles` and `user_roles`
 * off a user. Each table finds its fixture rows through one of these (see `fixtureKey`).
 */
export type FixtureRef = { planId: string; profileOwnerId: string };

export type ReadEvidence = {
  error: ProbeError | null;
  /** The principal sees at least one of the fixture's rows. */
  seesFixtureRows: boolean;
  /** The principal sees at least one row of the table, the fixture's or any other. */
  seesAnyRow: boolean;
};

export type WriteEvidence = {
  error: ProbeError | null;
  /** The service role observed the write's effect. */
  effectObserved: boolean;
  /** A denial the call reports in its own words rather than as 42501. */
  deniedWhen?: RegExp;
};

export type WriteAttempt = {
  /** The write, as the principal. Never chain `.select()` onto it (see the module docblock). */
  attempt: () => PromiseLike<{ error: ProbeError | null }>;
  /** Run on the service-role client: did the write's effect land? */
  effectLanded: () => Promise<boolean>;
  deniedWhen?: RegExp;
};

const INSUFFICIENT_PRIVILEGE = "42501";

/**
 * Whether the principal may read the table, from its own view of it. "Denied" means the table
 * reads empty (or 42501), which is S-403's promise that a user with no role reads nothing.
 * Seeing other rows but none of the fixture's is neither outcome under the shared-workspace
 * model, so it throws.
 */
export function classifyRead({ error, seesFixtureRows, seesAnyRow }: ReadEvidence): AccessOutcome {
  if (error) {
    if (error.code === INSUFFICIENT_PRIVILEGE) return "denied";
    throw unexpected(error);
  }
  if (seesFixtureRows) return "allowed";
  if (!seesAnyRow) return "denied";
  throw new Error("partial visibility: the principal sees other rows but none of the fixture's");
}

/**
 * Whether the principal may call a read-only RPC, from the call's own answer: it has no effect to
 * read back and no fixture row to look for. An answer is "allowed", 42501 (no EXECUTE) is
 * "denied", and any other error throws, as everywhere else.
 */
export function classifyCall(error: ProbeError | null): AccessOutcome {
  if (!error) return "allowed";
  if (error.code === INSUFFICIENT_PRIVILEGE) return "denied";
  throw unexpected(error);
}

/** Whether a write was allowed, from the service role's read-back of its effect. */
export function classifyWrite({ error, effectObserved, deniedWhen }: WriteEvidence): AccessOutcome {
  if (!error) return effectObserved ? "allowed" : "denied";
  if (effectObserved) throw new Error(`contradiction: the write landed but reported ${formatError(error)}`);
  if (error.code === INSUFFICIENT_PRIVILEGE || deniedWhen?.test(error.message)) return "denied";
  throw unexpected(error);
}

/** Read `table` as the principal: once for the fixture's rows, once for any row at all. */
export async function probeRead(
  client: SupabaseClient,
  table: PublicTable,
  fixture: FixtureRef,
): Promise<AccessOutcome> {
  const fixtureRows = await sight(fixtureRowsQuery(client, table, fixture));
  const anyRow = await sight(untyped(client).from(table).select(fixtureKey(table, fixture).column).limit(1));
  return classifyRead({
    error: fixtureRows.error ?? anyRow.error,
    seesFixtureRows: fixtureRows.seen,
    seesAnyRow: anyRow.seen,
  });
}

/** Whether `client` sees any of the fixture's rows in `table`. Throws on any error. */
export async function seesFixtureRows(
  client: SupabaseClient,
  table: PublicTable,
  fixture: FixtureRef,
): Promise<boolean> {
  const { error, seen } = await sight(fixtureRowsQuery(client, table, fixture));
  if (error) throw new Error(`reading ${table}: ${formatError(error)}`);
  return seen;
}

/** Attempt a write as the principal, then establish its outcome by the service role's read-back. */
export async function probeWrite({ attempt, effectLanded, deniedWhen }: WriteAttempt): Promise<AccessOutcome> {
  const { error } = await attempt();
  const effectObserved = await effectLanded();
  return classifyWrite({ error, effectObserved, deniedWhen });
}

type Sighting = { error: ProbeError | null; seen: boolean };

const sight = async (query: PromiseLike<{ data: unknown[] | null; error: ProbeError | null }>): Promise<Sighting> => {
  const { data, error } = await query;
  return { error, seen: (data?.length ?? 0) > 0 };
};

type FixtureKey = { column: "id" | "plan_id" | "user_id"; value: string };

// A table's rows belong to a plan through `plan_id`, except the root itself and the user-keyed
// tables, `profiles` and `user_roles`, whose rows belong to a user.
const fixtureKey = (table: PublicTable, fixture: FixtureRef): FixtureKey => {
  if (table === "plans") return { column: "id", value: fixture.planId };
  if (table === "profiles" || table === "user_roles") return { column: "user_id", value: fixture.profileOwnerId };
  return { column: "plan_id", value: fixture.planId };
};

const fixtureRowsQuery = (client: SupabaseClient, table: PublicTable, fixture: FixtureRef) => {
  const { column, value } = fixtureKey(table, fixture);
  return untyped(client).from(table).select(column).eq(column, value).limit(1);
};

// One code path reads every table, so the probe drops the per-table row types it cannot use.
const untyped = (client: SupabaseClient): UntypedSupabaseClient => client;

// A fetch failure carries an empty `code`, and a non-JSON error body (Kong's 502) none at all.
const formatError = ({ code, message }: ProbeError): string => (code ? `${code}: ${message}` : message);

const unexpected = (error: ProbeError): Error => new Error(`not an access denial — ${formatError(error)}`);
