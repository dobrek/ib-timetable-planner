import { describe, expect, it } from "vitest";
import {
  columnCoords,
  cycleSeverity,
  lineCells,
  nextLineSeverity,
  reconcileCell,
  reconcileLine,
  rollbackCell,
  rollbackLine,
  rowCoords,
  setCellOptimistic,
  setLineOptimistic,
  severityAt,
  type LocalAvailabilityCell,
} from "./availability";

const cells = (...entries: LocalAvailabilityCell[]): LocalAvailabilityCell[] => entries;

describe("severityAt", () => {
  it("returns the cell's severity, or null when available", () => {
    const state = cells({ day: 1, period: 2, severity: "strong" });
    expect(severityAt(state, 1, 2)).toBe("strong");
    expect(severityAt(state, 1, 3)).toBeNull();
  });
});

describe("cycleSeverity", () => {
  it("cycles available → soft → strong → available", () => {
    expect(cycleSeverity(null)).toBe("soft");
    expect(cycleSeverity("soft")).toBe("strong");
    expect(cycleSeverity("strong")).toBeNull();
  });
});

describe("nextLineSeverity", () => {
  it("uniformly strong → clear", () => {
    expect(nextLineSeverity(["strong", "strong", "strong"])).toBeNull();
  });

  it("uniformly soft → strong", () => {
    expect(nextLineSeverity(["soft", "soft"])).toBe("strong");
  });

  it("all-available or mixed → soft", () => {
    expect(nextLineSeverity([null, null])).toBe("soft");
    expect(nextLineSeverity(["soft", "strong"])).toBe("soft");
    expect(nextLineSeverity(["strong", null])).toBe("soft");
  });
});

describe("setCellOptimistic", () => {
  it("appends a pending cell when none exists, without mutating the input", () => {
    const before = cells();
    const after = setCellOptimistic(before, 1, 1, "soft");
    expect(after).toEqual([{ day: 1, period: 1, severity: "soft", pending: true }]);
    expect(before).toEqual([]);
  });

  it("overwrites an existing cell's severity in place (pending)", () => {
    const before = cells({ day: 2, period: 3, severity: "soft" });
    const after = setCellOptimistic(before, 2, 3, "strong");
    expect(after).toEqual([{ day: 2, period: 3, severity: "strong", pending: true }]);
  });

  it("removes the cell when the next severity is null (clear)", () => {
    const before = cells({ day: 2, period: 3, severity: "strong" });
    expect(setCellOptimistic(before, 2, 3, null)).toEqual([]);
  });
});

describe("reconcileCell", () => {
  it("clears the pending flag on the cell", () => {
    const before = cells({ day: 1, period: 1, severity: "soft", pending: true });
    expect(reconcileCell(before, 1, 1)).toEqual([{ day: 1, period: 1, severity: "soft" }]);
  });
});

describe("rollbackCell", () => {
  it("restores the prior severity on failure", () => {
    const optimistic = cells({ day: 1, period: 1, severity: "strong", pending: true });
    expect(rollbackCell(optimistic, 1, 1, "soft")).toEqual([{ day: 1, period: 1, severity: "soft" }]);
  });

  it("removes the cell when the prior state was available", () => {
    const optimistic = cells({ day: 1, period: 1, severity: "soft", pending: true });
    expect(rollbackCell(optimistic, 1, 1, null)).toEqual([]);
  });
});

describe("columnCoords / rowCoords", () => {
  it("columnCoords spans periods 1..periods at a fixed day", () => {
    expect(columnCoords(2, 3)).toEqual([
      { day: 2, period: 1 },
      { day: 2, period: 2 },
      { day: 2, period: 3 },
    ]);
  });

  it("rowCoords spans days 1..days at a fixed period", () => {
    expect(rowCoords(4, 2)).toEqual([
      { day: 1, period: 4 },
      { day: 2, period: 4 },
    ]);
  });
});

describe("setLineOptimistic", () => {
  it("sets every cell on a column to a severity (pending), replacing prior cells on the line", () => {
    const before = cells({ day: 1, period: 1, severity: "strong" }, { day: 2, period: 1, severity: "soft" });
    const after = setLineOptimistic(before, columnCoords(1, 3), "soft");
    expect(after.filter((c) => c.day === 1)).toEqual([
      { day: 1, period: 1, severity: "soft", pending: true },
      { day: 1, period: 2, severity: "soft", pending: true },
      { day: 1, period: 3, severity: "soft", pending: true },
    ]);
    // The other day is untouched.
    expect(after.filter((c) => c.day === 2)).toEqual([{ day: 2, period: 1, severity: "soft" }]);
  });

  it("sets every cell on a row, replacing prior cells on the line", () => {
    const before = cells({ day: 1, period: 4, severity: "strong" }, { day: 1, period: 5, severity: "soft" });
    const after = setLineOptimistic(before, rowCoords(4, 2), "strong");
    expect(after.filter((c) => c.period === 4)).toEqual([
      { day: 1, period: 4, severity: "strong", pending: true },
      { day: 2, period: 4, severity: "strong", pending: true },
    ]);
    // A different period on the same day is untouched.
    expect(after.filter((c) => c.period === 5)).toEqual([{ day: 1, period: 5, severity: "soft" }]);
  });

  it("clears the whole line when the severity is null", () => {
    const before = cells({ day: 1, period: 1, severity: "strong" }, { day: 2, period: 1, severity: "soft" });
    expect(setLineOptimistic(before, columnCoords(1, 3), null)).toEqual([{ day: 2, period: 1, severity: "soft" }]);
  });
});

describe("reconcileLine / rollbackLine / lineCells", () => {
  it("reconcile clears pending across the line only", () => {
    const optimistic = cells(
      { day: 1, period: 1, severity: "soft", pending: true },
      { day: 1, period: 2, severity: "soft", pending: true },
    );
    expect(reconcileLine(optimistic, columnCoords(1, 2))).toEqual([
      { day: 1, period: 1, severity: "soft" },
      { day: 1, period: 2, severity: "soft" },
    ]);
  });

  it("rollback restores the captured prior line", () => {
    const before = cells({ day: 1, period: 1, severity: "strong" });
    const coords = columnCoords(1, 2);
    const previousLine = lineCells(before, coords);
    const optimistic = setLineOptimistic(before, coords, "soft");
    expect(rollbackLine(optimistic, coords, previousLine)).toEqual([{ day: 1, period: 1, severity: "strong" }]);
  });

  it("lineCells captures the line's cells as plain coordinates (no pending)", () => {
    const state = cells(
      { day: 1, period: 1, severity: "soft", pending: true },
      { day: 2, period: 1, severity: "soft" },
    );
    expect(lineCells(state, columnCoords(1, 3))).toEqual([{ day: 1, period: 1, severity: "soft" }]);
  });
});
