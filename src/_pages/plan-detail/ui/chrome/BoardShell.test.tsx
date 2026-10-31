import { render, screen, waitFor } from "@testing-library/react";
import { useDraggable } from "@dnd-kit/react";
import { describe, expect, it, vi } from "vitest";
import BoardShell from "./BoardShell";

// Pins the read-only board's dnd-kit configuration (S-405). Every board cell and chip registers a
// draggable, disabled on a read-only board, and dnd-kit's Accessibility plugin decorates each one
// enabled or not — a tab stop, a role, "draggable" pick-up instructions and an `aria-disabled` that
// every read control inside inherits. A viewer's board must run without it; an editor's keeps it.

function DisabledChip() {
  const { ref } = useDraggable({ id: "chip", disabled: true });
  return (
    <div ref={ref} aria-roledescription="placement">
      Physics
      <button type="button">Show collision details</button>
    </div>
  );
}

const renderShell = (canEdit: boolean) =>
  render(
    <BoardShell
      canEdit={canEdit}
      onDragStart={vi.fn()}
      onDragEnd={vi.fn()}
      gridDataSlot="planner-board"
      header={null}
      center={<DisabledChip />}
      dialog={null}
      overlay={null}
    />,
  );

const chip = (): HTMLElement => {
  const element = screen.getByText("Physics");
  if (!(element instanceof HTMLElement)) throw new Error("chip not rendered");
  return element;
};

describe("BoardShell — dnd-kit's accessibility decoration", () => {
  it("decorates an editor's disabled draggable (the plugin is on)", async () => {
    renderShell(true);
    await waitFor(() => {
      expect(chip()).toHaveAttribute("aria-disabled", "true");
    });
    expect(chip()).toHaveAttribute("role", "button");
    expect(chip()).toHaveAttribute("tabindex", "0");
  });

  it("leaves a viewer's disabled draggable undecorated, so its read controls stay enabled", async () => {
    renderShell(false);
    // Let a scheduled decoration pass run, if one were coming, before asserting it never landed.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(chip()).not.toHaveAttribute("aria-disabled");
    expect(chip()).not.toHaveAttribute("role");
    expect(chip()).not.toHaveAttribute("tabindex");
    // `toBeEnabled` ignores `aria-disabled`, which is exactly the inheritance at stake — so look for it.
    const badge = screen.getByRole("button", { name: "Show collision details" });
    expect(badge.closest('[aria-disabled="true"]')).toBeNull();
  });
});
