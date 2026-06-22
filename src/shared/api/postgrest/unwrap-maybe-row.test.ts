import { describe, expect, it } from "vitest";
import { DomainError } from "@/shared/lib/errors";
import { unwrapMaybeRow } from "./unwrap-maybe-row";

describe("unwrapMaybeRow", () => {
  it("returns the row on success", () => {
    expect(unwrapMaybeRow({ data: { hash: "abc" }, error: null }, "Read failed")).toEqual({ hash: "abc" });
  });

  it("returns null when zero rows matched (no error)", () => {
    expect(unwrapMaybeRow({ data: null as { hash: string } | null, error: null }, "Read failed")).toBeNull();
  });

  it("maps any error to INTERNAL_SERVER_ERROR with the failure prefix", () => {
    const run = () => unwrapMaybeRow({ data: null, error: { code: "57014", message: "timeout" } }, "Read failed");
    expect(run).toThrow(DomainError);
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Read failed: timeout");
    }
  });
});
