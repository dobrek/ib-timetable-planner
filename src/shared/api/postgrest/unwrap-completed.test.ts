import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/lib/errors";
import { unwrapCompleted } from "./unwrap-completed";

describe("unwrapCompleted", () => {
  it("returns without throwing on success", () => {
    expect(() => {
      unwrapCompleted({ error: null }, "Failed to delete");
    }).not.toThrow();
  });

  it("maps any error to INTERNAL_SERVER_ERROR with the failure prefix", () => {
    try {
      unwrapCompleted({ error: { code: "57014", message: "timeout" } }, "Failed to delete");
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Failed to delete: timeout");
    }
  });
});
