import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/** FSD structure validation for app/, entities/, shared/, and _pages/ slices. */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    // One-consumer window: until the student view (`student-plan-view`, this change's
    // Phase 3) becomes the widget's second referencing slice, `teacher-plan-view` is its
    // only consumer and `insignificant-slice` would warn (CI runs steiger
    // --fail-on-warnings). Remove this override in Phase 3.
    files: ["./src/widgets/timetable-board/**"],
    rules: {
      "fsd/insignificant-slice": "off",
    },
  },
]);
