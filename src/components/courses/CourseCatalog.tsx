import { useState } from "react";
import { MoreHorizontal, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Toaster } from "@/components/ui/sonner";
import CourseFormDialog from "@/components/courses/CourseFormDialog";
import DeleteCourseDialog from "@/components/courses/DeleteCourseDialog";
import { TeacherFilter } from "@/components/courses/TeacherFilter";
import { filterCourses } from "@/components/courses/useCourseFilters";
import type { CohortTab, CourseRow, TeacherOption } from "@/components/courses/types";

type CourseCatalogProps = {
  cohorts: CohortTab[];
  courses: CourseRow[];
  teachers: TeacherOption[];
};

/** IB group index → display label. 0 is the "none" sentinel. */
const GROUP_LABELS: Record<number, string> = { 0: "—", 1: "Group 1", 2: "Group 2", 3: "Group 3" };

/**
 * Catalog island: cross-cohort course list as Year 1 / Year 2 tabs with a teacher
 * multi-select filter, plus create/edit/delete via dialogs (overlap authoring lands in
 * Phase 4). Composite merge parents carry a "Merged" badge beside the name but remain
 * fully editable (merge-specific constraints are deferred to the merge-builder slice).
 * Tokens only (lessons rule #2).
 */
export default function CourseCatalog({ cohorts, courses, teachers }: CourseCatalogProps) {
  const [activeCohortId, setActiveCohortId] = useState(cohorts[0]?.id ?? "");
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [formState, setFormState] = useState<{ open: boolean; course: CourseRow | null }>({
    open: false,
    course: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<CourseRow | null>(null);

  const openCreate = () => {
    setFormState({ open: true, course: null });
  };
  const openEdit = (course: CourseRow) => {
    setFormState({ open: true, course });
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Courses</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage the cross-cohort course catalog.</p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus aria-hidden="true" />
          New course
        </Button>
      </header>

      <TeacherFilter teachers={teachers} selectedIds={selectedTeacherIds} onChange={setSelectedTeacherIds} />

      <Tabs value={activeCohortId} onValueChange={setActiveCohortId}>
        <TabsList>
          {cohorts.map((cohort) => (
            <TabsTrigger key={cohort.id} value={cohort.id}>
              {cohort.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {cohorts.map((cohort) => {
          const rows = filterCourses(courses, cohort.id, selectedTeacherIds);
          return (
            <TabsContent key={cohort.id} value={cohort.id}>
              <CourseTable rows={rows} onEdit={openEdit} onDelete={setDeleteTarget} />
            </TabsContent>
          );
        })}
      </Tabs>

      <CourseFormDialog
        open={formState.open}
        onOpenChange={(open) => {
          setFormState((state) => ({ ...state, open }));
        }}
        cohorts={cohorts}
        teachers={teachers}
        course={formState.course}
        defaultCohortId={activeCohortId}
      />
      <DeleteCourseDialog
        course={deleteTarget}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      />
      <Toaster />
    </div>
  );
}

type CourseTableProps = {
  rows: CourseRow[];
  onEdit: (course: CourseRow) => void;
  onDelete: (course: CourseRow) => void;
};

function CourseTable({ rows, onEdit, onDelete }: CourseTableProps) {
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
                <span className="flex items-center gap-2">
                  {row.name}
                  {row.isMerged && <Badge variant="secondary">Merged</Badge>}
                </span>
              </TableCell>
              <TableCell>{row.level === "none" ? "—" : row.level}</TableCell>
              <TableCell>{GROUP_LABELS[row.groupIndex] ?? row.groupIndex}</TableCell>
              <TableCell className="text-right">{row.hours}</TableCell>
              <TableCell>{row.teacherLabel ?? "—"}</TableCell>
              <TableCell className="text-right">
                <CourseRowActions row={row} onEdit={onEdit} onDelete={onDelete} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

type CourseRowActionsProps = {
  row: CourseRow;
  onEdit: (course: CourseRow) => void;
  onDelete: (course: CourseRow) => void;
};

/** Per-row kebab — present on every course. "Manage overlaps" is wired in Phase 4. */
function CourseRowActions({ row, onEdit, onDelete }: CourseRowActionsProps) {
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
        <DropdownMenuItem disabled>Manage overlaps</DropdownMenuItem>
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
