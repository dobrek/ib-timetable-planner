import { useState } from "react";
import { refreshPage } from "@/shared/lib/forms";
import { Button, Toaster } from "@/shared/ui";
import type { PasswordReveal } from "../model/schemas";
import { useReissuePassword } from "../model/use-reissue-password";
import { useRoleChange } from "../model/use-role-change";
import type { UserRow } from "../model/user-rows";
import ConfirmReissueDialog from "./ConfirmReissueDialog";
import ConfirmRoleChangeDialog from "./ConfirmRoleChangeDialog";
import CreateAccountDialog from "./CreateAccountDialog";
import TemporaryPasswordDialog from "./TemporaryPasswordDialog";
import UserTable from "./UserTable";

type Props = {
  rows: UserRow[];
  /** The signed-in admin, whose own row reads "You" and asks before it changes. */
  currentUserId: string;
};

/**
 * The Users page island (S-406, S-409): a thin orchestrator over the table, the confirmations and the
 * account dialogs. The one-time password lives here, in state, and nowhere else: closing its dialog
 * clears it and reloads the page, so the new or re-issued row shows.
 */
export default function UsersPage({ rows, currentUserId }: Props) {
  const roleChange = useRoleChange(currentUserId);
  const [isCreating, setIsCreating] = useState(false);
  const [reveal, setReveal] = useState<PasswordReveal | null>(null);
  const reissue = useReissuePassword(setReveal);
  const { confirmation } = roleChange;

  const finishReveal = (): void => {
    setReveal(null);
    void refreshPage();
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Users</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Give each person a role. A change applies from their next page load.
          </p>
        </div>
        {/* Secondary: the email invitation (S-410) is the way in. This is the fallback (FR-403). */}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            setIsCreating(true);
          }}
        >
          Create account
        </Button>
      </header>

      <UserTable
        rows={rows}
        currentUserId={currentUserId}
        saving={roleChange.saving}
        onChooseRole={roleChange.choose}
        onReissuePassword={reissue.ask}
      />

      <ConfirmRoleChangeDialog
        confirmation={confirmation}
        isBusy={confirmation !== null && roleChange.saving.has(confirmation.row.userId)}
        onConfirm={roleChange.confirm}
        onClose={roleChange.cancel}
      />
      <CreateAccountDialog
        open={isCreating}
        onClose={() => {
          setIsCreating(false);
        }}
        onCreated={(created) => {
          setIsCreating(false);
          setReveal(created);
        }}
      />
      <ConfirmReissueDialog
        target={reissue.target}
        isBusy={reissue.isBusy}
        onConfirm={reissue.confirm}
        onClose={reissue.cancel}
      />
      <TemporaryPasswordDialog reveal={reveal} onClose={finishReveal} />
      <Toaster />
    </div>
  );
}
