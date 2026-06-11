import { describe, expect, it } from "vitest";
import { diffChoices } from "./diff-choices";

describe("diffChoices", () => {
  it("returns added ids only when choices are added", () => {
    expect(diffChoices(["a"], ["a", "b", "c"])).toEqual({ toAdd: ["b", "c"], toRemove: [] });
  });

  it("returns removed ids only when choices are removed", () => {
    expect(diffChoices(["a", "b", "c"], ["a"])).toEqual({ toAdd: [], toRemove: ["b", "c"] });
  });

  it("returns both sides for a mixed add/remove", () => {
    expect(diffChoices(["a", "b"], ["b", "c"])).toEqual({ toAdd: ["c"], toRemove: ["a"] });
  });

  it("is a no-op when the sets match", () => {
    expect(diffChoices(["a", "b"], ["a", "b"])).toEqual({ toAdd: [], toRemove: [] });
  });

  it("treats a full replacement (cohort change shape) as remove-all + add-all", () => {
    expect(diffChoices(["a", "b"], ["c", "d"])).toEqual({ toAdd: ["c", "d"], toRemove: ["a", "b"] });
  });
});
