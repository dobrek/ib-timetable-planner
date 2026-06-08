import { useMemo, useState } from "react";
import { Link2, MoreHorizontal, Plus } from "lucide-react";
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
import CourseOverlaps from "@/components/courses/CourseOverlaps";
import DeleteCourseDialog from "@/components/courses/DeleteCourseDialog";
import { TeacherFilter } from "@/components/courses/TeacherFilter";
import { formatCourseLabel } from "@/components/courses/labels";
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
 * multi-select filter, a hide-merged toggle, plus create/edit/delete and overlap
 * authoring via dialogs. Composite merge parents carry a "Merged" badge beside the name
 * but remain fully editable (merge-specific constraints are deferred to the merge-builder
 * slice). Overlap edits update in-memory so the catalog stays live without a page reload.
 * Tokens only (lessons rule #2).
 */
export default function CourseCatalog({ cohorts, courses: initialCourses, teachers }: CourseCatalogProps) {
  // Local copy so overlap add/remove reflect immediately (no full-page refresh). Create/
  // edit/delete still navigate() to re-run the server load, which re-seeds this state.
  const [courses, setCourses] = useState(initialCourses);
  const [activeCohortId, setActiveCohortId] = useState(cohorts[0]?.id ?? "");
  const [selectedTeacherIds, setSelectedTeacherIds] = useState<string[]>([]);
  const [hideMerged, setHideMerged] = useState(false);
  const [formState, setFormState] = useState<{ open: boolean; course: CourseRow | null }>({
    open: false,
    course: null,
  });
  const [deleteTarget, setDeleteTarget] = useState<CourseRow | null>(null);
  const [overlapTargetId, setOverlapTargetId] = useState<string | null>(null);

  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  const overlapCourse = overlapTargetId !== null ? (coursesById.get(overlapTargetId) ?? null) : null;

  const openCreate = () => {
    setFormState({ open: true, course: null });
  };
  const openEdit = (course: CourseRow) => {
    setFormState({ open: true, course });
  };
  const updateOverlaps = (courseId: string, nextOverlaps: string[]) => {
    setCourses((current) =>
      current.map((course) => (course.id === courseId ? { ...course, overlaps: nextOverlaps } : course)),
    );
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

      <div className="flex flex-wrap items-center gap-2">
        <TeacherFilter teachers={teachers} selectedIds={selectedTeacherIds} onChange={setSelectedTeacherIds} />
        <Button
          variant={hideMerged ? "default" : "outline"}
          size="sm"
          aria-pressed={hideMerged}
          onClick={() => {
            setHideMerged((value) => !value);
          }}
        >
          Hide merged
        </Button>
      </div>

      <Tabs value={activeCohortId} onValueChange={setActiveCohortId}>
        <TabsList>
          {cohorts.map((cohort) => (
            <TabsTrigger key={cohort.id} value={cohort.id}>
              {cohort.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {cohorts.map((cohort) => {
          const rows = filterCourses(courses, cohort.id, selectedTeacherIds, hideMerged);
          return (
            <TabsContent key={cohort.id} value={cohort.id}>
              <CourseTable
                rows={rows}
                coursesById={coursesById}
                onEdit={openEdit}
                onManageOverlaps={(course) => {
                  setOverlapTargetId(course.id);
                }}
                onDelete={setDeleteTarget}
              />
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
      <CourseOverlaps
        course={overlapCourse}
        courses={courses}
        onOverlapsChange={updateOverlaps}
        onOpenChange={(open) => {
          if (!open) setOverlapTargetId(null);
        }}
      />
      <Toaster />
    </div>
  );
}

type CourseTableProps = {
  rows: CourseRow[];
  coursesById: Map<string, CourseRow>;
  onEdit: (course: CourseRow) => void;
  onManageOverlaps: (course: CourseRow) => void;
  onDelete: (course: CourseRow) => void;
};

function CourseTable({ rows, coursesById, onEdit, onManageOverlaps, onDelete }: CourseTableProps) {
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
              <TableCell>{row.level === "none" ? "—" : row.level}</TableCell>
              <TableCell>{GROUP_LABELS[row.groupIndex] ?? row.groupIndex}</TableCell>
              <TableCell className="text-right">{row.hours}</TableCell>
              <TableCell>{row.teacherLabel ?? "—"}</TableCell>
              <TableCell className="text-right">
                <CourseRowActions row={row} onEdit={onEdit} onManageOverlaps={onManageOverlaps} onDelete={onDelete} />
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
  onEdit: (course: CourseRow) => void;
  onManageOverlaps: (course: CourseRow) => void;
  onDelete: (course: CourseRow) => void;
};

/** Per-row kebab — present on every course. */
function CourseRowActions({ row, onEdit, onManageOverlaps, onDelete }: CourseRowActionsProps) {
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
