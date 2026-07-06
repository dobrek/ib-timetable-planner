import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

/** FSD structure validation for app/, entities/, shared/, and _pages/ slices. */
export default defineConfig([...fsd.configs.recommended]);
