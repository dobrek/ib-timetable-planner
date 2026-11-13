import type { AppRole } from "@/shared/config";
import { Badge, Button, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import { ACTION_LABELS } from "../model/action-labels";
import { STATUS_LABELS } from "../model/status-labels";
import type { RowAction, UserRow } from "../model/user-rows";
import LastChange from "./LastChange";
import RoleSelect from "./RoleSelect";

type Props = {
  rows: UserRow[];
  /** The role being saved for each row in flight: its picker shows that role, disabled. */
  saving: ReadonlyMap<string, AppRole | null>;
  onChooseRole: (row: UserRow, role: AppRole | null) => void;
  /** The rows each action runs for right now: that action's link stays disabled until it answers. */
  inFlight: Readonly<Partial<Record<RowAction, ReadonlySet<string>>>>;
  /** Runs one of a row's `actions`, or asks to confirm it. */
  onAction: (action: RowAction, row: UserRow) => void;
};

/**
 * Every human user of the school, one row each, with a role picker. Rows arrive sorted. The status
 * cell carries the row's own `actions`, decided by its status (`user-rows.ts`): Re-issue password,
 * Re-send and Revoke, Deactivate and Reactivate, Ban, Unban, Delete and Change email. The picker
 * stays live on every row but a banned one: changing it is the same role write as on any row, and
 * it never reactivates anyone.
 */
export default function UserTable({ rows, saving, onChooseRole, inFlight, onAction }: Props) {
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
                  <UserCell row={row} />
                </TableCell>
                <TableCell>
                  <RoleSelect
                    name={row.label.primary}
                    role={isSaving ? (saving.get(row.userId) ?? null) : row.role}
                    disabled={isSaving || !row.canChangeRole}
                    onChange={(role) => {
                      onChooseRole(row, role);
                    }}
                  />
                </TableCell>
                <TableCell className={row.status === "active" ? undefined : "text-muted-foreground"}>
                  <div className="flex flex-wrap items-center gap-x-3">
                    <span>{STATUS_LABELS[row.status]}</span>
                    {row.actions.map((action) => (
                      <Button
                        key={action}
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0"
                        aria-label={ACTION_LABELS[action].nameFor(row.label.primary)}
                        disabled={inFlight[action]?.has(row.userId) ?? false}
                        onClick={() => {
                          onAction(action, row);
                        }}
                      >
                        {ACTION_LABELS[action].text}
                      </Button>
                    ))}
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
function UserCell({ row }: { row: UserRow }) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <span className="text-foreground font-medium">{row.label.primary}</span>
        {row.isSelf && <Badge variant="secondary">You</Badge>}
        {row.isServiceAccount && <Badge variant="outline">Service account</Badge>}
      </span>
      {row.label.secondary && <span className="text-muted-foreground text-xs">{row.label.secondary}</span>}
    </div>
  );
}
