import { MoreHorizontal, Plus } from "lucide-react";
import { cn } from "@/shared/lib/cn";
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
import { formatAssignmentBadgeLabel } from "../lib/labels";
import type { YearFilter } from "../model/filter-teachers";
import { sortTeachers } from "../model/sort-teachers";
import type { CourseAssignment, TeacherRow } from "../model/teacher";

type Props = {
  rows: TeacherRow[];
  totalCount: number;
  /** Ordered cohorts; the table is structurally two-cohort (Y1/Y2 columns). */
  cohorts: readonly { id: string }[];
  yearFilter: YearFilter;
  onEdit: (teacher: TeacherRow) => void;
  onDelete: (teacher: TeacherRow) => void;
  onCreateFirst: () => void;
};

export default function TeacherTable({
  rows,
  totalCount,
  cohorts,
  yearFilter,
  onEdit,
  onDelete,
  onCreateFirst,
}: Props) {
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

  const y1Id = cohorts[0]?.id;
  const y2Id = cohorts[1]?.id;

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Code</TableHead>
            <TableHead>Name</TableHead>
            <TableHead className={cn(cohortGroupClass(yearFilter, "y1"))}>Year 1 - Courses</TableHead>
            <TableHead className={cn("text-right", cohortGroupClass(yearFilter, "y1"))}>h</TableHead>
            <TableHead className={cn(cohortGroupClass(yearFilter, "y2"))}>Year 2 - Courses</TableHead>
            <TableHead className={cn("text-right", cohortGroupClass(yearFilter, "y2"))}>h</TableHead>
            <TableHead className={cn("text-right", totalColumnClass(yearFilter))}>Total h</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortTeachers(rows).map((row) => {
            const y1h = cohortHours(row.assignments, y1Id);
            const y2h = cohortHours(row.assignments, y2Id);

            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">{row.code}</TableCell>
                <TableCell>{row.fullName ?? "—"}</TableCell>
                <TableCell className={cn(cohortGroupClass(yearFilter, "y1"))}>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, y1Id)} />
                </TableCell>
                <TableCell className={cn("text-right", cohortGroupClass(yearFilter, "y1"))}>{y1h}</TableCell>
                <TableCell className={cn(cohortGroupClass(yearFilter, "y2"))}>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, y2Id)} />
                </TableCell>
                <TableCell className={cn("text-right", cohortGroupClass(yearFilter, "y2"))}>{y2h}</TableCell>
                <TableCell className={cn("text-right", totalColumnClass(yearFilter))}>{y1h + y2h}</TableCell>
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
        <Badge key={assignment.id} variant="outline">
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

function cohortGroupClass(yearFilter: YearFilter, cohort: "y1" | "y2") {
  if (yearFilter === "all" || yearFilter === cohort) return undefined;
  return "opacity-40";
}

function totalColumnClass(yearFilter: YearFilter) {
  return yearFilter === "all" ? undefined : "opacity-60";
}

function cohortHours(assignments: readonly CourseAssignment[], cohortId: string | undefined): number {
  return cohortAssignments(assignments, cohortId).reduce((sum, a) => sum + a.hours, 0);
}

function cohortAssignments(assignments: readonly CourseAssignment[], cohortId: string | undefined): CourseAssignment[] {
  return assignments.filter((a) => a.cohortId === cohortId);
}
