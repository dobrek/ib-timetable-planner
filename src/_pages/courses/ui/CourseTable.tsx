import { Link2, MoreHorizontal } from "lucide-react";
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
import { formatCourseLabel, formatGroupCell } from "../lib/labels";
import { LEVEL_NONE, type CourseRow } from "../model/course";

type Props = {
  rows: CourseRow[];
  coursesById: Map<string, CourseRow>;
  onEdit: (course: CourseRow) => void;
  onManageOverlaps: (course: CourseRow) => void;
  onManageMerge: (course: CourseRow) => void;
  onDelete: (course: CourseRow) => void;
};

export default function CourseTable({ rows, coursesById, onEdit, onManageOverlaps, onManageMerge, onDelete }: Props) {
  if (rows.length === 0) {
    return <p className="text-muted-foreground py-8 text-center text-sm">No courses match the current filter.</p>;
  }

  return (
    <div className="border-border overflow-hidden rounded-lg border">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Level</TableHead>
            <TableHead>Group</TableHead>
            <TableHead className="text-right">Hours</TableHead>
            <TableHead>Teacher</TableHead>
            <TableHead className="w-12" aria-label="Actions" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-medium">
                <span className="flex flex-wrap items-center gap-2">
                  {row.name}
                  {row.isMerged && <Badge variant="secondary">Merged</Badge>}
                  <OverlapBadge row={row} coursesById={coursesById} onManageOverlaps={onManageOverlaps} />
                </span>
              </TableCell>
              <TableCell>{row.level === LEVEL_NONE ? "—" : row.level}</TableCell>
              <TableCell>{formatGroupCell(row.groupIndex)}</TableCell>
              <TableCell className="text-right">{row.hours}</TableCell>
              <TableCell>{row.teacherLabel ?? "—"}</TableCell>
              <TableCell className="text-right">
                <CourseRowActions
                  row={row}
                  onEdit={onEdit}
                  onManageOverlaps={onManageOverlaps}
                  onManageMerge={onManageMerge}
                  onDelete={onDelete}
                />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/**
 * Names the base course(s) this course's students also attend; hidden when there are none.
 * Clicking opens the overlap manager for the row.
 */
function OverlapBadge({
  row,
  coursesById,
  onManageOverlaps,
}: {
  row: CourseRow;
  coursesById: Map<string, CourseRow>;
  onManageOverlaps: (course: CourseRow) => void;
}) {
  if (row.overlaps.length === 0) return null;
  const labels = row.overlaps.map((id) => {
    const base = coursesById.get(id);
    return base ? formatCourseLabel(base) : "Unknown course";
  });
  return (
    <Badge
      asChild
      variant="outline"
      className="hover:bg-accent hover:text-accent-foreground cursor-pointer gap-1 font-normal"
    >
      <button
        type="button"
        onClick={() => {
          onManageOverlaps(row);
        }}
        aria-label={`Manage overlaps for ${row.name}`}
      >
        <Link2 className="size-3" aria-hidden="true" />
        Overlap: {labels.join(", ")}
      </button>
    </Badge>
  );
}

type CourseRowActionsProps = {
  row: CourseRow;
} & Pick<Props, "onEdit" | "onManageOverlaps" | "onManageMerge" | "onDelete">;

/** Per-row kebab — present on every course. "Manage merge" shows only on composite parents. */
function CourseRowActions({ row, onEdit, onManageOverlaps, onManageMerge, onDelete }: CourseRowActionsProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Course actions">
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
            onManageOverlaps(row);
          }}
        >
          Manage overlaps
        </DropdownMenuItem>
        {row.isMerged && (
          <DropdownMenuItem
            onSelect={() => {
              onManageMerge(row);
            }}
          >
            Manage merge
          </DropdownMenuItem>
        )}
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
