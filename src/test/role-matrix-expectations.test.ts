import { describe, expect, it } from "vitest";
import { GRANTS, PROFILE_WRITES, RPCS, WRITES, type ProfileWriteOperation } from "./role-matrix-expectations";

/**
 * Guards the expectation table's shape, which is what makes a denied cell mean something.
 *
 * Every write and RPC sends one shared payload to every principal. A cell can only pass as
 * "denied" honestly if that payload is valid, and only an "allowed" cell proves it is: the probe
 * throws on any non-access error, so an allowed principal's success is the evidence. A row where
 * every principal is denied would pass on a broken payload, so the table may never hold one —
 * except a `PROFILE_WRITES.others` row, whose payload differs from its `own` counterpart only in
 * whose `user_id` it names. The `own` row's allowed principal is that row's evidence.
 */
const writeRows = Object.entries(WRITES).flatMap(([table, operations]) =>
  Object.entries(operations).map(([operation, cell]) => [`${operation} ${table}`, cell] as const),
);
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];
const ownProfileRows = PROFILE_OPERATIONS.map(
  (operation) => [`${operation} own profile`, PROFILE_WRITES.own[operation]] as const,
);
// Each `others` row, paired with the `own` cell that evidences its payload.
const othersProfileRows = PROFILE_OPERATIONS.map(
  (operation) => [`${operation} another user's profile`, PROFILE_WRITES.own[operation]] as const,
);
const rpcRows = Object.entries(RPCS);
const grantLists = Object.entries(GRANTS).flatMap(([table, grants]) =>
  Object.entries(grants).map(([role, privileges]) => [`${role} on ${table}`, privileges] as const),
);

describe("role-matrix expectations", () => {
  it.each([...writeRows, ...ownProfileRows, ...rpcRows])("%s has at least one allowed principal", (_row, cell) => {
    expect(Object.values(cell)).toContain("allowed");
  });

  it.each(othersProfileRows)("%s is evidenced by its own-row counterpart", (_row, ownCell) => {
    expect(Object.values(ownCell)).toContain("allowed");
  });

  it.each(grantLists)("the grant list for %s is sorted and free of duplicates", (_list, privileges) => {
    expect(privileges).toEqual([...new Set(privileges)].sort());
  });
});
