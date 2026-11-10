import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { refreshPage } from "@/shared/lib/forms";
import { changeUserRole, createAccount, reissueTemporaryPassword } from "../api/user-client";
import { goToDashboard } from "../lib/go-to-dashboard";
import { ADMIN_ID, AUTHOR_ID, PENDING_ID, ROWS } from "./__fixtures__/user-rows";
import UsersPage from "./UsersPage";

const { toastSuccess, toastError } = vi.hoisted(() => ({ toastSuccess: vi.fn(), toastError: vi.fn() }));
vi.mock("sonner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("sonner")>()),
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("../api/user-client", () => ({
  changeUserRole: vi.fn(),
  createAccount: vi.fn(),
  reissueTemporaryPassword: vi.fn(),
}));
vi.mock("../lib/go-to-dashboard", () => ({ goToDashboard: vi.fn() }));
// The barrel pulls in `astro:transitions/client`, which Vitest cannot resolve.
vi.mock("@/shared/lib/forms", () => ({ refreshPage: vi.fn(), applyActionFieldErrors: vi.fn() }));

beforeEach(() => {
  vi.mocked(changeUserRole).mockReset().mockResolvedValue({ error: undefined });
  vi.mocked(createAccount).mockReset();
  vi.mocked(reissueTemporaryPassword).mockReset();
  vi.mocked(refreshPage).mockReset();
  vi.mocked(goToDashboard).mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
});

/**
 * The page's role-change flow (S-406): another user's role saves at once; your own role and
 * anyone's No access ask first. Each "asks" case is paired with the save that follows, or not.
 */
describe("UsersPage", () => {
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

  it("frees the row and closes the dialog when the request never completes", async () => {
    vi.mocked(changeUserRole).mockRejectedValue(new TypeError("Failed to fetch"));
    renderPage();

    choose("Role for Bea Author", "No access");
    fireEvent.click(screen.getByRole("button", { name: "Remove access" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(toastError).toHaveBeenCalledWith("Role change failed — try again.");
    const picker = screen.getByRole("combobox", { name: "Role for Bea Author" });
    expect(picker).toBeEnabled();
    expect(picker).toHaveTextContent("Author");
    expect(refreshPage).not.toHaveBeenCalled();
  });
});

const PASSWORD = "Abcdefghjkmnpqrstuvwxyz2";

/** Account provisioning (S-409): the one-time reveal, and what clears it. */
describe("UsersPage account provisioning", () => {
  it("creates an account and shows the password once, only after the admin confirms the address twice", async () => {
    vi.mocked(createAccount).mockResolvedValue({ data: { userId: PENDING_ID, password: PASSWORD }, error: undefined });
    renderPage();

    submitCreateForm("dee@example.test");

    expect(await screen.findByLabelText("Password to hand over")).toHaveTextContent(PASSWORD);
    expect(createAccount).toHaveBeenCalledWith({ email: "dee@example.test", role: "viewer" });
    // The page waits for the admin: a reload now would drop the only copy of the password.
    expect(refreshPage).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith(expect.stringContaining(PASSWORD));
  });

  it("refuses two different addresses and creates nothing", async () => {
    renderPage();

    submitCreateForm("dee@example.test", "dea@example.test");

    expect(await screen.findByText("The two addresses don't match.")).toBeInTheDocument();
    expect(createAccount).not.toHaveBeenCalled();
  });

  it("puts an existing address on the email field and shows no password", async () => {
    vi.mocked(createAccount).mockResolvedValue({
      data: undefined,
      error: { code: "CONFLICT", message: "An account with this email already exists." },
    } as Awaited<ReturnType<typeof createAccount>>);
    renderPage();

    submitCreateForm("dee@example.test");

    expect(await screen.findByText("An account with this email already exists.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Password to hand over")).not.toBeInTheDocument();
  });

  it("clears the password on Done and reloads, and it is nowhere in the page afterwards", async () => {
    vi.mocked(createAccount).mockResolvedValue({ data: { userId: PENDING_ID, password: PASSWORD }, error: undefined });
    renderPage();
    submitCreateForm("dee@example.test");
    await screen.findByLabelText("Password to hand over");

    fireEvent.click(screen.getByRole("button", { name: "Done" }));

    await waitFor(() => {
      expect(screen.queryByLabelText("Password to hand over")).not.toBeInTheDocument();
    });
    expect(document.body).not.toHaveTextContent(PASSWORD);
    expect(refreshPage).toHaveBeenCalledOnce();
  });

  it("asks before re-issuing, and re-issues nothing on Cancel", async () => {
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Re-issue password for dee@example.test" }));
    expect(screen.getByRole("alertdialog", { name: "Issue a new password for dee@example.test?" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });
    expect(reissueTemporaryPassword).not.toHaveBeenCalled();
  });

  it("re-issues for the pending row once confirmed, and shows the new password once", async () => {
    vi.mocked(reissueTemporaryPassword).mockResolvedValue({
      data: { userId: PENDING_ID, password: PASSWORD },
      error: undefined,
    });
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Re-issue password for dee@example.test" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue new password" }));

    expect(await screen.findByLabelText("Password to hand over")).toHaveTextContent(PASSWORD);
    expect(reissueTemporaryPassword).toHaveBeenCalledWith({ userId: PENDING_ID });
  });

  it("keeps the page when the account is no longer pending, so the message saying why stays", async () => {
    vi.mocked(reissueTemporaryPassword).mockResolvedValue({
      data: undefined,
      error: { code: "CONFLICT", message: "That person has already chosen their own password." },
    } as Awaited<ReturnType<typeof reissueTemporaryPassword>>);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Re-issue password for dee@example.test" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue new password" }));

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith("That person has already chosen their own password.");
    });
    expect(refreshPage).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Password to hand over")).not.toBeInTheDocument();
  });

  it("reloads when the account is gone, so the row shows what the database holds", async () => {
    vi.mocked(reissueTemporaryPassword).mockResolvedValue({
      data: undefined,
      error: { code: "NOT_FOUND", message: "That account no longer exists." },
    } as Awaited<ReturnType<typeof reissueTemporaryPassword>>);
    renderPage();

    fireEvent.click(screen.getByRole("button", { name: "Re-issue password for dee@example.test" }));
    fireEvent.click(screen.getByRole("button", { name: "Issue new password" }));

    await waitFor(() => {
      expect(refreshPage).toHaveBeenCalledOnce();
    });
    expect(toastError).toHaveBeenCalledWith("That account no longer exists.");
  });

  it("cannot be dismissed with Escape, which would lose a password nobody copied", async () => {
    vi.mocked(createAccount).mockResolvedValue({ data: { userId: PENDING_ID, password: PASSWORD }, error: undefined });
    renderPage();
    submitCreateForm("dee@example.test");
    await screen.findByLabelText("Password to hand over");

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });

    expect(screen.getByLabelText("Password to hand over")).toHaveTextContent(PASSWORD);
  });
});

/** Open the create dialog, type the address and its confirmation, and submit. */
const submitCreateForm = (email: string, confirmEmail = email) => {
  fireEvent.click(screen.getByRole("button", { name: "Create account" }));
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Confirm email"), { target: { value: confirmEmail } });
  fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Create account" }));
};

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
