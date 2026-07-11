import { describe, expect, it } from "vitest";
import { GENERATION_BUDGET_MS, isGenerateWorkerResponse } from "./worker-protocol";

describe("worker protocol", () => {
  it("keeps the zero-config budget at ~20 s", () => {
    expect(GENERATION_BUDGET_MS).toBe(20_000);
  });

  it("accepts the three response kinds and rejects anything else", () => {
    expect(isGenerateWorkerResponse({ kind: "progress", elapsedMs: 1, budgetMs: 2 })).toBe(true);
    expect(isGenerateWorkerResponse({ kind: "done" })).toBe(true);
    expect(isGenerateWorkerResponse({ kind: "error", message: "boom" })).toBe(true);

    expect(isGenerateWorkerResponse({ kind: "start" })).toBe(false);
    expect(isGenerateWorkerResponse({ kind: "cancel" })).toBe(false);
    expect(isGenerateWorkerResponse({})).toBe(false);
    expect(isGenerateWorkerResponse(null)).toBe(false);
    expect(isGenerateWorkerResponse("done")).toBe(false);
  });
});
