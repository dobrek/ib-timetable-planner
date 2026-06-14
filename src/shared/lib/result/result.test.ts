import { describe, expect, it } from "vitest";
import { err, ok } from "./result";

describe("result", () => {
  it("ok wraps a value", () => {
    expect(ok(5)).toEqual({ ok: true, value: 5 });
  });

  it("err wraps an error", () => {
    expect(err("nope")).toEqual({ ok: false, error: "nope" });
  });
});
