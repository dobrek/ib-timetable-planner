import { CalendarOff, MoreHorizontal, Plus } from "lucide-react";
import type { Cohort } from "@/shared/config";
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
import { formatCourseBadgeLabel } from "@/shared/lib/course-label";
import type { YearFilter } from "../model/filter-teachers";
import { sortTeachers } from "../model/sort-teachers";
import type { CourseAssignment, TeacherRow } from "../model/teacher";

type Props = {
  rows: TeacherRow[];
  totalCount: number;
  yearFilter: YearFilter;
  onEdit: (teacher: TeacherRow) => void;
  onDelete: (teacher: TeacherRow) => void;
  onEditAvailability: (teacher: TeacherRow) => void;
  onCreateFirst: () => void;
};

export default function TeacherTable({
  rows,
  totalCount,
  yearFilter,
  onEdit,
  onDelete,
  onEditAvailability,
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
            const y1h = cohortHours(row.assignments, "dp1");
            const y2h = cohortHours(row.assignments, "dp2");

            return (
              <TableRow key={row.id}>
                <TableCell className="font-medium">
                  <span className="flex items-center gap-2">
                    {row.code}
                    <AvailabilityBadge row={row} onEditAvailability={onEditAvailability} />
                  </span>
                </TableCell>
                <TableCell>{row.fullName ?? "—"}</TableCell>
                <TableCell className={cn(cohortGroupClass(yearFilter, "y1"))}>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, "dp1")} />
                </TableCell>
                <TableCell className={cn("text-right", cohortGroupClass(yearFilter, "y1"))}>{y1h}</TableCell>
                <TableCell className={cn(cohortGroupClass(yearFilter, "y2"))}>
                  <AssignmentBadges assignments={cohortAssignments(row.assignments, "dp2")} />
                </TableCell>
                <TableCell className={cn("text-right", cohortGroupClass(yearFilter, "y2"))}>{y2h}</TableCell>
                <TableCell className={cn("text-right", totalColumnClass(yearFilter))}>{y1h + y2h}</TableCell>
                <TableCell className="text-right">
                  <TeacherRowActions
                    row={row}
                    onEdit={onEdit}
                    onDelete={onDelete}
                    onEditAvailability={onEditAvailability}
                  />
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
          {formatCourseBadgeLabel(assignment)}
        </Badge>
      ))}
    </div>
  );
}

function TeacherRowActions({
  row,
  onEdit,
  onDelete,
  onEditAvailability,
}: {
  row: TeacherRow;
  onEdit: (teacher: TeacherRow) => void;
  onDelete: (teacher: TeacherRow) => void;
  onEditAvailability: (teacher: TeacherRow) => void;
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
          onSelect={() => {
            onEditAvailability(row);
          }}
        >
          Edit availability
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

/**
 * At-a-glance signal that a teacher carries availability constraints, with the constrained-
 * cell count. Modeled on the clickable `OverlapBadge` — clicking opens the availability
 * dialog. Deliberately neutral (no destructive/warning coloring): a presence/shortcut
 * affordance, not a severity signal — the strong/soft breakdown lives in the dialog.
 */
function AvailabilityBadge({
  row,
  onEditAvailability,
}: {
  row: TeacherRow;
  onEditAvailability: (teacher: TeacherRow) => void;
}) {
  if (row.availability.length === 0) return null;
  return (
    <Badge
      asChild
      variant="outline"
      className="hover:bg-accent hover:text-accent-foreground cursor-pointer gap-1 font-normal"
    >
      <button
        type="button"
        onClick={() => {
          onEditAvailability(row);
        }}
        aria-label={`Edit availability for ${row.fullName ?? row.code} (${row.availability.length} constrained cells)`}
      >
        <CalendarOff className="size-3" aria-hidden="true" />
        {row.availability.length}
      </button>
    </Badge>
  );
}

function cohortGroupClass(yearFilter: YearFilter, cohort: "y1" | "y2") {
  if (yearFilter === "all" || yearFilter === cohort) return undefined;
  return "opacity-40";
}

function totalColumnClass(yearFilter: YearFilter) {
  return yearFilter === "all" ? undefined : "opacity-60";
}

function cohortHours(assignments: readonly CourseAssignment[], cohort: Cohort): number {
  return cohortAssignments(assignments, cohort).reduce((sum, a) => sum + a.hours, 0);
}

function cohortAssignments(assignments: readonly CourseAssignment[], cohort: Cohort): CourseAssignment[] {
  return assignments.filter((a) => a.cohort === cohort);
}
