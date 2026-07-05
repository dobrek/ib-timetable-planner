import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { LensCounts, LensCriterion, LensOptionGroups } from "@/entities/timetable";
import LensBar from "./LensBar";

// Locks the bar's user contract: one labeled chip per criterion with its ·N count, per-chip remove
// (accessible name `Remove <label> from lens`), Clear lens, chip-body-reopens-picker, the union
// total, and the zero-match message that explains a fully-dimmed board.

const mathCriterion: LensCriterion = { kind: "course", key: "c-math" };
const teacherCriterion: LensCriterion = { kind: "teacher", key: "t-kk" };

const options: LensOptionGroups = {
  courses: [{ criterion: mathCriterion, label: "Math_AA-HL", color: "sky" }],
  teachers: [{ criterion: teacherCriterion, label: "Kay Kay" }],
  students: [],
};

const counts = (total: number, byCriterion: Record<string, number>): LensCounts => ({
  total,
  byCriterion: new Map(Object.entries(byCriterion)),
});

const renderBar = (overrides: Partial<Parameters<typeof LensBar>[0]> = {}) => {
  const onRemove = vi.fn();
  const onClearAll = vi.fn();
  const onOpenPicker = vi.fn();
  render(
    <LensBar
      criteria={[mathCriterion, teacherCriterion]}
      counts={counts(6, { "course:c-math": 4, "teacher:t-kk": 3 })}
      options={options}
      onRemove={onRemove}
      onClearAll={onClearAll}
      onOpenPicker={onOpenPicker}
      {...overrides}
    />,
  );
  return { onRemove, onClearAll, onOpenPicker };
};

describe("LensBar", () => {
  it("renders one chip per criterion with its label and per-criterion count", () => {
    renderBar();
    expect(screen.getByRole("button", { name: "Edit lens criterion Math_AA-HL" })).toHaveTextContent("·4");
    expect(screen.getByRole("button", { name: "Edit lens criterion Kay Kay" })).toHaveTextContent("·3");
    expect(screen.getByText("6 placements")).toBeInTheDocument();
  });

  it("falls back to the raw key when a criterion's entity has no display entry", () => {
    renderBar({ criteria: [{ kind: "student", key: "s-ghost" }], counts: counts(0, {}) });
    expect(screen.getByRole("button", { name: "Edit lens criterion s-ghost" })).toBeInTheDocument();
  });

  it("shows a criterion missing from the visible cohorts as ·0", () => {
    renderBar({ counts: counts(4, { "course:c-math": 4 }) });
    expect(screen.getByRole("button", { name: "Edit lens criterion Kay Kay" })).toHaveTextContent("·0");
  });

  it("removes a single criterion via its × button", () => {
    const { onRemove, onClearAll } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Remove Kay Kay from lens" }));
    expect(onRemove).toHaveBeenCalledWith(teacherCriterion);
    expect(onClearAll).not.toHaveBeenCalled();
  });

  it("clears the whole lens via Clear lens", () => {
    const { onClearAll } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Clear lens" }));
    expect(onClearAll).toHaveBeenCalledTimes(1);
  });

  it("reopens the picker from a chip body", () => {
    const { onOpenPicker } = renderBar();
    fireEvent.click(screen.getByRole("button", { name: "Edit lens criterion Math_AA-HL" }));
    expect(onOpenPicker).toHaveBeenCalledTimes(1);
  });

  it("shows the zero-match message instead of a bare 0 total", () => {
    renderBar({ counts: counts(0, { "course:c-math": 0, "teacher:t-kk": 0 }) });
    expect(screen.getByText("No placements match the lens")).toBeInTheDocument();
  });
});
