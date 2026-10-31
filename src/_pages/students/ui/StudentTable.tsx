import { MoreHorizontal, Plus } from "lucide-react";
import type { ReactNode } from "react";
import {
  Badge,
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/shared/ui";
import type { CourseOption, StudentRow } from "../model/student";

type Props = {
  planId: string;
  rows: StudentRow[];
  totalCount: number;
  coursesById: Map<string, CourseOption>;
  /** Without it there is no create call, no selection column, and the row menu holds only "View plan"
   *  (S-405) — selection exists only to feed the bulk edit. */
  canEdit: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleRow: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (student: StudentRow) => void;
  onDelete: (student: StudentRow) => void;
  onCreateFirst: () => void;
};

export default function StudentTable({
  planId,
  rows,
  totalCount,
  coursesById,
  canEdit,
  selectedIds,
  onToggleRow,
  onToggleAll,
  onEdit,
  onDelete,
  onCreateFirst,
}: Props) {
  if (totalCount === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground text-sm">
          {canEdit ? "No students yet — create your first student." : "No students yet."}
        </p>
        {canEdit && (
          <Button className="mt-4 gap-2" onClick={onCreateFirst}>
            <Plus aria-hidden="true" />
            New student
          </Button>
        )}
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No students match the current filter.</p>;
  }

  const allSelected = rows.every((row) => selectedIds.has(row.id));
  const someSelected = rows.some((row) => selectedIds.has(row.id));
  const headerState: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false;

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            {canEdit && (
              <TableHead className="w-10">
                <Checkbox checked={headerState} onCheckedChange={onToggleAll} aria-label="Select all students" />
              </TableHead>
            )}
            <TableHead>Name</TableHead>
            <TableHead>Choices</TableHead>
            <TableHead className="text-right">#</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => {
            const selected = selectedIds.has(row.id);
            return (
              <TableRow key={row.id} data-state={selected ? "selected" : undefined}>
                {canEdit && (
                  <TableCell>
                    <Checkbox
                      checked={selected}
                      onCheckedChange={() => {
                        onToggleRow(row.id);
                      }}
                      aria-label={`Select ${row.fullName}`}
                    />
                  </TableCell>
                )}
                <TableCell>
                  <StudentViewLink planId={planId} row={row}>
                    {row.fullName}
                  </StudentViewLink>
                </TableCell>
                <TableCell>
                  <ChoiceBadges choiceCourseIds={row.choiceCourseIds} coursesById={coursesById} />
                </TableCell>
                <TableCell className="text-right">{row.choiceCourseIds.length}</TableCell>
                <TableCell className="text-right">
                  <StudentRowActions planId={planId} row={row} edit={canEdit ? { onEdit, onDelete } : undefined} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function ChoiceBadges({
  choiceCourseIds,
  coursesById,
}: {
  choiceCourseIds: string[];
  coursesById: Map<string, CourseOption>;
}) {
  if (choiceCourseIds.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {choiceCourseIds.map((id) => {
        const course = coursesById.get(id);
        return (
          <Badge key={id} variant="outline">
            {course?.label ?? "Unknown course"}
          </Badge>
        );
      })}
    </div>
  );
}

/** The row menu's write items' handlers — absent for a caller who may not edit (S-405). */
type StudentRowEdits = {
  onEdit: (student: StudentRow) => void;
  onDelete: (student: StudentRow) => void;
};

/** Per-row kebab: "View plan" for everyone, then — only with `edit` — Edit and Delete. */
function StudentRowActions({ planId, row, edit }: { planId: string; row: StudentRow; edit?: StudentRowEdits }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Student actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild>
          <a href={studentViewHref(planId, row.id)}>View plan</a>
        </DropdownMenuItem>
        {edit && (
          <>
            <DropdownMenuItem
              onSelect={() => {
                edit.onEdit(row);
              }}
            >
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onSelect={() => {
                edit.onDelete(row);
              }}
            >
              Delete
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Master→detail entry: the name text links straight to the student's plan view. The
 * link's accessible name stays its text — an aria-label would replace it and change the
 * cell's accessible name out from under `getByRole` consumers.
 */
function StudentViewLink({ planId, row, children }: { planId: string; row: StudentRow; children: ReactNode }) {
  return (
    <a
      href={studentViewHref(planId, row.id)}
      className="hover:text-foreground decoration-muted-foreground/50 underline-offset-4 hover:underline"
    >
      {children}
    </a>
  );
}

function studentViewHref(planId: string, studentId: string): string {
  return `/plans/${planId}/students/${studentId}`;
}
