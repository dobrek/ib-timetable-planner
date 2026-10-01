import { describe, expect, it } from "vitest";
import { latestVersion, secretBulkPayload, tuningMatches } from "./cell-controller.ts";

/** The pure parts of the controller: what a cell switch sends, and how its effect is recognised. */
describe("secretBulkPayload", () => {
  it("sets the three calibration keys to the cell's values", () => {
    expect(secretBulkPayload({ workers: 4, stageBudgetS: 120, modeABudgetS: 300 })).toEqual({
      CALIBRATION_WORKERS: "4",
      CALIBRATION_STAGE_BUDGET_S: "120",
      CALIBRATION_MODE_A_BUDGET_S: "300",
    });
  });

  it("parks with three nulls — `secret bulk` deletes a key whose value is null, in one request", () => {
    expect(secretBulkPayload(null)).toEqual({
      CALIBRATION_WORKERS: null,
      CALIBRATION_STAGE_BUDGET_S: null,
      CALIBRATION_MODE_A_BUDGET_S: null,
    });
  });
});

describe("tuningMatches", () => {
  it("is true only when all three values agree", () => {
    const cell = { workers: 4, stageBudgetS: 120, modeABudgetS: 300 };

    expect(tuningMatches(cell, { ...cell })).toBe(true);
    expect(tuningMatches(cell, { ...cell, stageBudgetS: 60 })).toBe(false);
    expect(tuningMatches(cell, { ...cell, workers: 8 })).toBe(false);
  });
});

describe("latestVersion", () => {
  it("reads the NEWEST deployment's versions — wrangler lists them oldest first", () => {
    const deployments = [
      { created_on: "2026-09-01T10:00:00Z", versions: [{ version_id: "old", percentage: 100 }] },
      {
        created_on: "2026-10-01T10:00:00Z",
        versions: [
          { version_id: "new", percentage: 90 },
          { version_id: "old", percentage: 10 },
        ],
      },
      { created_on: "2026-09-15T10:00:00Z", versions: [{ version_id: "mid", percentage: 100 }] },
    ];

    expect(latestVersion(deployments)).toBe("new@90,old@10");
  });

  it("refuses an empty or malformed listing", () => {
    expect(() => latestVersion([])).toThrow(/no deployments/);
    expect(() => latestVersion({ error: "auth" })).toThrow(/no deployments/);
  });
});
