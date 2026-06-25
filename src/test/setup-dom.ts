// jsdom lane setup: register jest-dom matchers and RTL auto-cleanup. Loaded via
// `setupFiles` on the `dom` Vitest project only — the node `unit` project never sees it.
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// jsdom implements neither the Pointer Capture / scrollIntoView DOM APIs that Radix UI
// overlays (e.g. Select) call when a listbox opens, nor ResizeObserver (referenced by
// @dnd-kit at module load — pulled in transitively by any plan-detail UI import). The
// lib.dom types declare all of these, so jsdom's runtime gaps are invisible to the type
// checker; stub them unconditionally here. Shared across the dom lane and reusable for any
// future Radix-Select/Dropdown or draggable component test.
const noop = (): void => {
  // intentional no-op test stub
};

const elementProto = globalThis.Element.prototype;
elementProto.hasPointerCapture = (): boolean => false;
elementProto.releasePointerCapture = noop;
elementProto.setPointerCapture = noop;
elementProto.scrollIntoView = noop;

globalThis.ResizeObserver = class {
  observe = noop;
  unobserve = noop;
  disconnect = noop;
};

afterEach(() => {
  cleanup();
});
