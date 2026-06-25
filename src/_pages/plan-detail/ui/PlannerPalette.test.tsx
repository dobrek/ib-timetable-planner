import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GroupingFilter from "./GroupingFilter";
import { usePaletteFilter } from "./PlannerPalette";
import type { LeadingCourseOption } from "../model/leading-course-options";
import type { PlannerGrouping } from "../model/grouping";

const grouping = (id: string, memberIds: string[]): PlannerGrouping => ({
  id,
  memberIds,
  coverageCount: 0,
  score: 0,
  oppositeWeek: false,
});

// g1: a+b, g2: a+c, g3: c+d — so `b` co-occurs with `a` but NOT with `d`, which lets a
// leading change from `a`→`d` strand the companion `b` and exercise the reset rule.
const GROUPINGS = [grouping("g1", ["c-a", "c-b"]), grouping("g2", ["c-a", "c-c"]), grouping("g3", ["c-c", "c-d"])];
const NAMES = { "c-a": "Alpha", "c-b": "Beta", "c-c": "Gamma", "c-d": "Delta" };

const ids = (groupings: PlannerGrouping[]) => groupings.map((g) => g.id);
const optionIds = (options: LeadingCourseOption[]) => options.map((o) => o.id);

describe("usePaletteFilter", () => {
  it("starts cleared — no companion options, the full list visible, no companion set", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    expect(result.current.companionOptions).toEqual([]);
    expect(result.current.companionCourseId).toBeNull();
    expect(ids(result.current.visibleGroupings)).toEqual(["g1", "g2", "g3"]);
  });

  it("picking a leading course populates the companion options (co-occurring, leading excluded) and narrows the list", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    // Alphabetical: Beta (c-b), Gamma (c-c); the leading course c-a is absent.
    expect(optionIds(result.current.companionOptions)).toEqual(["c-b", "c-c"]);
    expect(ids(result.current.visibleGroupings)).toEqual(["g1", "g2"]);
  });

  it("selecting a companion narrows the list to groupings containing both courses", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    act(() => {
      result.current.setCompanionCourseId("c-b");
    });
    expect(result.current.companionCourseId).toBe("c-b");
    expect(ids(result.current.visibleGroupings)).toEqual(["g1"]);
  });

  it("changing the leading course resets a now-invalid companion to null (stale reset)", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    act(() => {
      result.current.setCompanionCourseId("c-b");
    });
    // c-b does not co-occur with c-d, so switching the leading course strands it → reset.
    act(() => {
      result.current.setLeadingCourseId("c-d");
    });
    expect(result.current.companionCourseId).toBeNull();
    expect(optionIds(result.current.companionOptions)).toEqual(["c-c"]);
    expect(ids(result.current.visibleGroupings)).toEqual(["g3"]);
  });

  it("clearing the leading course disables (empties options) and resets the companion", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    act(() => {
      result.current.setCompanionCourseId("c-b");
    });
    act(() => {
      result.current.setLeadingCourseId(null);
    });
    expect(result.current.companionOptions).toEqual([]);
    expect(result.current.companionCourseId).toBeNull();
    expect(ids(result.current.visibleGroupings)).toEqual(["g1", "g2", "g3"]);
  });
});

describe("GroupingFilter companion select", () => {
  const COMPANION_OPTIONS: LeadingCourseOption[] = [
    { id: "c-b", name: "Beta", groupCount: 1 },
    { id: "c-c", name: "Gamma", groupCount: 1 },
  ];

  const renderFilter = (overrides: Partial<React.ComponentProps<typeof GroupingFilter>> = {}) => {
    const props: React.ComponentProps<typeof GroupingFilter> = {
      groupings: GROUPINGS,
      names: NAMES,
      value: null,
      onChange: vi.fn(),
      companionValue: null,
      onCompanionChange: vi.fn(),
      companionOptions: [],
      ...overrides,
    };
    render(<GroupingFilter {...props} />);
    return props;
  };

  it("disables the companion select until a leading course is chosen", () => {
    renderFilter({ value: null, companionOptions: [] });
    expect(screen.getByRole("combobox", { name: "Companion course" })).toBeDisabled();
  });

  it("enables the companion select and lists the co-occurring options once a leading course is set", () => {
    renderFilter({ value: "c-a", companionOptions: COMPANION_OPTIONS });
    const trigger = screen.getByRole("combobox", { name: "Companion course" });
    expect(trigger).toBeEnabled();

    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(screen.getByRole("option", { name: "Any companion" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Beta (1)" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Gamma (1)" })).toBeInTheDocument();
  });

  it("maps a selected companion option back to its course id (sentinel → id)", () => {
    const props = renderFilter({ value: "c-a", companionOptions: COMPANION_OPTIONS });
    const trigger = screen.getByRole("combobox", { name: "Companion course" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Beta (1)" }));
    expect(props.onCompanionChange).toHaveBeenCalledWith("c-b");
  });
});
