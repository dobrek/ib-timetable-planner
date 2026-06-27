import { describe, expect, it } from "vitest";
import { reconcileCompanion } from "./reconcile-companion";
import type { LeadingCourseOption } from "./leading-course-options";

const option = (id: string): LeadingCourseOption => ({ id, name: id, groupCount: 1 });

describe("reconcileCompanion", () => {
  it("keeps the companion when it is still among the options", () => {
    expect(reconcileCompanion("c-b", [option("c-b"), option("c-c")])).toBe("c-b");
  });

  it("resets to null when the companion is absent from the options", () => {
    expect(reconcileCompanion("c-b", [option("c-c")])).toBeNull();
  });

  it("resets to null when the option list is empty", () => {
    expect(reconcileCompanion("c-b", [])).toBeNull();
  });

  it("passes a null companion through as null", () => {
    expect(reconcileCompanion(null, [option("c-b")])).toBeNull();
  });
});
