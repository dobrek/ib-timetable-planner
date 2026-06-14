import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/lib/errors";
import { assertNoQueryErrors } from "./assert-no-query-errors";

describe("assertNoQueryErrors", () => {
  it("does not throw when every result is error-free", () => {
    expect(() => {
      assertNoQueryErrors("Catalog", [{ error: null }, { error: null }]);
    }).not.toThrow();
  });

  it("throws a DomainError naming the label and the first failing message", () => {
    try {
      assertNoQueryErrors("Catalog", [{ error: null }, { error: { message: "boom" } }]);
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Catalog lookup failed: boom");
    }
  });
});
