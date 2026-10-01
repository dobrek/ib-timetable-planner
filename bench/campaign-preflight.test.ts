import { describe, expect, it } from "vitest";
import { HEARTBEAT_GRACE_MS, course, type PlanAnalysisInput } from "@/entities/timetable";
import type { AnalyzerCourse } from "@/entities/timetable";
import { classifyActiveJobs, remainingHoursOf, resolveJobIdPrefix, type ActiveRow } from "./campaign-preflight";

/**
 * Each answer here gates an action on production: a deploy waits on `classifyActiveJobs`, a ledger
 * row is keyed by `resolveJobIdPrefix`, and setup refuses a plan `remainingHoursOf` says is full.
 */
const NOW = Date.parse("2026-10-01T12:00:00.000Z");
const ago = (ms: number): string => new Date(NOW - ms).toISOString();

const active = (overrides: Partial<ActiveRow> = {}): ActiveRow => ({
  id: "job-1",
  plan_id: "plan-1",
  status: "running",
  heartbeat_at: ago(15_000),
  created_at: ago(600_000),
  ...overrides,
});

describe("classifyActiveJobs", () => {
  it("blocks on a running job whose heartbeat is fresh", () => {
    expect(classifyActiveJobs([active()], NOW)).toEqual({
      blocking: [{ jobId: "job-1", planId: "plan-1", status: "running", since: ago(15_000) }],
      stale: [],
    });
  });

  it("reports a job that has gone quiet as stale rather than blocking forever on it", () => {
    const quiet = active({ heartbeat_at: ago(HEARTBEAT_GRACE_MS + 1_000) });

    expect(classifyActiveJobs([quiet], NOW).stale).toHaveLength(1);
    expect(classifyActiveJobs([quiet], NOW).blocking).toEqual([]);
  });

  it("reads a queued job's age from its creation, since it has no heartbeat yet", () => {
    const fresh = active({ id: "q-fresh", status: "queued", heartbeat_at: null, created_at: ago(10_000) });
    const stranded = active({
      id: "q-old",
      status: "queued",
      heartbeat_at: null,
      created_at: ago(HEARTBEAT_GRACE_MS * 2),
    });

    const { blocking, stale } = classifyActiveJobs([fresh, stranded], NOW);

    expect(blocking.map((entry) => [entry.jobId, entry.since])).toEqual([["q-fresh", ago(10_000)]]);
    expect(stale.map((entry) => entry.jobId)).toEqual(["q-old"]);
  });

  it("ignores a terminal row it was handed", () => {
    expect(classifyActiveJobs([active({ status: "succeeded" })], NOW)).toEqual({ blocking: [], stale: [] });
  });
});

describe("resolveJobIdPrefix", () => {
  const ids = ["386b9d35-1111-4000-8000-000000000001", "386c0000-2222-4000-8000-000000000002"];

  it("resolves a recorded prefix to its one full id, case-insensitively", () => {
    expect(resolveJobIdPrefix(ids, "386B9D35")).toBe(ids[0]);
  });

  it("refuses a prefix that matches nothing or more than one id", () => {
    expect(() => resolveJobIdPrefix(ids, "ffff")).toThrow(/No job id starts with "ffff"/);
    expect(() => resolveJobIdPrefix(ids, "386")).toThrow(/ambiguous/);
  });

  it("refuses something that is not a prefix of an id at all", () => {
    expect(() => resolveJobIdPrefix(ids, "")).toThrow(/not a job id prefix/);
    expect(() => resolveJobIdPrefix(ids, "job 386")).toThrow(/not a job id prefix/);
  });
});

describe("remainingHoursOf", () => {
  const analyzerCourse = (id: string, students: string[], hours = 4): AnalyzerCourse => ({
    ...course(id, `t-${id}`, students),
    hours,
    name: id,
    level: "HL",
    groupIndex: 1,
  });

  const input = (overrides: Partial<PlanAnalysisInput> = {}): PlanAnalysisInput => ({
    days: 5,
    periods: 8,
    courses: { dp1: [analyzerCourse("c1", ["s1"])], dp2: [analyzerCourse("c2", ["s2"], 2)] },
    rows: [],
    availability: [],
    parkedCourseIds: { dp1: [], dp2: [] },
    ...overrides,
  });

  it("counts every required hour on an empty board, across both cohorts", () => {
    expect(remainingHoursOf(input())).toBe(6);
  });

  it("takes placed and parked hours off, as the generator's own deficit does", () => {
    const partial = input({
      rows: [
        { cohort: "dp1", courseId: "c1", day: 1, period: 1, week: "both" },
        { cohort: "dp1", courseId: "c1", day: 2, period: 1, week: "both" },
      ],
      parkedCourseIds: { dp1: ["c1"], dp2: [] },
    });

    expect(remainingHoursOf(partial)).toBe(3);
  });

  it("drops a zero-student course the way Generate auto-parks it", () => {
    const phantom = input({ courses: { dp1: [analyzerCourse("c1", ["s1"]), analyzerCourse("ghost", [])], dp2: [] } });

    expect(remainingHoursOf(phantom)).toBe(4);
  });

  it("is zero on a complete board — the case where Generate would answer 'no placements'", () => {
    const complete = input({
      courses: { dp1: [analyzerCourse("c1", ["s1"], 1)], dp2: [] },
      rows: [{ cohort: "dp1", courseId: "c1", day: 1, period: 1, week: "both" }],
    });

    expect(remainingHoursOf(complete)).toBe(0);
  });
});
