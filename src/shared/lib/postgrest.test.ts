import { describe, expect, it } from "vitest";
import { DomainError } from "./errors";
import { NOT_FOUND_ROW, UNIQUE_VIOLATION, unwrapCompleted, unwrapRow } from "./postgrest";

const MESSAGES = { conflict: "Already exists.", notFound: "Not found.", failure: "Failed to write" };

describe("unwrapRow", () => {
  it("returns the row on success", () => {
    expect(unwrapRow({ data: { id: "1" }, error: null }, MESSAGES)).toEqual({ id: "1" });
  });

  it("maps a unique violation to CONFLICT with the given message", () => {
    const run = () => unwrapRow({ data: null, error: { code: UNIQUE_VIOLATION, message: "dup" } }, MESSAGES);
    expect(run).toThrow(DomainError);
    expect(run).toThrow("Already exists.");
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("CONFLICT");
    }
  });

  it("maps a missing row to NOT_FOUND with the given message", () => {
    const run = () => unwrapRow({ data: null, error: { code: NOT_FOUND_ROW, message: "0 rows" } }, MESSAGES);
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("NOT_FOUND");
      expect((error as DomainError).message).toBe("Not found.");
    }
  });

  it("falls back to INTERNAL_SERVER_ERROR with the failure prefix and raw message", () => {
    const run = () => unwrapRow({ data: null, error: { code: "42P01", message: "missing table" } }, MESSAGES);
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Failed to write: missing table");
    }
  });

  it("treats a unique violation as INTERNAL_SERVER_ERROR when no conflict message is given", () => {
    const run = () =>
      unwrapRow({ data: null, error: { code: UNIQUE_VIOLATION, message: "dup" } }, { failure: "Failed to write" });
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
    }
  });
});

describe("unwrapCompleted", () => {
  it("returns ok on success", () => {
    expect(unwrapCompleted({ error: null }, "Failed to delete")).toEqual({ ok: true });
  });

  it("maps any error to INTERNAL_SERVER_ERROR with the failure prefix", () => {
    const run = () => unwrapCompleted({ error: { code: "57014", message: "timeout" } }, "Failed to delete");
    try {
      run();
    } catch (error) {
      expect((error as DomainError).code).toBe("INTERNAL_SERVER_ERROR");
      expect((error as DomainError).message).toBe("Failed to delete: timeout");
    }
  });
});
