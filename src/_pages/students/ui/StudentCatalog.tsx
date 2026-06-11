import { Plus } from "lucide-react";
import { useMemo } from "react";
import { COHORTS, type Cohort } from "@/shared/config";
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, Toaster } from "@/shared/ui";
import { filterStudents } from "../model/filter-students";
import { useCatalogDialogs } from "../model/use-catalog-dialogs";
import { useCatalogFilters } from "../model/use-catalog-filters";
import type { CourseOption, StudentRow } from "../model/student";
import CourseFilter from "./CourseFilter";
import DeleteStudentDialog from "./DeleteStudentDialog";
import StudentFormDialog from "./StudentFormDialog";
import StudentTable from "./StudentTable";

type Props = {
  planId: string;
  students: StudentRow[];
  courses: CourseOption[];
};

/**
 * Students catalog island for one plan: students partitioned by cohort tabs with their
 * course choices as badge chips, a name search, and create/edit/delete via dialogs. The
 * active tab seeds the create form's default cohort.
 */
export default function StudentCatalog({ planId, students, courses }: Props) {
  const filters = useCatalogFilters(courses);
  const dialogs = useCatalogDialogs();
  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);
  // The course filter offers only the active cohort's real (non-merge-parent) courses.
  const filterCourses = useMemo(
    () => courses.filter((course) => course.cohort === filters.activeCohort && !course.isMergeParent),
    [courses, filters.activeCohort],
  );

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Students</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage students and their course choices.</p>
        </div>
        <Button className="gap-2" onClick={dialogs.openCreate}>
          <Plus aria-hidden="true" />
          New student
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search by name…"
          value={filters.query}
          onChange={(event) => {
            filters.setQuery(event.target.value);
          }}
          className="max-w-sm"
          aria-label="Search students"
        />
        <CourseFilter
          courses={filterCourses}
          selectedIds={filters.selectedCourseIds}
          onChange={filters.setSelectedCourseIds}
        />
      </div>

      <Tabs
        value={filters.activeCohort}
        onValueChange={(value) => {
          filters.setActiveCohort(value as Cohort);
        }}
      >
        <TabsList>
          {COHORTS.map((cohort) => (
            <TabsTrigger key={cohort.value} value={cohort.value}>
              {cohort.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {COHORTS.map((cohort) => {
          const rows = filterStudents(students, cohort.value, filters.query, filters.selectedCourseIds);
          const cohortTotal = students.filter((student) => student.cohort === cohort.value).length;
          return (
            <TabsContent key={cohort.value} value={cohort.value}>
              <StudentTable
                rows={rows}
                totalCount={cohortTotal}
                coursesById={coursesById}
                onEdit={dialogs.openEdit}
                onDelete={dialogs.openDelete}
                onCreateFirst={dialogs.openCreate}
              />
            </TabsContent>
          );
        })}
      </Tabs>

      <StudentFormDialog
        open={dialogs.formOpen}
        onClose={dialogs.closeForm}
        planId={planId}
        student={dialogs.formStudent}
        courses={courses}
        defaultCohort={filters.activeCohort}
      />
      <DeleteStudentDialog planId={planId} student={dialogs.deleteTarget} onClose={dialogs.closeDelete} />
      <Toaster />
    </div>
  );
}
