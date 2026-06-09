import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/**
 * Entity slices are intentionally extracted as cross-feature domain boundaries
 * (Phase 2). Steiger's insignificant-slice rule flags single-consumer entities;
 * we keep them separate because additional consumers are planned (e.g. student
 * stub, teacher schedule) and merging into _pages would recreate layer leaks.
 */
export default defineConfig([
  ...fsd.configs.recommended,
  {
    files: ["./src/entities/**"],
    rules: {
      "fsd/insignificant-slice": "off",
    },
  },
]);
