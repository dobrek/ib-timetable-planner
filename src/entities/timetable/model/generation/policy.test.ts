import { describe, expect, it } from "vitest";
import {
  DEFAULT_SOLVE_POLICY,
  SOLVE_POLICY_PRESETS,
  parseStoredPolicy,
  policyLabel,
  solvePolicySchema,
} from "./policy";

describe("solvePolicySchema", () => {
  it.each(SOLVE_POLICY_PRESETS)("accepts the %s preset", (preset) => {
    expect(solvePolicySchema.safeParse({ preset }).success).toBe(true);
  });

  it("rejects a preset outside the contract's enum", () => {
    expect(solvePolicySchema.safeParse({ preset: "fastest" }).success).toBe(false);
  });

  it("rejects an unknown key, mirroring additionalProperties: false", () => {
    expect(solvePolicySchema.safeParse({ preset: "clean", budgetMs: 1000 }).success).toBe(false);
  });
});

describe("parseStoredPolicy", () => {
  it("returns the stored preset when the row carries one", () => {
    expect(parseStoredPolicy({ preset: "student-first" })).toEqual({ preset: "student-first" });
  });

  it.each([
    ["the pre-S-307 app placeholder", { clean: true }],
    ["an integration-fixture mode", { mode: "full" }],
    ["a fixture with a budget", { budgetMs: 1000, mode: "staged" }],
    ["an unknown preset", { preset: "fastest" }],
    ["null", null],
    ["a string", "clean"],
  ])("reads %s as the clean default — every legacy row was solved in clean mode", (_case, value) => {
    expect(parseStoredPolicy(value)).toEqual(DEFAULT_SOLVE_POLICY);
  });
});

describe("policyLabel", () => {
  it.each(SOLVE_POLICY_PRESETS)("names the %s preset", (preset) => {
    expect(policyLabel(preset).length).toBeGreaterThan(0);
  });

  it("uses the author-facing nouns", () => {
    expect(policyLabel("clean")).toBe("clean");
    expect(policyLabel("canonical")).toBe("canonical order");
    expect(policyLabel("student-first")).toBe("student-first");
  });
});
