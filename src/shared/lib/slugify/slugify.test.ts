import { describe, expect, it } from "vitest";
import { slugify } from "./slugify";

describe("slugify", () => {
  it("lowercases and collapses non-alphanumeric runs to a single dash", () => {
    expect(slugify("IB 2027 draft")).toBe("ib-2027-draft");
    expect(slugify("Plan   #2 (final!!)")).toBe("plan-2-final");
  });

  it("trims leading and trailing separators", () => {
    expect(slugify("  ***Draft***  ")).toBe("draft");
  });

  it("falls back to 'plan' when nothing alphanumeric survives", () => {
    expect(slugify("!!!")).toBe("plan");
    expect(slugify("")).toBe("plan");
  });

  it("folds NFD-decomposable diacritics onto ASCII", () => {
    expect(slugify("Kraków")).toBe("krakow");
    expect(slugify("José")).toBe("jose");
    expect(slugify("Wrocław 2027")).toBe("wroclaw-2027");
  });

  it("folds the atomic stroke letter ł, which NFD does not decompose", () => {
    expect(slugify("Paweł Głąb")).toBe("pawel-glab");
    expect(slugify("Łódź")).toBe("lodz");
  });
});
