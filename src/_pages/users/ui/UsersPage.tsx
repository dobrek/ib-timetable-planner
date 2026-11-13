import { useState } from "react";
import { refreshPage } from "@/shared/lib/forms";
import { Button, Toaster } from "@/shared/ui";
import type { PasswordReveal } from "../model/schemas";
import { CONFIRMED_ACCOUNT_ACTIONS, useAccountActions } from "../model/use-account-actions";
import { useActivationActions } from "../model/use-activation-actions";
import { useInvitationActions } from "../model/use-invitation-actions";
import { useReissuePassword } from "../model/use-reissue-password";
import { useRoleChange } from "../model/use-role-change";
import type { RowAction, UserRow } from "../model/user-rows";
import ChangeEmailDialog from "./ChangeEmailDialog";
import ConfirmAccountActionDialog from "./ConfirmAccountActionDialog";
import ConfirmDeactivateDialog from "./ConfirmDeactivateDialog";
import ConfirmReissueDialog from "./ConfirmReissueDialog";
import ConfirmRevokeDialog from "./ConfirmRevokeDialog";
import ConfirmRoleChangeDialog from "./ConfirmRoleChangeDialog";
import CreateAccountDialog from "./CreateAccountDialog";
import InviteDialog from "./InviteDialog";
import TemporaryPasswordDialog from "./TemporaryPasswordDialog";
import UserTable from "./UserTable";

type Props = {
  /** The rows, the signed-in admin's own among them (`isSelf`): it reads "You" and offers less. */
  rows: UserRow[];
};

/**
 * The Users page island (S-406, S-408, S-409, S-410, S-411): a thin orchestrator over the table, the
 * confirmations and the account dialogs. Each row action goes to the hook that owns it. The one-time
 * password lives here, in state, and nowhere else: closing its dialog clears it and reloads the page,
 * so the new or re-issued row shows. A sent invitation reloads the page at once, since it reveals
 * nothing.
 */
export default function UsersPage({ rows }: Props) {
  const roleChange = useRoleChange();
  const [isInviting, setIsInviting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [reveal, setReveal] = useState<PasswordReveal | null>(null);
  const reissue = useReissuePassword(setReveal);
  const invitation = useInvitationActions();
  const activation = useActivationActions();
  const accounts = useAccountActions();
  const { confirmation } = roleChange;

  const rowActions: Record<RowAction, (row: UserRow) => void> = {
    reissue: reissue.ask,
    resend: invitation.resend,
    revoke: invitation.askRevoke,
    deactivate: activation.askDeactivate,
    reactivate: activation.reactivate,
    ban: (row) => {
      accounts.ask("ban", row);
    },
    unban: (row) => {
      accounts.ask("unban", row);
    },
    delete: (row) => {
      accounts.ask("delete", row);
    },
    change_email: accounts.askChangeEmail,
  };

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
        <div className="flex flex-wrap gap-2">
          {/* Primary: the email invitation is the way in (S-410, FR-401). */}
          <Button
            type="button"
            onClick={() => {
              setIsInviting(true);
            }}
          >
            Invite
          </Button>
          {/* The fallback for someone an invitation cannot reach (S-409, FR-403). */}
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setIsCreating(true);
            }}
          >
            Create account
          </Button>
        </div>
      </header>

      <UserTable
        rows={rows}
        saving={roleChange.saving}
        onChooseRole={roleChange.choose}
        inFlight={{ resend: invitation.resending, reactivate: activation.reactivating }}
        onAction={(action, row) => {
          rowActions[action](row);
        }}
      />

      <ConfirmRoleChangeDialog
        confirmation={confirmation}
        isBusy={confirmation !== null && roleChange.saving.has(confirmation.row.userId)}
        onConfirm={roleChange.confirm}
        onClose={roleChange.cancel}
      />
      <InviteDialog
        open={isInviting}
        onClose={() => {
          setIsInviting(false);
        }}
        onSent={() => {
          setIsInviting(false);
          void refreshPage();
        }}
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
      <ConfirmRevokeDialog
        target={invitation.revokeTarget}
        isBusy={invitation.isRevoking}
        onConfirm={invitation.confirmRevoke}
        onClose={invitation.cancelRevoke}
      />
      <ConfirmDeactivateDialog
        target={activation.deactivateTarget}
        isBusy={activation.isDeactivating}
        onConfirm={activation.confirmDeactivate}
        onClose={activation.cancelDeactivate}
      />
      {CONFIRMED_ACCOUNT_ACTIONS.map((action) => (
        <ConfirmAccountActionDialog
          key={action}
          action={action}
          target={accounts.pending?.action === action ? accounts.pending.row : null}
          isBusy={accounts.isBusy}
          onConfirm={accounts.confirm}
          onClose={accounts.cancel}
        />
      ))}
      <ChangeEmailDialog target={accounts.emailTarget} onClose={accounts.closeChangeEmail} />
      <TemporaryPasswordDialog reveal={reveal} onClose={finishReveal} />
      <Toaster />
    </div>
  );
}
