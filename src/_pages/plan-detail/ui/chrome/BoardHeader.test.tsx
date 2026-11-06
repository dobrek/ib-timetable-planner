import { act, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Credit } from "@/entities/user";
import BoardHeader from "./BoardHeader";

const PLAN_ID = "11111111-1111-4111-8111-111111111111";
const ada: Credit = {
  kind: "user",
  user: {
    id: "22222222-2222-4222-8222-222222222222",
    label: { primary: "Ada Lovelace", secondary: "ada@example.test" },
    isServiceAccount: false,
  },
};

const renderHeader = (createdBy: Credit | null) =>
  render(
    <BoardHeader planName="Year 2026/27" isCurrent={false} createdBy={createdBy} planId={PLAN_ID} active="combined" />,
  );

/**
 * The creator rides a tooltip on an icon (S-407): the heading row is full of controls. Its button's
 * accessible name carries the whole credit, so it is named without opening anything.
 */
describe("BoardHeader", () => {
  it("names the creator in the icon's accessible name, with the email beside the name", () => {
    renderHeader(ada);

    expect(screen.getByRole("button", { name: "Created by Ada Lovelace (ada@example.test)" })).toBeInTheDocument();
    // Folded away until asked for.
    expect(screen.queryByText("ada@example.test")).not.toBeInTheDocument();
  });

  it("shows the credit, email beneath the name, when the icon takes focus", async () => {
    renderHeader(ada);

    act(() => {
      screen.getByRole("button", { name: /^Created by/ }).focus();
    });

    const tooltip = await screen.findByRole("tooltip");
    expect(tooltip).toHaveTextContent("Created by");
    expect(tooltip).toHaveTextContent("Ada Lovelace");
    expect(tooltip).toHaveTextContent("ada@example.test");
  });

  it("names an unknown creator as unknown", () => {
    renderHeader({ kind: "unknown" });

    expect(screen.getByRole("button", { name: "Created by Unknown" })).toBeInTheDocument();
  });

  it("shows no creator at all when the route could not look it up", () => {
    renderHeader(null);

    expect(screen.queryByRole("button", { name: /^Created by/ })).not.toBeInTheDocument();
  });
});
