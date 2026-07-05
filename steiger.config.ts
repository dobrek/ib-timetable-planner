import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/** FSD structure validation for app/, entities/, shared/, and _pages/ slices. */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    // One-consumer window: until the second perspective view (`teacher-plan-view`,
    // then the student view) imports the entity, plan-detail is its only referencing
    // slice, and `insignificant-slice` would warn (CI runs steiger --fail-on-warnings).
    files: ["./src/entities/timetable/**"],
    rules: {
      "fsd/insignificant-slice": "off",
    },
  },
]);
