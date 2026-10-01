import { describe, expect, it } from "vitest";
import { linesFrom, queryWindows, telemetryRequest } from "./telemetry.ts";

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
