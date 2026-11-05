import type { AppRole } from "@/shared/config";
import { Badge, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import type { UserRow } from "../model/user-rows";
import LastChange from "./LastChange";
import RoleSelect from "./RoleSelect";

type Props = {
  rows: UserRow[];
  currentUserId: string;
  /** The role being saved for each row in flight: its picker shows that role, disabled. */
  saving: ReadonlyMap<string, AppRole | null>;
  onChooseRole: (row: UserRow, role: AppRole | null) => void;
};

/** Every human user of the school, one row each, with a role picker. Rows arrive sorted. */
export default function UserTable({ rows, currentUserId, saving, onChooseRole }: Props) {
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
                  {row.status === "active" ? "Active" : "No access"}
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
