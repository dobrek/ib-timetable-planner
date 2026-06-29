import { beforeEach, describe, expect, it, vi } from "vitest";

import { moveBundleMembers, placeCourse, removeBundleMembers, updatePlacementWeek } from "./placement-client";
import { deleteShelfBundle, shelveBundle, shelveCourses, unshelveBundle } from "./shelf-client";
import { makeRpcs } from "./rpcs";

vi.mock("./placement-client", () => ({
  placeCourse: vi.fn(),
  moveBundleMembers: vi.fn(),
  removeBundleMembers: vi.fn(),
  updatePlacementWeek: vi.fn(),
}));
vi.mock("./shelf-client", () => ({
  shelveBundle: vi.fn(),
  unshelveBundle: vi.fn(),
  deleteShelfBundle: vi.fn(),
  shelveCourses: vi.fn(),
}));

const placeMock = vi.mocked(placeCourse);
const moveMock = vi.mocked(moveBundleMembers);
const removeMock = vi.mocked(removeBundleMembers);
const updateWeekMock = vi.mocked(updatePlacementWeek);
const shelveMock = vi.mocked(shelveBundle);
const unshelveMock = vi.mocked(unshelveBundle);
const deleteShelfMock = vi.mocked(deleteShelfBundle);
const shelveCoursesMock = vi.mocked(shelveCourses);

const PLAN = "plan-1";
const COHORT = "dp1" as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("makeRpcs", () => {
  it("binds planId + cohort onto placeCourse", () => {
    void makeRpcs(PLAN, COHORT).placeCourse({ courseId: "c1", day: 0, period: 1, week: "both" });
    expect(placeMock).toHaveBeenCalledWith({
      planId: PLAN,
      cohort: COHORT,
      courseId: "c1",
      day: 0,
      period: 1,
      week: "both",
    });
  });

  it("binds planId + cohort onto moveBundleMembers", () => {
    void makeRpcs(PLAN, COHORT).moveBundleMembers({
      day: 0,
      period: 1,
      courseIds: ["c1"],
      targetDay: 2,
      targetPeriod: 3,
    });
    expect(moveMock).toHaveBeenCalledWith({
      planId: PLAN,
      cohort: COHORT,
      day: 0,
      period: 1,
      courseIds: ["c1"],
      targetDay: 2,
      targetPeriod: 3,
    });
  });

  it("binds planId + cohort onto removeBundleMembers", () => {
    void makeRpcs(PLAN, COHORT).removeBundleMembers({ day: 4, period: 2, courseIds: ["c1", "c2"] });
    expect(removeMock).toHaveBeenCalledWith({
      planId: PLAN,
      cohort: COHORT,
      day: 4,
      period: 2,
      courseIds: ["c1", "c2"],
    });
  });

  it("passes updatePlacementWeek through untouched (binds neither planId nor cohort)", () => {
    void makeRpcs(PLAN, COHORT).updatePlacementWeek("placement-9", "a");
    expect(updateWeekMock).toHaveBeenCalledWith("placement-9", "a");
  });

  it("binds planId + cohort onto shelveBundle", () => {
    void makeRpcs(PLAN, COHORT).shelveBundle({ day: 1, period: 1 });
    expect(shelveMock).toHaveBeenCalledWith({ planId: PLAN, cohort: COHORT, day: 1, period: 1 });
  });

  it("binds planId + cohort onto unshelveBundle", () => {
    void makeRpcs(PLAN, COHORT).unshelveBundle({ shelfBundleId: "sb-1", targetDay: 2, targetPeriod: 0 });
    expect(unshelveMock).toHaveBeenCalledWith({
      planId: PLAN,
      cohort: COHORT,
      shelfBundleId: "sb-1",
      targetDay: 2,
      targetPeriod: 0,
    });
  });

  it("binds only planId onto deleteShelfBundle (no cohort)", () => {
    void makeRpcs(PLAN, COHORT).deleteShelfBundle({ shelfBundleId: "sb-2" });
    expect(deleteShelfMock).toHaveBeenCalledWith({ planId: PLAN, shelfBundleId: "sb-2" });
    expect(deleteShelfMock.mock.calls[0][0]).not.toHaveProperty("cohort");
  });

  it("binds planId + cohort onto shelveCourses", () => {
    const members = [{ courseId: "c1", week: "both" as const }];
    void makeRpcs(PLAN, COHORT).shelveCourses({ members });
    expect(shelveCoursesMock).toHaveBeenCalledWith({ planId: PLAN, cohort: COHORT, members });
  });

  it("carries the cohort it was built with (dp2, not a hardcoded dp1)", () => {
    void makeRpcs(PLAN, "dp2").shelveBundle({ day: 0, period: 0 });
    expect(shelveMock).toHaveBeenCalledWith({ planId: PLAN, cohort: "dp2", day: 0, period: 0 });
  });
});
