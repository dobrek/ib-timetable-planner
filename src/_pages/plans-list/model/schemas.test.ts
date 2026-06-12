import { describe, expect, it } from "vitest";
import { clonePlanInput, createPlanInput, deletePlanInput, renamePlanInput } from "./schemas";

const UUID_A = "11111111-1111-4111-8111-111111111111";

describe("createPlanInput", () => {
  it("accepts a valid name + preset", () => {
    expect(createPlanInput.parse({ name: "September v1", slotGridPreset: "5x10" })).toEqual({
      name: "September v1",
      slotGridPreset: "5x10",
    });
  });

  it("trims the name", () => {
    expect(createPlanInput.parse({ name: "  Draft  ", slotGridPreset: "5x8" }).name).toBe("Draft");
  });

  it("rejects an empty name", () => {
    expect(createPlanInput.safeParse({ name: "   ", slotGridPreset: "5x10" }).success).toBe(false);
  });

  it("rejects a preset outside the canonical list", () => {
    expect(createPlanInput.safeParse({ name: "Draft", slotGridPreset: "9x9" }).success).toBe(false);
  });
});

describe("clonePlanInput", () => {
  it("accepts a source id + name", () => {
    expect(clonePlanInput.safeParse({ sourcePlanId: UUID_A, name: "Copy" }).success).toBe(true);
  });

  it("rejects a non-uuid source id", () => {
    expect(clonePlanInput.safeParse({ sourcePlanId: "nope", name: "Copy" }).success).toBe(false);
  });

  it("rejects an empty name", () => {
    expect(clonePlanInput.safeParse({ sourcePlanId: UUID_A, name: "  " }).success).toBe(false);
  });
});

describe("renamePlanInput", () => {
  it("accepts an id + name", () => {
    expect(renamePlanInput.safeParse({ id: UUID_A, name: "Renamed" }).success).toBe(true);
  });

  it("rejects a missing id", () => {
    expect(renamePlanInput.safeParse({ name: "Renamed" }).success).toBe(false);
  });
});

describe("deletePlanInput", () => {
  it("accepts a uuid id", () => {
    expect(deletePlanInput.safeParse({ id: UUID_A }).success).toBe(true);
  });

  it("rejects a non-uuid id", () => {
    expect(deletePlanInput.safeParse({ id: "nope" }).success).toBe(false);
  });
});
