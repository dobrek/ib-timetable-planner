import { describe, expect, it } from "vitest";
import { formatAnalyzerLine, type AnalyzerLine } from "../analyzer-lines.ts";
import { answersIn } from "./analyzer-client.ts";

/** The runner acts on what it reads back from the analyzer, so an answer must survive the reporter around it. */
describe("the analyzer's answers", () => {
  const answer: AnalyzerLine = { kind: "remaining-hours", planId: "plan-1", unplacedHours: 250, nameMatches: true };

  it("are found behind the colour codes vitest's reporter leaves at the start of the line", () => {
    // Verbatim shape of a coloured `pnpm analyze:jobs` capture: the dimmed `stdout | …` header is
    // closed by `\e[22m\e[39m` at the start of the answer's own line.
    const output = [
      "\u001b[90mstdout\u001b[2m | bench/generation-jobs.analyze.ts\u001b[2m > \u001b[22mprints the hours",
      `\u001b[22m\u001b[39m${formatAnalyzerLine(answer)}`,
      " \u001b[32m✓\u001b[39m bench/generation-jobs.analyze.ts",
    ].join("\n");

    expect(answersIn(output)).toEqual([answer]);
  });
});
