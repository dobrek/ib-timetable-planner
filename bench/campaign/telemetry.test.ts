import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTelemetryClient, linesFrom, queryWindows, telemetryRequest } from "./telemetry.ts";

/** The query shape the spike proved, the window split it forced, and a refusal that is never "no lines". */
const HOUR = 60 * 60 * 1000;

describe("telemetryRequest", () => {
  it("selects container stdout by type, and matches a line's fixed text with `includes` — never a bare needle", () => {
    const body = telemetryRequest({ source: "container", fromMs: 0, toMs: HOUR, contains: "solver service starting:" });

    expect(body).toMatchObject({ view: "events", timeframe: { from: 0, to: HOUR } });
    expect(body.parameters).toEqual({
      datasets: [],
      filters: [
        { key: "$metadata.type", operation: "eq", type: "string", value: "cf-container" },
        { key: "$metadata.message", operation: "includes", type: "string", value: "solver service starting:" },
      ],
    });
    expect(body).not.toHaveProperty("needle");
  });

  it("selects Durable Object lines by execution model and console type", () => {
    expect(telemetryRequest({ source: "durable-object", fromMs: 0, toMs: HOUR }).parameters).toEqual({
      datasets: [],
      filters: [
        { key: "$workers.executionModel", operation: "eq", type: "string", value: "durableObject" },
        { key: "$metadata.type", operation: "eq", type: "string", value: "cf-worker" },
      ],
    });
  });
});

describe("queryWindows", () => {
  it("keeps a short window whole", () => {
    expect(queryWindows(0, 3 * HOUR)).toEqual([{ fromMs: 0, toMs: 3 * HOUR }]);
  });

  it("splits a seven-day search into pieces of at most 48 h — a 144 h query came back empty", () => {
    const windows = queryWindows(0, 168 * HOUR);

    expect(windows).toHaveLength(4);
    expect(windows.at(-1)).toEqual({ fromMs: 144 * HOUR, toMs: 168 * HOUR });
    expect(windows.every((window) => window.toMs - window.fromMs <= 48 * HOUR)).toBe(true);
  });
});

describe("linesFrom", () => {
  it("returns the events' text and own timestamps, oldest first", () => {
    const body = JSON.stringify({
      success: true,
      result: {
        events: {
          events: [
            { timestamp: 2, $metadata: { message: "[solver-container] started" } },
            { timestamp: 1, source: { message: "fallback text" } },
          ],
        },
      },
    });

    expect(linesFrom(200, body)).toEqual([
      { timestamp: 1, message: "fallback text" },
      { timestamp: 2, message: "[solver-container] started" },
    ]);
  });

  it("throws on a refused query rather than reporting an empty log", () => {
    const refused = JSON.stringify({ success: false, errors: [{ code: 10000, message: "Authentication error" }] });

    expect(() => linesFrom(403, refused)).toThrow(/Authentication error/);
  });
});

describe("createTelemetryClient", () => {
  it("retries a 5xx whose body is an HTML page instead of ending a long observation", async () => {
    const rawDir = mkdtempSync(join(tmpdir(), "campaign-telemetry-"));
    const ok = JSON.stringify({
      success: true,
      result: { events: { events: [{ timestamp: 1, $metadata: { message: "[solver-container] started" } }] } },
    });
    const answers = [new Response("<html>502 Bad Gateway</html>", { status: 502 }), new Response(ok, { status: 200 })];
    const fetchImpl = (() => Promise.resolve(answers.shift() ?? new Response("", { status: 500 }))) as typeof fetch;
    try {
      const client = createTelemetryClient({ accountId: "a", token: "t", rawDir, fetch: fetchImpl, retryDelayMs: 0 });

      const lines = await client.lines({ source: "durable-object", fromMs: 0, toMs: HOUR });

      expect(lines).toEqual([{ timestamp: 1, message: "[solver-container] started" }]);
    } finally {
      rmSync(rawDir, { recursive: true, force: true });
    }
  });

  it("never retries a refusal: a 4xx is an answer", async () => {
    const rawDir = mkdtempSync(join(tmpdir(), "campaign-telemetry-"));
    const calls: string[] = [];
    const fetchImpl = ((url: string) => {
      calls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ success: false, errors: [] }), { status: 403 }));
    }) as typeof fetch;
    try {
      const client = createTelemetryClient({ accountId: "a", token: "t", rawDir, fetch: fetchImpl, retryDelayMs: 0 });

      await expect(client.lines({ source: "container", fromMs: 0, toMs: HOUR })).rejects.toThrow(/HTTP 403/);
      expect(calls).toHaveLength(1);
    } finally {
      rmSync(rawDir, { recursive: true, force: true });
    }
  });
});
