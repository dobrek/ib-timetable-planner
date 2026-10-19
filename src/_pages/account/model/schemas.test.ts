import { describe, expect, it } from "vitest";
import { passwordFormSchema, updateDisplayNameInput, updatePasswordInput } from "./schemas";

// "ą" is 2 bytes in UTF-8 but one UTF-16 unit: the case that separates characters from bytes.
const TWO_BYTE = "ą";

describe("updatePasswordInput", () => {
  it("refuses 14 characters and accepts 15 — the PRD's floor", () => {
    expect(updatePasswordInput.safeParse({ password: "a".repeat(14) }).success).toBe(false);
    expect(updatePasswordInput.safeParse({ password: "a".repeat(15) }).success).toBe(true);
  });

  it("counts GoTrue's 72-byte cap in UTF-8 bytes, not characters", () => {
    expect(updatePasswordInput.safeParse({ password: TWO_BYTE.repeat(36) }).success).toBe(true);
    expect(updatePasswordInput.safeParse({ password: `${TWO_BYTE.repeat(36)}a` }).success).toBe(false);
  });
});

describe("passwordFormSchema", () => {
  it("puts a mismatched confirmation on the confirm field", () => {
    const result = passwordFormSchema.safeParse({ password: "a".repeat(15), confirm: "b".repeat(15) });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.path)).toEqual([["confirm"]]);
  });

  it("accepts a matching pair", () => {
    expect(passwordFormSchema.safeParse({ password: "a".repeat(15), confirm: "a".repeat(15) }).success).toBe(true);
  });
});

describe("updateDisplayNameInput", () => {
  const parse = (displayName: string | null) => updateDisplayNameInput.safeParse({ displayName });

  it("trims and NFC-normalizes, so the stored name is what the user saw", () => {
    const decomposed = `Zoe${String.fromCodePoint(0x301)}`; // "e" + combining acute accent
    expect(parse(`  ${decomposed}  `).data).toEqual({ displayName: "Zoé" });
  });

  it("clears the name for an empty or blank value, and for null", () => {
    expect(parse("").data).toEqual({ displayName: null });
    expect(parse("   ").data).toEqual({ displayName: null });
    expect(parse(null).data).toEqual({ displayName: null });
  });

  it("re-accepts its own output, which is what the client submits", () => {
    const output = parse(" Ada ").data;
    expect(output && updateDisplayNameInput.safeParse(output).data).toEqual({ displayName: "Ada" });
  });

  it("caps the name at 60 characters", () => {
    expect(parse("a".repeat(60)).success).toBe(true);
    expect(parse("a".repeat(61)).success).toBe(false);
  });

  it("counts the cap in code points, as the CHECK's char_length does — not UTF-16 units", () => {
    expect(parse("😀".repeat(60)).success).toBe(true);
    expect(parse("😀".repeat(61)).success).toBe(false);
  });

  it.each([
    ["a bidi override", 0x202e],
    ["a zero-width space", 0x200b],
    ["a bidi isolate", 0x2066],
    ["a byte-order mark", 0xfeff],
    ["a control character", 0x07],
  ])("refuses %s inside the name", (_why, codePoint) => {
    expect(parse(`Ada${String.fromCodePoint(codePoint)}Lovelace`).success).toBe(false);
  });

  it("keeps letters beyond ASCII and emoji", () => {
    expect(parse("Łucja Żółć 😀").data).toEqual({ displayName: "Łucja Żółć 😀" });
  });
});
