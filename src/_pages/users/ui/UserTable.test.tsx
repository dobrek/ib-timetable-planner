import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AppRole } from "@/shared/config";
import { ADMIN_ID, AUTHOR_ID, AUTHOR_ROW, NO_ROLE_ROW, PENDING_ROW, ROWS } from "./__fixtures__/user-rows";
import UserTable from "./UserTable";

const renderTable = (saving: ReadonlyMap<string, AppRole | null> = new Map()) => {
  const onChooseRole = vi.fn();
  const onReissuePassword = vi.fn();
  render(
    <UserTable
      rows={[...ROWS, PENDING_ROW]}
      currentUserId={ADMIN_ID}
      saving={saving}
      onChooseRole={onChooseRole}
      onReissuePassword={onReissuePassword}
    />,
  );
  return { onChooseRole, onReissuePassword };
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
