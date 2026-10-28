import { describe, expect, it } from "vitest";
import {
  GRANTS,
  PROFILE_WRITES,
  RPCS,
  SELF_GRANT_EVIDENCE,
  SELF_GRANTS,
  USER_KEYED_READS,
  WRITES,
  type OwnRowOutcome,
  type ProfileWriteOperation,
  type SelfGrant,
} from "./role-matrix-expectations";

/**
 * Guards the expectation table's shape, which is what makes a denied cell mean something.
 *
 * Every write and RPC sends one shared payload to every principal. A cell can only pass as
 * "denied" honestly if that payload is valid, and only an "allowed" cell proves it is: the probe
 * throws on any non-access error, so an allowed principal's success is the evidence. A row where
 * every principal is denied would pass on a broken payload, so the table may never hold one,
 * with two kinds of exception:
 *
 * - A `PROFILE_WRITES.others` row or `PROFILE_REKEY`, whose payload differs from its `own`
 *   counterpart only in whose `user_id` it names. The `own` row's allowed principal is its evidence.
 * - A `SELF_GRANTS` row, which no app principal may send at all. The service role sends the same
 *   payload to a fresh user in the same starting state instead, and `SELF_GRANT_EVIDENCE` records
 *   that it lands.
 *
 * `"no-row"` states that a principal lacks the row its cell targets. Only noRole's own `user_roles`
 * row can be missing, since every other principal holds the row its cells aim at, so the marker
 * may appear nowhere else.
 */
const writeRows = Object.entries(WRITES).flatMap(([table, operations]) =>
  Object.entries(operations).map(([operation, cell]) => [`${operation} ${table}`, cell] as const),
);
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];
const ownProfileRows = PROFILE_OPERATIONS.map(
  (operation) => [`${operation} own profile`, PROFILE_WRITES.own[operation]] as const,
);
// Each all-denied profile row, paired with the `own` cell that evidences its payload.
const othersProfileRows = [
  ...PROFILE_OPERATIONS.map(
    (operation) => [`${operation} another user's profile`, PROFILE_WRITES.own[operation]] as const,
  ),
  ["re-key own profile onto another user", PROFILE_WRITES.own.update] as const,
];
// Each all-denied self-grant row, paired with the service role's outcome for the same payload.
const selfGrantRows = (Object.keys(SELF_GRANTS) as SelfGrant[]).map(
  (grant) => [grant, SELF_GRANT_EVIDENCE[grant]] as const,
);
const rpcRows = Object.entries(RPCS);
const grantLists = Object.entries(GRANTS).flatMap(([table, grants]) =>
  Object.entries(grants).map(([role, privileges]) => [`${role} on ${table}`, privileges] as const),
);
const noRowCells = [
  ...Object.entries(USER_KEYED_READS).flatMap(([table, owners]) =>
    Object.entries(owners).flatMap(([owner, cell]) =>
      noRowPrincipals(cell).map((principal) => `${principal} reading the ${owner} ${table} row`),
    ),
  ),
  ...Object.entries(SELF_GRANTS).flatMap(([grant, cell]) =>
    noRowPrincipals(cell).map((principal) => `${principal} attempting ${grant}`),
  ),
];

describe("role-matrix expectations", () => {
  it.each([...writeRows, ...ownProfileRows, ...rpcRows])("%s has at least one allowed principal", (_row, cell) => {
    expect(Object.values(cell)).toContain("allowed");
  });

  it.each(othersProfileRows)("%s is evidenced by its own-row counterpart", (_row, ownCell) => {
    expect(Object.values(ownCell)).toContain("allowed");
  });

  it.each(selfGrantRows)("self-grant %s is evidenced by the service role sending its payload", (_row, evidence) => {
    expect(evidence).toBe("allowed");
  });

  it("only noRole's own user_roles row is no-row: the one row a principal's cell can lack", () => {
    expect(noRowCells).toEqual(["noRole reading the own user_roles row", "noRole attempting drop own role"]);
  });

  it.each(grantLists)("the grant list for %s is sorted and free of duplicates", (_list, privileges) => {
    expect(privileges).toEqual([...new Set(privileges)].sort());
  });
});

function noRowPrincipals(cell: Record<string, OwnRowOutcome>): string[] {
  return Object.entries(cell)
    .filter(([, outcome]) => outcome === "no-row")
    .map(([principal]) => principal);
}
