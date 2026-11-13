import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/shared/config";
import {
  ACCEPTED_ROW,
  ADMIN_ID,
  AUTHOR_ID,
  AUTHOR_ROW,
  BANNED_ROW,
  COLLEAGUE_ROW,
  DEACTIVATED_ID,
  DEACTIVATED_ROW,
  INVITED_ID,
  INVITED_ROW,
  NO_ROLE_ROW,
  PENDING_ROW,
  ROWS,
} from "./__fixtures__/user-rows";
import UserTable from "./UserTable";

const renderTable = (
  saving: ReadonlyMap<string, AppRole | null> = new Map(),
  resending: ReadonlySet<string> = new Set(),
  reactivating: ReadonlySet<string> = new Set(),
) => {
  const onChooseRole = vi.fn();
  const onReissuePassword = vi.fn();
  const onResendInvitation = vi.fn();
  const onRevokeInvitation = vi.fn();
  const onDeactivate = vi.fn();
  const onReactivate = vi.fn();
  const onBan = vi.fn();
  const onUnban = vi.fn();
  const onDeleteAccount = vi.fn();
  const onChangeEmail = vi.fn();
  render(
    <UserTable
      rows={ROWS}
      currentUserId={ADMIN_ID}
      saving={saving}
      onChooseRole={onChooseRole}
      onReissuePassword={onReissuePassword}
      resending={resending}
      onResendInvitation={onResendInvitation}
      onRevokeInvitation={onRevokeInvitation}
      onDeactivate={onDeactivate}
      reactivating={reactivating}
      onReactivate={onReactivate}
      onBan={onBan}
      onUnban={onUnban}
      onDeleteAccount={onDeleteAccount}
      onChangeEmail={onChangeEmail}
    />,
  );
  return {
    onChooseRole,
    onReissuePassword,
    onResendInvitation,
    onRevokeInvitation,
    onDeactivate,
    onReactivate,
    onBan,
    onUnban,
    onDeleteAccount,
    onChangeEmail,
  };
};

/** The row whose picker is named for `name`: a name can also appear in another row's "Changed by". */
const rowOf = (name: string) => {
  const row = screen.getByRole("combobox", { name: `Role for ${name}` }).closest("tr");
  if (!row) throw new Error(`no row for ${name}`);
  return within(row);
};

const choose = (picker: string, option: string) => {
  fireEvent.keyDown(screen.getByRole("combobox", { name: picker }), { key: "Enter" });
  fireEvent.click(screen.getByRole("option", { name: option }));
};

describe("UserTable", () => {
  it("names each user by display name with the email beneath, or by the email alone", () => {
    renderTable();

    expect(rowOf("Bea Author").getByText("bea@example.test")).toBeInTheDocument();
    expect(rowOf("cal@example.test").queryAllByText(/@example\.test/)).toHaveLength(1);
  });

  it("marks the admin's own row You, and a flagged one Service account, and no other", () => {
    renderTable();

    expect(rowOf("admin@example.test").getByText("You")).toBeInTheDocument();
    expect(rowOf("Bea Author").getByText("Service account")).toBeInTheDocument();
    expect(screen.getAllByText("You")).toHaveLength(1);
    expect(screen.getAllByText("Service account")).toHaveLength(1);
  });

  it("shows each role in its picker, and the status beside it", () => {
    renderTable();

    expect(screen.getByRole("combobox", { name: "Role for Bea Author" })).toHaveTextContent("Author");
    expect(screen.getByRole("combobox", { name: "Role for cal@example.test" })).toHaveTextContent("No access");
    expect(rowOf("Bea Author").getByText("Active")).toBeInTheDocument();
    expect(rowOf("cal@example.test").getAllByText("No access")).toHaveLength(2);
  });

  it("says Temporary password for a pending row, which still shows its waiting role", () => {
    renderTable();

    expect(rowOf("dee@example.test").getByText("Temporary password")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for dee@example.test" })).toHaveTextContent("Viewer");
  });

  it("offers Re-issue password on the pending row alone, and it asks for that row", () => {
    const { onReissuePassword } = renderTable();

    expect(screen.getAllByRole("button", { name: /Re-issue password/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Re-issue password for dee@example.test" }));

    expect(onReissuePassword).toHaveBeenCalledWith(PENDING_ROW);
  });

  it("says Invited and Invitation accepted for the two invitation rows, each still showing its role", () => {
    renderTable();

    expect(rowOf("eve@example.test").getByText("Invited")).toBeInTheDocument();
    expect(rowOf("fay@example.test").getByText("Invitation accepted")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Role for eve@example.test" })).toHaveTextContent("Viewer");
  });

  it("offers Re-send on the unaccepted invitation alone, and it hands that row up", () => {
    const { onResendInvitation } = renderTable();

    expect(screen.getAllByRole("button", { name: /Re-send invitation/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Re-send invitation to eve@example.test" }));

    expect(onResendInvitation).toHaveBeenCalledWith(INVITED_ROW);
  });

  it("offers Revoke on both invitations, accepted or not, and never on another row", () => {
    const { onRevokeInvitation } = renderTable();

    expect(screen.getAllByRole("button", { name: /Revoke invitation/ })).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Revoke invitation for fay@example.test" }));

    expect(onRevokeInvitation).toHaveBeenCalledWith(ACCEPTED_ROW);
    expect(rowOf("dee@example.test").queryByRole("button", { name: /Revoke|Re-send/ })).not.toBeInTheDocument();
  });

  it("disables a row's Re-send while it is in flight", () => {
    renderTable(new Map(), new Set([INVITED_ID]));

    expect(screen.getByRole("button", { name: "Re-send invitation to eve@example.test" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Revoke invitation for eve@example.test" })).toBeEnabled();
  });

  it("offers Deactivate on another user's active row alone, never your own, and it hands that row up", () => {
    const { onDeactivate } = renderTable();

    expect(screen.getAllByRole("button", { name: /^Deactivate / })).toHaveLength(2);
    expect(rowOf("admin@example.test").queryByRole("button", { name: /Deactivate/ })).not.toBeInTheDocument();
    for (const name of ["cal@example.test", "dee@example.test", "eve@example.test", "gil@example.test"]) {
      expect(rowOf(name).queryByRole("button", { name: /^Deactivate/ })).not.toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Deactivate Bea Author" }));

    expect(onDeactivate).toHaveBeenCalledWith(AUTHOR_ROW);
  });

  it("says Deactivated for a deactivated row, which keeps its role in a live picker, and offers Reactivate alone", () => {
    const { onReactivate } = renderTable();

    expect(rowOf("gil@example.test").getByText("Deactivated")).toBeInTheDocument();
    const picker = screen.getByRole("combobox", { name: "Role for gil@example.test" });
    expect(picker).toBeEnabled();
    expect(picker).toHaveTextContent("Viewer");
    expect(screen.getAllByRole("button", { name: /^Reactivate / })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Reactivate gil@example.test" }));

    expect(onReactivate).toHaveBeenCalledWith(DEACTIVATED_ROW);
  });

  it("offers Ban, Delete and Change email on an active colleague, a deactivated row and a temporary password, and not on an invitation, the service account, a row with no role, or the admin's own Ban and Delete", () => {
    const { onBan, onDeleteAccount, onChangeEmail } = renderTable();

    for (const name of ["Ida Colleague", "gil@example.test", "dee@example.test"]) {
      expect(rowOf(name).getByRole("button", { name: `Ban ${name}` })).toBeInTheDocument();
      expect(rowOf(name).getByRole("button", { name: `Delete ${name}` })).toBeInTheDocument();
      expect(rowOf(name).getByRole("button", { name: `Change email for ${name}` })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole("button", { name: "Ban Ida Colleague" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete gil@example.test" }));
    fireEvent.click(screen.getByRole("button", { name: "Change email for dee@example.test" }));
    expect(onBan).toHaveBeenCalledWith(COLLEAGUE_ROW);
    expect(onDeleteAccount).toHaveBeenCalledWith(DEACTIVATED_ROW);
    expect(onChangeEmail).toHaveBeenCalledWith(PENDING_ROW);

    expect(rowOf("admin@example.test").queryByRole("button", { name: /^Ban / })).not.toBeInTheDocument();
    expect(rowOf("admin@example.test").queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
    expect(
      rowOf("admin@example.test").getByRole("button", { name: "Change email for admin@example.test" }),
    ).toBeInTheDocument();
    for (const name of ["Bea Author", "cal@example.test", "eve@example.test", "fay@example.test"]) {
      expect(rowOf(name).queryByRole("button", { name: /^Ban / })).not.toBeInTheDocument();
      expect(rowOf(name).queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
      expect(rowOf(name).queryByRole("button", { name: /Change email/ })).not.toBeInTheDocument();
    }
  });

  it("offers Unban, Delete and Change email on a banned row, and not Ban, Deactivate, Reactivate or Re-issue", () => {
    const { onUnban } = renderTable();
    const row = rowOf("jo@example.test");

    expect(row.getByText("Banned")).toBeInTheDocument();
    fireEvent.click(row.getByRole("button", { name: "Unban jo@example.test" }));
    expect(onUnban).toHaveBeenCalledWith(BANNED_ROW);
    expect(row.getByRole("button", { name: "Delete jo@example.test" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Change email for jo@example.test" })).toBeInTheDocument();
    expect(row.queryByRole("button", { name: /^Ban / })).not.toBeInTheDocument();
    expect(row.queryByRole("button", { name: /Deactivate|Reactivate|Re-issue/ })).not.toBeInTheDocument();
  });

  it("disables a banned row's role picker: a role write would strand the ban or hand back access", () => {
    renderTable();

    expect(screen.getByRole("combobox", { name: "Role for jo@example.test" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "Role for Bea Author" })).toBeEnabled();
  });

  it("disables a row's Reactivate while it is in flight", () => {
    renderTable(new Map(), new Set(), new Set([DEACTIVATED_ID]));

    expect(screen.getByRole("button", { name: "Reactivate gil@example.test" })).toBeDisabled();
  });

  it("names who changed the role last, or shows a dash", () => {
    renderTable();

    expect(rowOf("Bea Author").getByText(/Changed by/)).toHaveTextContent("Changed by admin@example.test ·");
    expect(rowOf("admin@example.test").getByText(/Changed by/)).toHaveTextContent("Changed by Operator ·");
    expect(rowOf("cal@example.test").getByText("—")).toBeInTheDocument();
  });

  it.each([
    ["a role", "Role for Bea Author", "Viewer", AUTHOR_ROW, "viewer"],
    ["No access", "Role for Bea Author", "No access", AUTHOR_ROW, null],
    ["a role for a role-less user", "Role for cal@example.test", "Admin", NO_ROLE_ROW, "admin"],
  ] as const)("hands %s up to the page", (_label, picker, option, row, role) => {
    const { onChooseRole } = renderTable();

    choose(picker, option);

    expect(onChooseRole).toHaveBeenCalledWith(row, role);
  });

  it("disables a row's picker while it saves, showing the role being saved", () => {
    renderTable(new Map([[AUTHOR_ID, "viewer"]]));

    const saving = screen.getByRole("combobox", { name: "Role for Bea Author" });
    expect(saving).toBeDisabled();
    expect(saving).toHaveTextContent("Viewer");
    expect(screen.getByRole("combobox", { name: "Role for cal@example.test" })).toBeEnabled();
  });
});
