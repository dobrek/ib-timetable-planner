import { describe, expect, it } from "vitest";
import { formatAnalyzerLine, parseAnalyzerLines, type AnalyzerLine } from "./analyzer-lines";

/** The runner acts on these answers, so a garbled one must be loud and everything else ignored. */
describe("analyzer lines", () => {
  const answer: AnalyzerLine = { kind: "remaining-hours", planId: "plan-1", unplacedHours: 12 };

  it("round-trips an answer through captured stdout, ignoring the reporter's own lines", () => {
    const stdout = [
      " RUN  v4.1.11 /repo",
      "stdout | bench/generation-jobs.analyze.ts > generation job analysis > prints …",
      formatAnalyzerLine(answer),
      " ✓ bench/generation-jobs.analyze.ts (1 test) 40ms",
    ].join("\n");

    expect(parseAnalyzerLines(stdout)).toEqual([answer]);
  });

  it("throws on a prefixed line that is not a known answer, rather than skipping it", () => {
    expect(() => parseAnalyzerLines('@campaign {"kind":"mystery"}')).toThrow(/Not an analyzer answer/);
    expect(() => parseAnalyzerLines("@campaign not json")).toThrow();
  });

  it("finds nothing in output that carries no answer", () => {
    expect(parseAnalyzerLines("no answers here\n")).toEqual([]);
  });
});
