import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { loadFixtureCourses } from "@/lib/grouping/adapters/fixture.node";
import { computeGroupings } from "@/entities/grouping";

type GoldenRow = {
  coverageCount: number;
  score: number;
  memberKey: string;
};

const parseGolden = (filePath: string): GoldenRow[] =>
  readFileSync(filePath, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const [rawCoverage, rawScore, ...members] = line.split(",").map((c) => c.trim());
      return {
        coverageCount: Number(rawCoverage),
        score: Number(rawScore),
        memberKey: [...members].toSorted().join("|"),
      };
    });

describe("golden parity (golden ⊆ deterministic output)", () => {
  it("every golden row appears in the computed output with matching coverage and score", () => {
    const courses = loadFixtureCourses(join(process.cwd(), "data/dp2"));
    const results = computeGroupings(courses);

    const outputKeys = new Map<string, { coverageCount: number; score: number }>();
    for (const result of results) {
      for (const variant of result.variants) {
        outputKeys.set([...variant.memberIds].toSorted().join("|"), {
          coverageCount: variant.coverageCount,
          score: variant.score,
        });
      }
    }

    const goldenRows = parseGolden(join(process.cwd(), "data/out/dp2-variants-2.csv"));

    const missing = goldenRows.flatMap((row) => {
      const match = outputKeys.get(row.memberKey);
      if (!match) return [`MISSING set: ${row.memberKey} (coverage=${row.coverageCount}, score=${row.score})`];
      if (match.coverageCount !== row.coverageCount || match.score !== row.score)
        return [
          `MISMATCH: ${row.memberKey} — expected coverage=${row.coverageCount} score=${row.score}, got coverage=${match.coverageCount} score=${match.score}`,
        ];
      return [];
    });

    expect(missing, `${missing.length} golden rows not reproduced:\n${missing.join("\n")}`).toHaveLength(0);
  });
});
