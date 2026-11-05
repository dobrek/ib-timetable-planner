import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PendingConfirmation } from "../model/use-role-change";
import ConfirmRoleChangeDialog from "./ConfirmRoleChangeDialog";
import { ADMIN_ROW, AUTHOR_ROW } from "./fixtures";

const renderDialog = (confirmation: PendingConfirmation | null, isBusy = false) => {
  const handlers = { onConfirm: vi.fn(), onClose: vi.fn() };
  render(<ConfirmRoleChangeDialog confirmation={confirmation} isBusy={isBusy} {...handlers} />);
  return handlers;
};

describe("ConfirmRoleChangeDialog", () => {
  it.each([
    [
      "your own new role",
      { row: ADMIN_ROW, role: "viewer", reason: "self" },
      "Change your own role to Viewer?",
      /lose admin access/,
      "Change my role",
    ],
    [
      "removing your own access",
      { row: ADMIN_ROW, role: null, reason: "self" },
      "Remove your own access?",
      /lose all access/,
      "Remove my access",
    ],
    [
      "removing someone else's access",
      { row: AUTHOR_ROW, role: null, reason: "remove" },
      "Remove access for Bea Author?",
      /Bea Author will lose access to every plan/,
      "Remove access",
    ],
  ] as const)("explains %s", (_label, confirmation, title, description, action) => {
    renderDialog(confirmation);

    const dialog = screen.getByRole("alertdialog", { name: title });
    expect(dialog).toHaveTextContent(description);
    expect(screen.getByRole("button", { name: action })).toBeInTheDocument();
  });

  it("confirms, or closes on Cancel", () => {
    const handlers = renderDialog({ row: AUTHOR_ROW, role: null, reason: "remove" });

    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));
    expect(handlers.onConfirm).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(handlers.onClose).toHaveBeenCalledOnce();
  });

  it("disables both buttons while the change saves", () => {
    renderDialog({ row: AUTHOR_ROW, role: null, reason: "remove" }, true);

    expect(screen.getByRole("button", { name: "Remove access" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();
  });

  it("renders nothing when no change waits", () => {
    renderDialog(null);

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
