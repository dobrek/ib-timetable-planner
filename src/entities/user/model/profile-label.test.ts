import { describe, expect, it } from "vitest";
import { profileLabel } from "./profile-label";

describe("profileLabel", () => {
  it("shows the name with the email beneath it when a name is set", () => {
    expect(profileLabel({ displayName: "Ada Lovelace", email: "ada@example.test" })).toEqual({
      primary: "Ada Lovelace",
      secondary: "ada@example.test",
    });
  });

  it("shows the email alone when no name is set", () => {
    expect(profileLabel({ displayName: null, email: "ada@example.test" })).toEqual({
      primary: "ada@example.test",
      secondary: null,
    });
  });
});
