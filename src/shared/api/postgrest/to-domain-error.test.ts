import { describe, expect, it } from "vitest";
import { FORBIDDEN_MESSAGE } from "@/shared/lib/errors";
import { INSUFFICIENT_PRIVILEGE, NOT_FOUND_ROW, UNIQUE_VIOLATION } from "./sqlstates";
import { toDomainError } from "./to-domain-error";

const MESSAGES = { conflict: "Already exists.", notFound: "Not found.", failure: "Failed to write" };

describe("toDomainError", () => {
  it("maps a refused privilege (42501) to FORBIDDEN with the shared message", () => {
    const error = toDomainError(
      { code: INSUFFICIENT_PRIVILEGE, message: 'new row violates row-level security policy for table "plans"' },
      MESSAGES,
    );

    expect(error.code).toBe("FORBIDDEN");
    expect(error.message).toBe(FORBIDDEN_MESSAGE);
  });

  it("maps 42501 to FORBIDDEN even when the caller declares no other messages", () => {
    expect(toDomainError({ code: INSUFFICIENT_PRIVILEGE, message: "denied" }, { failure: "Failed" }).code).toBe(
      "FORBIDDEN",
    );
  });

  it("keeps the CONFLICT and NOT_FOUND mappings", () => {
    expect(toDomainError({ code: UNIQUE_VIOLATION, message: "dup" }, MESSAGES).code).toBe("CONFLICT");
    expect(toDomainError({ code: NOT_FOUND_ROW, message: "0 rows" }, MESSAGES).code).toBe("NOT_FOUND");
  });

  it("falls back to INTERNAL_SERVER_ERROR with the failure prefix", () => {
    const error = toDomainError({ code: "57014", message: "timeout" }, MESSAGES);

    expect(error.code).toBe("INTERNAL_SERVER_ERROR");
    expect(error.message).toBe("Failed to write: timeout");
  });
});
