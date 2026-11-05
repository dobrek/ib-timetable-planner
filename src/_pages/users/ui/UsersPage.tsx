import { Toaster } from "@/shared/ui";
import { useRoleChange } from "../model/use-role-change";
import type { UserRow } from "../model/user-rows";
import ConfirmRoleChangeDialog from "./ConfirmRoleChangeDialog";
import UserTable from "./UserTable";

type Props = {
  rows: UserRow[];
  /** The signed-in admin, whose own row reads "You" and asks before it changes. */
  currentUserId: string;
};

/** The Users page island (S-406): a thin orchestrator over the table and the confirmation. */
export default function UsersPage({ rows, currentUserId }: Props) {
  const roleChange = useRoleChange(currentUserId);
  const { confirmation } = roleChange;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">Users</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Give each person a role. A change applies from their next page load.
        </p>
      </header>

      <UserTable
        rows={rows}
        currentUserId={currentUserId}
        saving={roleChange.saving}
        onChooseRole={roleChange.choose}
      />

      <ConfirmRoleChangeDialog
        confirmation={confirmation}
        isBusy={confirmation !== null && roleChange.saving.has(confirmation.row.userId)}
        onConfirm={roleChange.confirm}
        onClose={roleChange.cancel}
      />
      <Toaster />
    </div>
  );
}
