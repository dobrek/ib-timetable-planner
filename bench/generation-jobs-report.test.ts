import { describe, expect, it } from "vitest";
import type { StoredStageReport } from "@/entities/timetable";
import { formatJobReport, formatTierSummary, type JobReport } from "./generation-jobs-report";

/**
 * The formatter is the campaign's only reader of a job row, so what it must never do is quietly
 * lose a stage, average away the non-determinism, or stay silent about time the transcript cannot
 * account for. Those three are what these tests pin; column cosmetics are not.
 */
const stage = (overrides: Partial<StoredStageReport> = {}): StoredStageReport => ({
  tier: 3,
  name: "totalSlots",
  status: "FEASIBLE",
  best: 95,
  bound: 5,
  wallClockS: 120.04,
  stoppedBy: "budget",
  ...overrides,
});

const job = (overrides: Partial<JobReport> = {}): JobReport => ({
  id: "3f2a0000-0000-4000-8000-000000000001",
  preset: "clean",
  status: "succeeded",
  startedAt: "2026-08-18T10:00:00.000Z",
  finishedAt: "2026-08-18T10:10:00.000Z",
  stages: [
    stage({
      tier: 1,
      name: "completeness",
      status: "OPTIMAL",
      best: 0,
      bound: undefined,
      wallClockS: 0.71,
      stoppedBy: undefined,
    }),
    stage(),
  ],
  ...overrides,
});

describe("formatJobReport", () => {
  it("prints one row per stage with the tier, its outcome and what stopped it", () => {
    const report = formatJobReport(job(), 300);

    expect(report).toContain("completeness");
    expect(report).toContain("totalSlots");
    expect(report).toContain("OPTIMAL");
    expect(report).toContain("budget");
    expect(report).toContain("120.04");
  });

  it("prints both clocks and their difference — the ledger's 'did the fallback fire' column", () => {
    // 10 minutes on the row against 0.71 + 120.04 s of stages: the difference is the whole point of
    // showing them together, because the row records neither budgets nor worker count.
    expect(formatJobReport(job(), 300)).toContain("end-to-end 10.00 min · Σ wallClockS 2.01 min · unaccounted 479.3 s");
  });

  it("flags time no stage accounts for once it exceeds fixed overhead, naming the Mode A bound", () => {
    // The clean-mode infeasibility fallback re-solves Mode A and only the second solve reaches the
    // tier-1 report, so this gap is the only trace the row keeps of it. The hidden solve is shorter
    // than a Mode A budget (it fires only on a PROVEN infeasible), so the threshold must be overhead,
    // not the budget — a budget-sized threshold could never be crossed by the cause it names.
    // 2:40 on the row against 120.75 s of transcript leaves 39.3 s nothing accounts for.
    const report = formatJobReport(job({ finishedAt: "2026-08-18T10:02:40.000Z" }), 300);

    expect(report).toContain("39.3 s unaccounted for");
    expect(report).toContain("clean-mode infeasibility fallback");
    expect(report).toContain("less than the 300 s Mode A budget");
  });

  it("stays silent when the gap is ordinary overhead rather than a hidden solve", () => {
    // Sign-in, snapshot parse and the terminal write always cost something. A flag that fired on
    // those would train the reader to skip the one case that matters. 2:20 leaves a 19.3 s gap.
    const report = formatJobReport(job({ finishedAt: "2026-08-18T10:02:20.000Z" }), 300);

    expect(report).toContain("unaccounted 19.3 s");
    expect(report).not.toContain("unaccounted for");
  });

  it("never blames the fallback for a row that did not succeed", () => {
    // A reclaimed, cancelled or failed row's clock measures the outage, not a solve: 20 minutes on
    // an interrupted row is S-304's reclaim stamping finished_at, and the flag must not misattribute it.
    const report = formatJobReport(job({ status: "interrupted", finishedAt: "2026-08-18T10:20:00.000Z" }), 300);

    expect(report).toContain("unaccounted 1079.3 s");
    expect(report).not.toContain("unaccounted for");
  });

  it("says so rather than inventing a clock when the row never finished", () => {
    const report = formatJobReport(job({ finishedAt: null, status: "running" }), 300);

    expect(report).toContain("end-to-end — ·");
    expect(report).not.toContain("unaccounted for");
  });

  it("reports an empty transcript as empty instead of printing a headerless table", () => {
    expect(formatJobReport(job({ stages: [] }), 300)).toContain("(no stages recorded)");
  });
});

describe("formatTierSummary", () => {
  it("summarises each tier across runs as min/median/max rather than a mean", () => {
    // Two identical solves land on incomparable boards, so a mean would invent a precision three
    // runs do not have. Three bests of 90/95/103 must read as exactly those three numbers.
    const runs = [90, 95, 103].map((best) => job({ id: `run-${best}`, stages: [stage({ best })] }));

    const summary = formatTierSummary(runs);

    expect(summary).toContain("across 3 job(s)");
    expect(summary).toMatch(/3\s+totalSlots\s+3\s+90\s+95\.0\s+103/);
  });

  it("averages the two middle values on an even run count", () => {
    const runs = [90, 100].map((best) => job({ id: `run-${best}`, stages: [stage({ best })] }));

    expect(formatTierSummary(runs)).toMatch(/\s95\.0\s/);
  });

  it("counts OPTIMAL against budget-stopped, which is the question a budget answers", () => {
    // A tier that proves optimality inside its budget cannot be improved by giving it more; a tier
    // that always stops on budget is the one where an extra minute might still buy something.
    const runs = [
      job({ id: "a", stages: [stage({ status: "OPTIMAL", stoppedBy: undefined })] }),
      job({ id: "b", stages: [stage({ status: "FEASIBLE", stoppedBy: "budget" })] }),
      job({ id: "c", stages: [stage({ status: "FEASIBLE", stoppedBy: "budget" })] }),
    ];

    expect(formatTierSummary(runs)).toMatch(/totalSlots\s+3\s+95\s+95\.0\s+95\s+1\s+2\s/);
  });

  it("groups by tier identity, not by ladder position — a policy may permute the visit order", () => {
    // S-307's student-first preset walks the same ten tiers in a different order. Grouping by
    // position would compare tier 6 on one run against tier 3 on the next.
    const canonical = job({ id: "canonical", stages: [stage({ tier: 3 }), stage({ tier: 6, name: "spread" })] });
    const permuted = job({ id: "permuted", stages: [stage({ tier: 6, name: "spread" }), stage({ tier: 3 })] });

    const summary = formatTierSummary([canonical, permuted]);
    const rows = summary.split("\n").filter((line) => /^\d/.test(line));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatch(/^3\s+totalSlots\s+2\s/);
    expect(rows[1]).toMatch(/^6\s+spread\s+2\s/);
  });

  it("reports no stages rather than an empty table when nothing was selected", () => {
    expect(formatTierSummary([])).toContain("(no stages recorded)");
  });

  it("leaves a tier that never reported a best as a dash instead of a zero", () => {
    // A stage that ended UNKNOWN contributed nothing; printing 0 would read as a perfect score.
    const summary = formatTierSummary([
      job({ stages: [stage({ status: "UNKNOWN", best: undefined, bound: undefined })] }),
    ]);

    expect(summary).toMatch(/totalSlots\s+1\s+—\s+—\s+—\s/);
  });
});
