import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPage } from "@/shared/lib/forms";
import { changeUserRole } from "../api/user-client";
import { goToDashboard } from "../lib/go-to-dashboard";
import { ADMIN_ID, AUTHOR_ID, ROWS } from "./fixtures";
import UsersPage from "./UsersPage";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("../api/user-client", () => ({ changeUserRole: vi.fn() }));
vi.mock("../lib/go-to-dashboard", () => ({ goToDashboard: vi.fn() }));
vi.mock("@/shared/lib/forms", () => ({ refreshPage: vi.fn() }));

/**
 * The page's role-change flow (S-406): another user's role saves at once; your own role and
 * anyone's No access ask first. Each "asks" case is paired with the save that follows, or not.
 */
describe("UsersPage", () => {
  beforeEach(() => {
    vi.mocked(changeUserRole).mockReset().mockResolvedValue({ error: undefined });
    vi.mocked(refreshPage).mockReset();
    vi.mocked(goToDashboard).mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
  });

  it("saves another user's new role at once, without asking, then reloads", async () => {
    renderPage();

    choose("Role for Bea Author", "Viewer");

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(changeUserRole).toHaveBeenCalledWith({ userId: AUTHOR_ID, role: "viewer" });
    await waitFor(() => {
      expect(refreshPage).toHaveBeenCalledOnce();
    });
    expect(toastSuccess).toHaveBeenCalledWith("Role changed");
  });

  it("asks before changing your own role, and leaves for the dashboard once it saves", async () => {
    renderPage();

    choose("Role for admin@example.test", "Author");
    expect(screen.getByRole("alertdialog", { name: "Change your own role to Author?" })).toBeInTheDocument();
    expect(changeUserRole).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Change my role" }));

    expect(changeUserRole).toHaveBeenCalledWith({ userId: ADMIN_ID, role: "author" });
    await waitFor(() => {
      expect(goToDashboard).toHaveBeenCalledOnce();
    });
    expect(refreshPage).not.toHaveBeenCalled();
  });

  it("asks before No access for anyone, and saves nothing on Cancel", async () => {
    renderPage();

    choose("Role for Bea Author", "No access");
    expect(screen.getByRole("alertdialog", { name: "Remove access for Bea Author?" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(changeUserRole).not.toHaveBeenCalled();
  });

  it("keeps the page on the last-admin refusal, so its message stays, and the picker reverts", async () => {
    refuseWith("CONFLICT", "The school must keep at least one admin.");
    renderPage();

    choose("Role for admin@example.test", "Viewer");
    fireEvent.click(screen.getByRole("button", { name: "Change my role" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("The school must keep at least one admin.");
    });
    expect(screen.getByRole("combobox", { name: "Role for admin@example.test" })).toHaveTextContent("Admin");
    expect(refreshPage).not.toHaveBeenCalled();
    expect(goToDashboard).not.toHaveBeenCalled();
  });

  it("reloads on a refusal that means the page is out of date", async () => {
    refuseWith("NOT_FOUND", "That user already has no access.");
    renderPage();

    choose("Role for Bea Author", "No access");
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

    await waitFor(() => {
      expect(refreshPage).toHaveBeenCalledOnce();
    });
    expect(toastError).toHaveBeenCalledWith("That user already has no access.");
  });
});

const refuseWith = (code: string, message: string) => {
  vi.mocked(changeUserRole).mockResolvedValue({ error: { code, message } } as Awaited<
    ReturnType<typeof changeUserRole>
  >);
};

const renderPage = () => render(<UsersPage rows={ROWS} currentUserId={ADMIN_ID} />);

const choose = (picker: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: picker }), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
};
