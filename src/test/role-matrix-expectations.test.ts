import { describe, expect, it } from "vitest";
import {
  ACCESS_CHANGE_WRITE_EVIDENCE,
  ACCESS_CHANGE_WRITES,
  DIRECTORY_WRITE_EVIDENCE,
  DIRECTORY_WRITES,
  GRANTS,
  JOB_ATTRIBUTION_REWRITE_EVIDENCE,
  JOB_ATTRIBUTION_REWRITES,
  JOB_STOPS,
  PROFILE_WRITES,
  ROLE_WRITES,
  RPCS,
  SELF_GRANT_EVIDENCE,
  SELF_GRANTS,
  USER_KEYED_READS,
  WRITES,
  type JobAttributionColumn,
  type OwnRowOutcome,
  type Principal,
  type ProfileWriteOperation,
  type SelfGrant,
  type StopWrite,
  type WriteOperation,
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
 * - A `PROFILE_WRITES.others` row, `PROFILE_REKEY` or `MACHINE_ROLE_GRANT`, whose payload differs
 *   from its counterpart (the `own` row; `ROLE_WRITES.insert`) only in whose `user_id` it names.
 *   The counterpart's allowed principal is its evidence.
 * - A `SELF_GRANTS`, `DIRECTORY_WRITES`, `ACCESS_CHANGE_WRITES` or `JOB_ATTRIBUTION_REWRITES` row,
 *   which no app principal may send at all. The service role sends the same payload to a fresh user in the same starting state
 *   instead, and the matching `…_EVIDENCE` table records that it lands.
 *
 * `"no-row"` states that a principal lacks the row its cell targets. Only noRole's own `user_roles`
 * row can be missing, and with it the record of that role being given (`access_changes`); every
 * other principal holds the rows its cells aim at, so the marker may appear nowhere else. A job stop
 * is the one other place: anon has no id, so it never requested a job.
 *
 * `JOB_STOPS` (S-407) is checked against itself and against `WRITES`: a legacy job, which records no
 * requester, is stopped exactly as any job was before S-407, and nobody may stop another user's job
 * who may not stop their own.
 */
const writeRows = [
  ...Object.entries(WRITES).flatMap(([table, operations]) =>
    Object.entries(operations).map(([operation, cell]) => [`${operation} ${table}`, cell] as const),
  ),
  ...Object.entries(ROLE_WRITES).map(([operation, cell]) => [`${operation} another user's role`, cell] as const),
];
const PROFILE_OPERATIONS: ProfileWriteOperation[] = ["insert", "update"];
const ownProfileRows = PROFILE_OPERATIONS.map(
  (operation) => [`${operation} own profile`, PROFILE_WRITES.own[operation]] as const,
);
// Each all-denied row whose payload differs from a counterpart's only in the user it names, paired
// with that counterpart's cell: the `own` profile row, or an admin giving a listed user a role.
const counterpartRows = [
  ...PROFILE_OPERATIONS.map(
    (operation) => [`${operation} another user's profile`, PROFILE_WRITES.own[operation]] as const,
  ),
  ["re-key own profile onto another user", PROFILE_WRITES.own.update] as const,
  ["give the machine fixture a role", ROLE_WRITES.insert] as const,
];
// Each all-denied self-grant row, paired with the service role's outcome for the same payload.
const selfGrantRows = (Object.keys(SELF_GRANTS) as SelfGrant[]).map(
  (grant) => [grant, SELF_GRANT_EVIDENCE[grant]] as const,
);
// Each all-denied directory or record write, paired with the service role's outcome for its payload.
const serviceEvidencedRows = [
  ...(Object.keys(DIRECTORY_WRITES) as WriteOperation[]).map(
    (operation) => [`${operation} user_directory`, DIRECTORY_WRITE_EVIDENCE[operation]] as const,
  ),
  ...(Object.keys(ACCESS_CHANGE_WRITES) as WriteOperation[]).map(
    (operation) => [`${operation} access_changes`, ACCESS_CHANGE_WRITE_EVIDENCE[operation]] as const,
  ),
  ...(Object.keys(JOB_ATTRIBUTION_REWRITES) as JobAttributionColumn[]).map(
    (column) => [`rewrite another user's job ${column}`, JOB_ATTRIBUTION_REWRITE_EVIDENCE[column]] as const,
  ),
];
const STOP_WRITES = Object.keys(JOB_STOPS.own) as StopWrite[];
const jobStopRows = Object.entries(JOB_STOPS).flatMap(([requester, writes]) =>
  Object.entries(writes).map(([write, cell]) => [`${write} (${requester} job)`, cell] as const),
);
const jobStopNoRowCells = Object.entries(JOB_STOPS).flatMap(([requester, writes]) =>
  Object.entries(writes).flatMap(([write, cell]) =>
    noRowPrincipals(cell).map((principal) => `${principal} attempting ${write} (${requester} job)`),
  ),
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
  it.each([...writeRows, ...ownProfileRows, ...rpcRows, ...jobStopRows])(
    "%s has at least one allowed principal",
    (_row, cell) => {
      expect(Object.values(cell)).toContain("allowed");
    },
  );

  it.each(counterpartRows)("%s is evidenced by its counterpart", (_row, ownCell) => {
    expect(Object.values(ownCell)).toContain("allowed");
  });

  it.each(selfGrantRows)("self-grant %s is evidenced by the service role sending its payload", (_row, evidence) => {
    expect(evidence).toBe("allowed");
  });

  it.each(serviceEvidencedRows)("%s is evidenced by the service role sending its payload", (_row, evidence) => {
    expect(evidence).toBe("allowed");
  });

  it("only noRole's own role row, and its record, are no-row: the rows a principal's cell can lack", () => {
    expect(noRowCells).toEqual([
      "noRole reading the own access_changes row",
      "noRole reading the own user_roles row",
      "noRole attempting drop own role",
    ]);
  });

  it("only anon's own-job stops are no-row: anon has no id, so it never requested a job", () => {
    expect(jobStopNoRowCells).toEqual([
      "anon attempting stop queued (own job)",
      "anon attempting stop running (own job)",
    ]);
  });

  it.each(STOP_WRITES)(
    "%s of a legacy job is the job UPDATE cell: stoppable as every job was before S-407",
    (write) => {
      expect(JOB_STOPS.legacy[write]).toEqual(WRITES.generation_jobs.update);
    },
  );

  it.each(STOP_WRITES)("%s of another user's job is allowed only to a principal who may stop its own", (write) => {
    const principals = Object.keys(JOB_STOPS.own[write]) as Principal[];
    const widened = principals.filter(
      (principal) => JOB_STOPS.others[write][principal] === "allowed" && JOB_STOPS.own[write][principal] !== "allowed",
    );
    expect(widened).toEqual([]);
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
