import { DragDropProvider } from "@dnd-kit/react";
import { act, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import GroupingFilter from "./GroupingFilter";
import CombinedPalettePanel, { usePaletteFilter } from "./CombinedPalettePanel";

// CombinedPalettePanel imports GroupingStalePanel (the stale body), which deep-imports
// `@/shared/lib/forms` → `astro:transitions/client` — an astro virtual module Vitest can't resolve.
// Mock it (the panel renders the ready body here, so the stale path is never exercised) — mirrors
// GroupingStalePanel.test's own mock.
vi.mock("@/shared/lib/forms", () => ({ refreshPage: vi.fn() }));
import type { HoursStat } from "../../model/hours";
import type { CourseDisplay } from "../../model/course-display";
import type { LeadingCourseOption } from "../../model/grouping/leading-course-options";
import type { PlannerGrouping } from "../../model/grouping/grouping";

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
const NAMES: Record<string, CourseDisplay> = {
  "c-a": { name: "Alpha", color: null },
  "c-b": { name: "Beta", color: null },
  "c-c": { name: "Gamma", color: null },
  "c-d": { name: "Delta", color: null },
};

// c-b co-occurs with BOTH c-a (g1) and c-d (g2), so a c-a→c-d leading change leaves c-b a valid
// companion option — the only shape that discriminates reset-on-change from reset-on-invalidation.
const CO_OCCURRING = [grouping("g1", ["c-a", "c-b"]), grouping("g2", ["c-d", "c-b"])];

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

  it("changing the leading course resets the companion to null (reset-on-change)", () => {
    const { result } = renderHook(() => usePaletteFilter(GROUPINGS, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    act(() => {
      result.current.setCompanionCourseId("c-b");
    });
    // Switching the leading course away from c-a resets the companion via the change handler.
    // (Here c-b also happens to be invalid for c-d, so this shape can't tell the two apart — see
    // the discriminating test below for a companion that stays valid across the change.)
    act(() => {
      result.current.setLeadingCourseId("c-d");
    });
    expect(result.current.companionCourseId).toBeNull();
    expect(optionIds(result.current.companionOptions)).toEqual(["c-c"]);
    expect(ids(result.current.visibleGroupings)).toEqual(["g3"]);
  });

  it("resets the companion on a leading change even when it still co-occurs with the new leading (reset-on-change, not reset-on-invalidation)", () => {
    const { result } = renderHook(() => usePaletteFilter(CO_OCCURRING, NAMES));
    act(() => {
      result.current.setLeadingCourseId("c-a");
    });
    act(() => {
      result.current.setCompanionCourseId("c-b");
    });
    expect(result.current.companionCourseId).toBe("c-b");
    // c-b is STILL a valid companion for c-d (they co-occur in g2), so a validity guard alone would
    // keep it — yet the leading change must reset it to "Any companion" (companionCourseId === null).
    act(() => {
      result.current.setLeadingCourseId("c-d");
    });
    expect(result.current.companionCourseId).toBeNull();
    // c-b remains an offered option, proving the reset is change-driven, not invalidation-driven.
    expect(optionIds(result.current.companionOptions)).toEqual(["c-b"]);
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
      courseDisplay: NAMES,
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

  it("reflects the reset in the rendered Select — the companion trigger returns to 'Any companion' after the leading course changes", () => {
    // Wire the real hook to the component so the reset propagates hook → prop → rendered Select.
    function Wired() {
      const filter = usePaletteFilter(GROUPINGS, NAMES);
      return (
        <GroupingFilter
          groupings={GROUPINGS}
          courseDisplay={NAMES}
          value={filter.leadingCourseId}
          onChange={filter.setLeadingCourseId}
          companionValue={filter.companionCourseId}
          onCompanionChange={filter.setCompanionCourseId}
          companionOptions={filter.companionOptions}
        />
      );
    }
    render(<Wired />);
    const leading = screen.getByRole("combobox", { name: "Leading course" });
    const companion = screen.getByRole("combobox", { name: "Companion course" });

    // Pick leading Alpha, then companion Beta (co-occurs with Alpha in g1).
    fireEvent.keyDown(leading, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Alpha (2)" }));
    fireEvent.keyDown(companion, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Beta (1)" }));
    expect(companion).toHaveTextContent("Beta (1)");

    // Switch leading to Delta — the leading change resets the rendered companion back to "Any companion".
    fireEvent.keyDown(leading, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Delta (1)" }));
    expect(companion).toHaveTextContent("Any companion");
  });
});

describe("CombinedPalettePanel collapse disclosure (single cohort, no toolbar)", () => {
  // The mounted GroupingBox / PaletteCourseChip children call useDraggable, so the palette must
  // render inside a DragDropProvider. One cohort → no switcher toolbar (the focus-mode render).
  const renderPalette = (overrides: Partial<React.ComponentProps<typeof CombinedPalettePanel>> = {}) => {
    const props: React.ComponentProps<typeof CombinedPalettePanel> = {
      cohorts: [
        {
          cohort: "dp1",
          planId: "plan-1",
          groupings: GROUPINGS,
          courseDisplay: NAMES,
          hours: new Map<string, HoursStat>(),
          stale: false,
        },
      ],
      activeCohort: "dp1",
      collapsed: false,
      onCollapsedChange: vi.fn(),
      ...overrides,
    };
    render(
      <DragDropProvider>
        <CombinedPalettePanel {...props} />
      </DragDropProvider>,
    );
    return props;
  };

  it("collapsed → the expand rail names the total grouping count and expands on click", () => {
    const props = renderPalette({ collapsed: true });
    const rail = screen.getByRole("button", { name: "Open palette (3 groupings)" });
    fireEvent.click(rail);
    expect(props.onCollapsedChange).toHaveBeenCalledWith(false);
  });

  it("expanded → renders the filter and collapses on the collapse-button click", () => {
    const props = renderPalette({ collapsed: false });
    expect(screen.getByRole("combobox", { name: "Leading course" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Collapse palette" }));
    expect(props.onCollapsedChange).toHaveBeenCalledWith(true);
  });

  it("the header count is the total grouping count, not the narrowed/filtered count", () => {
    renderPalette({ collapsed: false });
    const paletteCount = () => document.querySelector('[data-slot="palette-count"]')?.textContent;
    expect(paletteCount()).toBe("3");

    // Narrow the visible list to groupings containing Alpha (g1, g2 — 2 of 3); the count must hold at 3.
    const leading = screen.getByRole("combobox", { name: "Leading course" });
    fireEvent.keyDown(leading, { key: "Enter" });
    fireEvent.click(screen.getByRole("option", { name: "Alpha (2)" }));
    expect(paletteCount()).toBe("3");
  });
});
