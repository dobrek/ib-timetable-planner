import { describe, expect, it } from "vitest";
import { chipToneClass } from "./PlacedChip";

// The color×tone precedence matrix: a colored neutral chip takes the subject pair; a
// blocking/warning chip keeps its collision tone REGARDLESS of color (a conflict is never masked);
// an uncolored neutral chip stays `bg-secondary`. Exactly one bg/text pair is ever emitted.
describe("chipToneClass", () => {
  it("paints the subject pair on the plain neutral tone", () => {
    expect(chipToneClass({ blocking: false, warning: false, color: "rose" })).toBe(
      "bg-subject-rose text-subject-rose-foreground",
    );
  });

  it("uses the neutral secondary tone when there is no color", () => {
    expect(chipToneClass({ blocking: false, warning: false, color: null })).toBe(
      "bg-secondary text-secondary-foreground",
    );
  });

  it("keeps the blocking tone regardless of color (collision precedence)", () => {
    expect(chipToneClass({ blocking: true, warning: false, color: "rose" })).toBe(
      "border-destructive bg-destructive/10 text-destructive",
    );
  });

  it("keeps the warning tone regardless of color (collision precedence)", () => {
    expect(chipToneClass({ blocking: false, warning: true, color: "amber" })).toBe(
      "border-warning bg-warning/10 text-warning",
    );
  });

  it("lets blocking win over warning", () => {
    expect(chipToneClass({ blocking: true, warning: true, color: null })).toBe(
      "border-destructive bg-destructive/10 text-destructive",
    );
  });
});
