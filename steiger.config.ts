import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/** FSD structure validation for app/, shared/, and _pages/ slices. */
export default defineConfig([...fsd.configs.recommended]);
