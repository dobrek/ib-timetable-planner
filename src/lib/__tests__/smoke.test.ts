import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("harness smoke test", () => {
  it("always passes", () => {
    expect(true).toBe(true);
  });

  it("resolves @/* alias", () => {
    expect(cn("a", "b")).toBe("a b");
  });
});
