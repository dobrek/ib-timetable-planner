import { describe, expect, it } from "vitest";
import { parseLine, parseLines, startupTuning } from "./telemetry-lines.ts";

/**
 * Lines CAPTURED from the live account on 2026-10-01 (the Phase 5 spike's production probe, job
 * 351d5c9e…, from its cold start to the idle stop 30 min later): ids and numbers only. The two lines that probe could not produce — a declined sleep and
 * the SIGTERM pair — are built from the source's own format strings (`src/solver-container.ts`,
 * `services/solver/src/cpsat_service/app.py`) and marked as such; the drill and renewal capture them.
 */
const CAPTURED = {
  startup:
    "2026-10-01 12:01:53,004 INFO cpsat_service.app: solver service starting: workers=4 max_concurrent_jobs=1 " +
    "stage_targets=<none> stage_budget_s=120 mode_a_budget_s=300 log_level=INFO " +
    "machine_email=solver@ib-timetable-planner.dev supabase_url=https://hwmuiymhjgewtymymbmb.supabase.co " +
    "credential_configured=True wire_contract=loaded",
  solving:
    "2026-10-01 12:01:53,987 INFO cpsat_service.runner: job 351d5c9e-f7c4-4395-aded-90bd609f8b1a solving with 4 workers under the clean policy",
  succeeded:
    "2026-10-01 12:16:21,389 INFO cpsat_service.runner: job 351d5c9e-f7c4-4395-aded-90bd609f8b1a succeeded with 246 placements",
  doStarted: "[solver-container] started",
  // The same container going idle 30 min after that dispatch (12:31:53–54Z).
  doIdle: "[solver-container] idle at sleepAfter — letting the container stop",
  doStopped: "[solver-container] stopped: exitCode=0 reason=exit",
  shutdownIdle: "2026-10-01 12:31:54,083 INFO cpsat_service.app: shutdown: no solve in flight",
} as const;

const FROM_SOURCE = {
  declined: "[solver-container] sleep declined: 1 solve(s) in flight — activity renewed",
  asked:
    "2026-10-01 13:00:00,000 WARNING cpsat_service.app: shutdown: asked 1 solve(s) to stop; waiting up to 120s for their terminal writes",
  written: "2026-10-01 13:00:04,100 INFO cpsat_service.app: shutdown: every solve wrote its terminal row in 4.1s",
  stopIfIdle: "[solver-container] stop-if-idle: busy",
} as const;

describe("parseLine — captured lines", () => {
  it("reads the container's startup line as the values it booted with", () => {
    const parsed = parseLine(CAPTURED.startup);

    expect(parsed?.kind).toBe("startup");
    if (parsed?.kind !== "startup") return;
    expect(startupTuning(parsed.values)).toEqual({
      workers: 4,
      stageBudgetS: 120,
      modeABudgetS: 300,
      stageTargets: "<none>",
    });
    expect(parsed.values.credential_configured).toBe("True");
    expect(parsed.values.wire_contract).toBe("loaded");
  });

  it("reads a job's solving and succeeded lines, ignoring the logging prefix", () => {
    expect(parseLine(CAPTURED.solving)).toEqual({
      kind: "job-solving",
      jobId: "351d5c9e-f7c4-4395-aded-90bd609f8b1a",
      workers: 4,
      preset: "clean",
    });
    expect(parseLine(CAPTURED.succeeded)).toEqual({
      kind: "job-succeeded",
      jobId: "351d5c9e-f7c4-4395-aded-90bd609f8b1a",
      placements: 246,
    });
  });

  it("reads the Durable Object's start, idle and stop", () => {
    expect(parseLine(CAPTURED.doStarted)).toEqual({ kind: "do-started" });
    expect(parseLine(CAPTURED.doIdle)).toEqual({ kind: "do-idle" });
    expect(parseLine(CAPTURED.doStopped)).toEqual({ kind: "do-stopped", exitCode: "0", reason: "exit" });
  });

  it("reads an idle container's shutdown", () => {
    expect(parseLine(CAPTURED.shutdownIdle)).toEqual({ kind: "shutdown-idle" });
  });

  it("does not mistake the SDK's own expiry line for the class's idle line", () => {
    expect(parseLine("Activity expired, signalling container to stop")).toBeNull();
  });

  it("ignores the containers dataset's other lines — uvicorn's and httpx's own", () => {
    expect(parseLine("INFO:     Uvicorn running on http://0.0.0.0:8000 (Press CTRL+C to quit)")).toBeNull();
    expect(
      parseLine(
        '2026-10-01 12:02:24,556 INFO httpx: HTTP Request: PATCH https://hwmuiymhjgewtymymbmb.supabase.co/rest/v1/generation_jobs?id=eq.351d5c9e-f7c4-4395-aded-90bd609f8b1a&status=eq.running "HTTP/1.1 204 No Content"',
      ),
    ).toBeNull();
  });
});

describe("parseLine — lines built from the source's format strings", () => {
  it("reads a declined sleep with the solve count", () => {
    expect(parseLine(FROM_SOURCE.declined)).toEqual({ kind: "do-sleep-declined", solves: 1 });
  });

  it("reads both halves of the shutdown pair", () => {
    expect(parseLine(FROM_SOURCE.asked)).toEqual({ kind: "shutdown-asked", solves: 1 });
    expect(parseLine(FROM_SOURCE.written)).toEqual({ kind: "shutdown-written", seconds: 4.1 });
  });

  it("reads the operator stop's outcome", () => {
    expect(parseLine(FROM_SOURCE.stopIfIdle)).toEqual({ kind: "do-stop-if-idle", outcome: "busy" });
  });
});

describe("parseLines", () => {
  it("keeps only recognised lines, in time order", () => {
    const parsed = parseLines([
      { timestamp: 3, message: CAPTURED.succeeded },
      { timestamp: 1, message: CAPTURED.startup },
      { timestamp: 2, message: "INFO:     Application startup complete." },
    ]);

    expect(parsed.map((line) => [line.timestamp, line.parsed.kind])).toEqual([
      [1, "startup"],
      [3, "job-succeeded"],
    ]);
  });
});
