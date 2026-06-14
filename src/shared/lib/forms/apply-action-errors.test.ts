import { describe, expect, it, vi } from "vitest";
import type { FieldValues, UseFormSetError } from "react-hook-form";
import { applyActionFieldErrors } from "./apply-action-errors";

describe("applyActionFieldErrors", () => {
  it("sets the first message for each field that has messages", () => {
    const setError = vi.fn() as unknown as UseFormSetError<FieldValues>;
    applyActionFieldErrors({ fields: { name: ["Required", "Too short"], code: [] } }, setError);
    expect(setError).toHaveBeenCalledTimes(1);
    expect(setError).toHaveBeenCalledWith("name", { message: "Required" });
  });

  it("ignores fields with no messages", () => {
    const setError = vi.fn() as unknown as UseFormSetError<FieldValues>;
    applyActionFieldErrors({ fields: { name: undefined } }, setError);
    expect(setError).not.toHaveBeenCalled();
  });
});
