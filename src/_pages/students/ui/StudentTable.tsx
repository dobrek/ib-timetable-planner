import { MoreHorizontal, Plus } from "lucide-react";
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
import type { CourseOption, StudentRow } from "../model/student";

type Props = {
  rows: StudentRow[];
  totalCount: number;
  coursesById: Map<string, CourseOption>;
  onEdit: (student: StudentRow) => void;
  onDelete: (student: StudentRow) => void;
  onCreateFirst: () => void;
};

export default function StudentTable({ rows, totalCount, coursesById, onEdit, onDelete, onCreateFirst }: Props) {
  if (totalCount === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-muted-foreground text-sm">No students yet — create your first student.</p>
        <Button className="mt-4 gap-2" onClick={onCreateFirst}>
          <Plus aria-hidden="true" />
          New student
        </Button>
      </div>
    );
  }

  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No students match the current filter.</p>;
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Choices</TableHead>
            <TableHead className="text-right">#</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">{row.fullName}</TableCell>
              <TableCell>
                <ChoiceBadges choiceCourseIds={row.choiceCourseIds} coursesById={coursesById} />
              </TableCell>
              <TableCell className="text-right">{row.choiceCourseIds.length}</TableCell>
              <TableCell className="text-right">
                <StudentRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))}
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

function StudentRowActions({
  row,
  onEdit,
  onDelete,
}: {
  row: StudentRow;
  onEdit: (student: StudentRow) => void;
  onDelete: (student: StudentRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Student actions">
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
