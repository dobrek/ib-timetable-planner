import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/lib/errors";
import { unwrapMany } from "./unwrap-many";

describe("unwrapMany", () => {
  it("returns the rows on success", () => {
    expect(unwrapMany({ data: [{ id: "1" }, { id: "2" }], error: null }, "Lookup failed")).toEqual([
      { id: "1" },
      { id: "2" },
    ]);
  });

  it("returns [] when data is null but there is no error", () => {
    expect(unwrapMany<{ id: string }>({ data: null, error: null }, "Lookup failed")).toEqual([]);
  });

  it("maps any error to INTERNAL_SERVER_ERROR with the failure prefix", () => {
    try {
      unwrapMany({ data: null, error: { code: "42P01", message: "missing table" } }, "Lookup failed");
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Lookup failed: missing table");
    }
  });
});
