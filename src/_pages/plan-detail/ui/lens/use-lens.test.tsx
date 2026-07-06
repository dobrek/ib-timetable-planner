import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { LensCriterion, LensKeyUniverse } from "../../model/lens";
import { useLens } from "./use-lens";

const PLAN_ID = "plan-1";
const SESSION_KEY = `planner-lens:${PLAN_ID}`;

const universe: LensKeyUniverse = {
  course: new Set(["math-aa-hl", "physics-hl"]),
  teacher: new Set(["kk"]),
  student: new Set(["s-1"]),
};

const course = (key: string): LensCriterion => ({ kind: "course", key });
const teacher = (key: string): LensCriterion => ({ kind: "teacher", key });

const seedSession = (criteria: LensCriterion[]): void => {
  window.sessionStorage.setItem(SESSION_KEY, JSON.stringify(criteria));
};

const storedSession = (): unknown => {
  const raw = window.sessionStorage.getItem(SESSION_KEY);
  return raw === null ? null : JSON.parse(raw);
};

const mount = () => renderHook(() => useLens(PLAN_ID, universe));

afterEach(() => {
  window.sessionStorage.clear();
});

describe("useLens — rehydration", () => {
  it("restores stored criteria post-mount without overwriting them with the initial empty state", () => {
    seedSession([course("math-aa-hl")]);
    const { result } = mount();
    expect(result.current.criteria).toEqual([course("math-aa-hl")]);
    // The write-through effect's mount run must not have clobbered the stored lens.
    expect(storedSession()).toEqual([course("math-aa-hl")]);
  });

  it("prunes entities missing from the plan-wide universe on restore and writes the pruned list back", () => {
    seedSession([course("math-aa-hl"), course("deleted-course"), teacher("kk")]);
    const { result } = mount();
    expect(result.current.criteria).toEqual([course("math-aa-hl"), teacher("kk")]);
    expect(storedSession()).toEqual([course("math-aa-hl"), teacher("kk")]);
  });

  it("leaves storage untouched when nothing is stored", () => {
    const { result } = mount();
    expect(result.current.criteria).toEqual([]);
    expect(storedSession()).toBeNull();
  });
});

describe("useLens — selection write-through", () => {
  it("toggle adds then removes a criterion, writing through each change", () => {
    const { result } = mount();
    act(() => {
      result.current.toggleCriterion(course("math-aa-hl"));
    });
    expect(result.current.criteria).toEqual([course("math-aa-hl")]);
    expect(storedSession()).toEqual([course("math-aa-hl")]);
    act(() => {
      result.current.toggleCriterion(course("math-aa-hl"));
    });
    expect(result.current.criteria).toEqual([]);
    expect(storedSession()).toBeNull();
  });

  it("removeCriterion and clearAll empty the selection and remove the stored key", () => {
    const { result } = mount();
    act(() => {
      result.current.toggleCriterion(course("math-aa-hl"));
    });
    act(() => {
      result.current.toggleCriterion(teacher("kk"));
    });
    act(() => {
      result.current.removeCriterion(course("math-aa-hl"));
    });
    expect(result.current.criteria).toEqual([teacher("kk")]);
    expect(storedSession()).toEqual([teacher("kk")]);
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.criteria).toEqual([]);
    expect(storedSession()).toBeNull();
  });
});

describe("useLens — picker preview", () => {
  it("merges the preview into effectiveCriteria only while the picker is open", () => {
    const { result } = mount();
    act(() => {
      result.current.setPreview(teacher("kk"));
    });
    expect(result.current.effectiveCriteria).toEqual([]);
    act(() => {
      result.current.setOpen(true);
    });
    expect(result.current.effectiveCriteria).toEqual([teacher("kk")]);
  });

  it("closing the picker drops the preview so effectiveCriteria falls back to committed criteria", () => {
    const { result } = mount();
    act(() => {
      result.current.toggleCriterion(course("math-aa-hl"));
    });
    act(() => {
      result.current.setOpen(true);
    });
    act(() => {
      result.current.setPreview(teacher("kk"));
    });
    expect(result.current.effectiveCriteria).toEqual([course("math-aa-hl"), teacher("kk")]);
    act(() => {
      result.current.setOpen(false);
    });
    expect(result.current.preview).toBeNull();
    expect(result.current.effectiveCriteria).toEqual([course("math-aa-hl")]);
  });
});
