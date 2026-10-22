import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const PROBE_KEY = "dom-lane:storage-probe";

// Writes, reads back and removes the probe key before returning what it read, so a failed
// assertion still leaves no key behind.
const roundTrip = (storage: Storage): string | null => {
  storage.setItem(PROBE_KEY, "ready");
  const read = storage.getItem(PROBE_KEY);
  storage.removeItem(PROBE_KEY);
  return read;
};

// Smoke test for the jsdom `dom` Vitest project: proves the environment loads, RTL
// renders client React, jest-dom matchers are registered, and jsdom's Web Storage is
// reachable (on Node ≥25 that depends on the `execArgv` flag in `vitest.config.ts`).
// A failure here points at lane infra (jsdom/RTL/matchers/storage), not at any feature test.
describe("dom test lane", () => {
  it("renders an element and matches a jest-dom matcher", () => {
    render(<div>dom lane ready</div>);
    expect(screen.getByText("dom lane ready")).toBeInTheDocument();
  });

  it("provides window.localStorage and window.sessionStorage that round-trip a value", () => {
    expect(window.localStorage, "window.localStorage").toBeDefined();
    expect(window.sessionStorage, "window.sessionStorage").toBeDefined();
    expect(roundTrip(window.localStorage)).toBe("ready");
    expect(roundTrip(window.sessionStorage)).toBe("ready");
  });
});
