// jsdom lane setup: register jest-dom matchers and RTL auto-cleanup. Loaded via
// `setupFiles` on the `dom` Vitest project only — the node `unit` project never sees it.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
