import type { AppRole } from "@/shared/config";
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import { STATUS_LABELS } from "../model/status-labels";
import type { UserRow } from "../model/user-rows";
import LastChange from "./LastChange";
import RoleSelect from "./RoleSelect";

type Props = {
  rows: UserRow[];
  currentUserId: string;
  /** The role being saved for each row in flight: its picker shows that role, disabled. */
  saving: ReadonlyMap<string, AppRole | null>;
  onChooseRole: (row: UserRow, role: AppRole | null) => void;
  /** Asks to replace a pending row's temporary password. Only rows with `canReissuePassword` offer it. */
  onReissuePassword: (row: UserRow) => void;
  /** The rows whose invitation is being re-sent: their Re-send stays disabled until it answers. */
  resending: ReadonlySet<string>;
  /** Re-sends an unaccepted invitation. Only rows with `canResendInvitation` offer it. */
  onResendInvitation: (row: UserRow) => void;
  /** Asks to revoke an invitation. Only rows with `canRevokeInvitation` offer it. */
  onRevokeInvitation: (row: UserRow) => void;
};

/**
 * Every human user of the school, one row each, with a role picker. Rows arrive sorted. A pending
 * row's status cell carries its actions: Re-issue password (S-409), or Re-send and Revoke (S-410).
 * The picker stays live on an invitee's row: changing it is the same role write as on any row.
 */
export default function UserTable({
  rows,
  currentUserId,
  saving,
  onChooseRole,
  onReissuePassword,
  resending,
  onResendInvitation,
  onRevokeInvitation,
}: Props) {
  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Last change</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const isSaving = saving.has(row.userId);
            return (
              <TableRow key={row.userId}>
                <TableCell>
                  <UserCell row={row} isSelf={row.userId === currentUserId} />
                </TableCell>
                <TableCell>
                  <RoleSelect
                    name={row.label.primary}
                    role={isSaving ? (saving.get(row.userId) ?? null) : row.role}
                    disabled={isSaving}
                    onChange={(role) => {
                      onChooseRole(row, role);
                    }}
                  />
                </TableCell>
                <TableCell className={row.status === "active" ? undefined : "text-muted-foreground"}>
                  <div className="flex flex-wrap items-center gap-x-3">
                    <span>{STATUS_LABELS[row.status]}</span>
                    {row.canReissuePassword && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        aria-label={`Re-issue password for ${row.label.primary}`}
                        onClick={() => {
                          onReissuePassword(row);
                        }}
                      >
                        Re-issue password
                      </Button>
                    )}
                    {row.canResendInvitation && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        aria-label={`Re-send invitation to ${row.label.primary}`}
                        disabled={resending.has(row.userId)}
                        onClick={() => {
                          onResendInvitation(row);
                        }}
                      >
                        Re-send
                      </Button>
                    )}
                    {row.canRevokeInvitation && (
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        aria-label={`Revoke invitation for ${row.label.primary}`}
                        onClick={() => {
                          onRevokeInvitation(row);
                        }}
                      >
                        Revoke
                      </Button>
                    )}
                  </div>
                </TableCell>
                {/* Wraps, unlike the other cells: a long name and a date together outgrow narrow screens. */}
                <TableCell className="whitespace-normal">
                  <LastChange change={row.lastChange} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

/** The display name with the email beneath it (FR-413), or the email alone, and the row's badges. */
function UserCell({ row, isSelf }: { row: UserRow; isSelf: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-foreground font-medium">{row.label.primary}</span>
        {isSelf && <Badge variant="secondary">You</Badge>}
        {row.isServiceAccount && <Badge variant="outline">Service account</Badge>}
      </span>
      {row.label.secondary && <span className="text-muted-foreground text-xs">{row.label.secondary}</span>}
    </div>
  );
}
