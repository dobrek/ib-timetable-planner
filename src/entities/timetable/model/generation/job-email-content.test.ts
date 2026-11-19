import { describe, expect, it } from "vitest";
import type { JobEmailKind } from "./job-email";
import { buildJobEmail, type JobEmailContentFacts } from "./job-email-content";

const ORIGIN = "https://ib-timetable-planner.dev";
const PLAN = "11111111-1111-4111-8111-111111111111";
const PROPOSAL = "22222222-2222-4222-8222-222222222222";

const diagnostics = (dp1: number[], dp2: number[] = []) => ({
  engine: "cp-sat",
  elapsedMs: 1,
  partial: false,
  cohorts: {
    dp1: {
      occupiedSlotsBefore: 0,
      occupiedSlotsAfter: 0,
      unplaced: dp1.map((missing, i) => ({ courseId: `c${i}`, missing })),
    },
    dp2: {
      occupiedSlotsBefore: 0,
      occupiedSlotsAfter: 0,
      unplaced: dp2.map((missing, i) => ({ courseId: `d${i}`, missing })),
    },
  },
});

const facts = (over: Partial<JobEmailContentFacts> = {}): JobEmailContentFacts => ({
  planName: "Year 12 draft",
  planId: PLAN,
  proposalPlanId: PROPOSAL,
  policy: { preset: "student-first" },
  startedAt: "2026-11-19T10:00:00.000Z",
  finishedAt: "2026-11-19T10:23:10.000Z",
  heartbeatAt: "2026-11-19T10:23:00.000Z",
  checkpointStageIndex: null,
  resultDiagnostics: diagnostics([]),
  checkpointDiagnostics: null,
  ...over,
});

const ALL_KINDS: JobEmailKind[] = ["finished", "failed", "interrupted", "stopped", "stalled"];

/** Every absolute URL, attribute or text, as the integration lane's `urlsIn` counts them. */
const urls = (body: string): string[] => [...body.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map(([url]) => url);

describe("buildJobEmail — the structural contract", () => {
  it.each(ALL_KINDS)("%s: exactly one link, on the origin, in the HTML and in the text", (kind) => {
    const email = buildJobEmail(kind, facts(), ORIGIN);

    expect(urls(email.html)).toEqual([email.link]);
    expect(urls(email.text)).toEqual([email.link]);
    expect(email.link.startsWith(`${ORIGIN}/plans/`)).toBe(true);
    expect(email.html).not.toMatch(/<form|<script|<img/i);
    expect(email.subject).toMatch(/^IB Planner: /);
  });

  it("escapes an HTML-hostile plan name and never puts it in the link", () => {
    const email = buildJobEmail("finished", facts({ planName: `<img src=x onerror="alert('1')">&co` }), ORIGIN);

    expect(email.html).not.toMatch(/<img/i);
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;co");
    expect(email.link).toBe(`${ORIGIN}/plans/${PROPOSAL}`);
  });

  it("keeps CR/LF and other control characters out of the subject", () => {
    const email = buildJobEmail("failed", facts({ planName: "Plan\r\nBcc: someone@example.test\tA" }), ORIGIN);

    expect(email.subject).not.toMatch(/[\r\n\t]/);
    expect(email.subject).toBe("IB Planner: generation failed for “Plan Bcc: someone@example.test A”");
  });

  it("names an unnamed plan rather than leaving empty quotes", () => {
    expect(buildJobEmail("finished", facts({ planName: " \n " }), ORIGIN).subject).toBe(
      "IB Planner: generation finished for “Untitled plan”",
    );
  });

  it("is identical for identical input, since a retry must send the same bytes", () => {
    for (const kind of ALL_KINDS) {
      expect(buildJobEmail(kind, facts(), ORIGIN)).toEqual(buildJobEmail(kind, facts(), ORIGIN));
    }
  });

  it("carries no error text, even when the row it came from holds one", () => {
    // The facts type has no `error` field; a row read wider than it must still not leak through.
    const row = { ...facts(), error: "SENTINEL-ERROR course 9f1c… cell mon-3" };
    for (const kind of ALL_KINDS) {
      const email = buildJobEmail(kind, row, ORIGIN);
      expect(`${email.subject}${email.text}${email.html}`).not.toContain("SENTINEL");
    }
  });

  it("never claims the board is ready or verified: the server-side check has not run yet", () => {
    for (const kind of ALL_KINDS) {
      const { text } = buildJobEmail(kind, facts(), ORIGIN);
      expect(text).not.toMatch(/\b(ready|verified)\b/i);
    }
  });
});

describe("buildJobEmail — where the one link goes", () => {
  it("a finished job links to its proposal", () => {
    expect(buildJobEmail("finished", facts(), ORIGIN).link).toBe(`${ORIGIN}/plans/${PROPOSAL}`);
  });

  it("a halted job links to its proposal when it kept a checkpoint, and to the plan when not", () => {
    for (const kind of ["interrupted", "stopped"] as const) {
      expect(buildJobEmail(kind, facts({ checkpointStageIndex: 3 }), ORIGIN).link, kind).toBe(
        `${ORIGIN}/plans/${PROPOSAL}`,
      );
      expect(buildJobEmail(kind, facts(), ORIGIN).link, kind).toBe(`${ORIGIN}/plans/${PLAN}`);
    }
  });

  it("a failed or stalled job links to the plan Generate was pressed on", () => {
    expect(buildJobEmail("failed", facts(), ORIGIN).link).toBe(`${ORIGIN}/plans/${PLAN}`);
    expect(buildJobEmail("stalled", facts({ checkpointStageIndex: 2 }), ORIGIN).link).toBe(`${ORIGIN}/plans/${PLAN}`);
  });

  it("falls back to the plan when the proposal is gone", () => {
    expect(buildJobEmail("finished", facts({ proposalPlanId: null }), ORIGIN).link).toBe(`${ORIGIN}/plans/${PLAN}`);
  });

  it("never claims a kept board, or counts one, once the proposal is gone", () => {
    const orphaned = facts({
      proposalPlanId: null,
      checkpointStageIndex: 3,
      checkpointDiagnostics: diagnostics([2]),
    });
    const { text, link } = buildJobEmail("stopped", orphaned, ORIGIN);

    expect(link).toBe(`${ORIGIN}/plans/${PLAN}`);
    expect(text).toContain("Nothing was kept. Open the plan to try again:");
    expect(text).not.toContain("best board");
    expect(text).not.toContain("could not be fully placed");
  });

  it("says which it opens", () => {
    expect(buildJobEmail("finished", facts(), ORIGIN).text).toContain("Open the proposal to review it:");
    expect(buildJobEmail("failed", facts(), ORIGIN).text).toContain(
      "Open the plan to see what happened and try again:",
    );
    expect(buildJobEmail("stopped", facts({ checkpointStageIndex: 1 }), ORIGIN).text).toContain(
      "The best board found so far was kept. Open the proposal to review it:",
    );
    expect(buildJobEmail("interrupted", facts(), ORIGIN).text).toContain(
      "Nothing was kept. Open the plan to try again:",
    );
  });
});

describe("buildJobEmail — the details", () => {
  it("states the outcome, the plan, how long it ran and the policy", () => {
    const { subject, text } = buildJobEmail("finished", facts(), ORIGIN);

    expect(subject).toBe("IB Planner: generation finished for “Year 12 draft”");
    expect(text).toContain("The generation for “Year 12 draft” has finished.");
    expect(text).toContain("Ran for 23 minutes");
    expect(text).toContain("Policy: student-first");
    expect(text).toContain("You are receiving this because you ticked “Email me when it finishes”");
  });

  it("counts the result's unplaced courses and hours, across both cohorts", () => {
    expect(buildJobEmail("finished", facts(), ORIGIN).text).toContain("All courses were placed.");
    expect(buildJobEmail("finished", facts({ resultDiagnostics: diagnostics([2, 3], [1]) }), ORIGIN).text).toContain(
      "3 courses could not be fully placed (6 hours left to place).",
    );
    expect(buildJobEmail("finished", facts({ resultDiagnostics: diagnostics([1]) }), ORIGIN).text).toContain(
      "1 course could not be fully placed (1 hour left to place).",
    );
  });

  it("counts a halted job's checkpoint, and says nothing about a board that does not exist", () => {
    const halted = facts({ checkpointStageIndex: 4, checkpointDiagnostics: diagnostics([5]) });
    expect(buildJobEmail("interrupted", halted, ORIGIN).text).toContain("1 course could not be fully placed");

    const noBoard = facts({ checkpointDiagnostics: diagnostics([5]) });
    for (const kind of ["failed", "stalled", "stopped"] as const) {
      expect(buildJobEmail(kind, noBoard, ORIGIN).text, kind).not.toMatch(/placed/);
    }
  });

  it("drops the counts line when the diagnostics are missing or unreadable", () => {
    expect(buildJobEmail("finished", facts({ resultDiagnostics: null }), ORIGIN).text).not.toMatch(/placed/);
    expect(buildJobEmail("finished", facts({ resultDiagnostics: { cohorts: "?" } }), ORIGIN).text).not.toMatch(
      /placed/,
    );
  });

  it("measures a stalled job to its last heartbeat, and drops the duration when it never started", () => {
    expect(buildJobEmail("stalled", facts(), ORIGIN).text).toContain("Ran for 23 minutes before it went quiet");
    expect(buildJobEmail("stalled", facts(), ORIGIN).text).toContain("not reported progress for over 5 minutes");
    expect(buildJobEmail("failed", facts({ startedAt: null }), ORIGIN).text).not.toContain("Ran for");
  });

  it("formats long and short runs", () => {
    const run = (finishedAt: string) => buildJobEmail("finished", facts({ finishedAt }), ORIGIN).text;
    expect(run("2026-11-19T10:00:20.000Z")).toContain("Ran for less than a minute");
    expect(run("2026-11-19T11:00:00.000Z")).toContain("Ran for 1 hour\n");
    expect(run("2026-11-19T11:38:00.000Z")).toContain("Ran for 1 hour 38 minutes");
  });

  it("reads a legacy policy shape as clean, as the stored column is read everywhere", () => {
    expect(buildJobEmail("finished", facts({ policy: { budgetMs: 20_000, mode: "full" } }), ORIGIN).text).toContain(
      "Policy: clean",
    );
  });
});
