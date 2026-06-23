import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

// Smoke test for the jsdom `dom` Vitest project: proves the environment loads, RTL
// renders client React, and jest-dom matchers are registered. A failure here points
// at lane infra (jsdom/RTL/matchers), not at any feature test.
describe("dom test lane", () => {
  it("renders an element and matches a jest-dom matcher", () => {
    render(<div>dom lane ready</div>);
    expect(screen.getByText("dom lane ready")).toBeInTheDocument();
  });
});
