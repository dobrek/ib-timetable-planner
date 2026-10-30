import { describe, expect, it } from "vitest";
import { planFileStem } from "./plan-file-stem";

describe("planFileStem", () => {
  it("is the slugged plan name for a plan that is not current", () => {
    expect(planFileStem("IB 2027 draft", false)).toBe("ib-2027-draft");
  });

  it("appends -current for the current plan", () => {
    expect(planFileStem("IB 2027 draft", true)).toBe("ib-2027-draft-current");
  });

  it("marks the slug fallback too, when the name has no alphanumerics", () => {
    expect(planFileStem("!!!", false)).toBe("plan");
    expect(planFileStem("!!!", true)).toBe("plan-current");
  });

  it("folds diacritics before the marker", () => {
    expect(planFileStem("Wrocław 2027", true)).toBe("wroclaw-2027-current");
  });
});
