import { formatAssignmentBadgeLabel } from "@/_pages/teachers/lib/labels";
import type { CourseAssignment, TeacherRow } from "@/_pages/teachers/model/teacher";
import {
  Badge,
  Button,
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
import { MoreHorizontal, Plus } from "lucide-react";

type Props = {
  rows: TeacherRow[];
  totalCount: number;
  cohortIds: { y1: string; y2: string };
  onEdit: (teacher: TeacherRow) => void;
  onDelete: (teacher: TeacherRow) => void;
  onCreateFirst: () => void;
};

export default function TeacherTable({ rows, totalCount, cohortIds, onEdit, onDelete, onCreateFirst }: Props) {
  if (totalCount === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground text-sm">No teachers yet — create your first teacher.</p>
        <Button className="mt-4 gap-2" onClick={onCreateFirst}>
          <Plus aria-hidden="true" />
          New teacher
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No teachers match the current filter.</p>;
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead>Y1 Courses</TableHead>
            <TableHead className="text-right">Y1h</TableHead>
            <TableHead>Y2 Courses</TableHead>
            <TableHead className="text-right">Y2h</TableHead>
            <TableHead className="text-right">Total</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortTeachers(rows).map((row) => {
            const y1h = cohortHours(row.assignments, cohortIds.y1);
            const y2h = cohortHours(row.assignments, cohortIds.y2);

            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.code}</TableCell>
                <TableCell>{row.fullName ?? "—"}</TableCell>
                <TableCell>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, cohortIds.y1)} />
                </TableCell>
                <TableCell className="text-right">{y1h}</TableCell>
                <TableCell>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, cohortIds.y2)} />
                </TableCell>
                <TableCell className="text-right">{y2h}</TableCell>
                <TableCell className="text-right">{y1h + y2h}</TableCell>
                <TableCell className="text-right">
                  <TeacherRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}

function AssignmentBadges({ assignments }: { assignments: CourseAssignment[] }) {
  if (assignments.length === 0) return <span className="text-muted-foreground">—</span>;

  return (
    <div className="flex flex-wrap gap-1">
      {assignments.map((assignment) => (
        <Badge key={assignment.id} variant="secondary">
          {formatAssignmentBadgeLabel(assignment)}
        </Badge>
      ))}
    </div>
  );
}

function TeacherRowActions({
  row,
  onEdit,
  onDelete,
}: {
  row: TeacherRow;
  onEdit: (teacher: TeacherRow) => void;
  onDelete: (teacher: TeacherRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Teacher actions">
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            onEdit(row);
          }}
        >
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            onDelete(row);
          }}
        >
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function sortTeachers(rows: readonly TeacherRow[]): TeacherRow[] {
  return [...rows].sort((a, b) => {
    const nameA = a.fullName?.toLowerCase() ?? "\uffff";
    const nameB = b.fullName?.toLowerCase() ?? "\uffff";
    if (nameA !== nameB) return nameA.localeCompare(nameB);
    return a.code.localeCompare(b.code);
  });
}

function cohortHours(assignments: readonly CourseAssignment[], cohortId: string): number {
  return assignments.filter((a) => a.cohortId === cohortId).reduce((sum, a) => sum + a.hours, 0);
}

function cohortAssignments(assignments: readonly CourseAssignment[], cohortId: string): CourseAssignment[] {
  return assignments.filter((a) => a.cohortId === cohortId);
}
