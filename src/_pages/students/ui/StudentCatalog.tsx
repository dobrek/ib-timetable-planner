import { Plus } from "lucide-react";
import { useMemo } from "react";
import type { CohortOption } from "@/shared/api";
import { Button, Input, Tabs, TabsContent, TabsList, TabsTrigger, Toaster } from "@/shared/ui";
import { filterStudents } from "../model/filter-students";
import { useCatalogDialogs } from "../model/use-catalog-dialogs";
import { useCatalogFilters } from "../model/use-catalog-filters";
import type { CourseOption, StudentRow } from "../model/student";
import DeleteStudentDialog from "./DeleteStudentDialog";
import StudentFormDialog from "./StudentFormDialog";
import StudentTable from "./StudentTable";

type Props = {
  students: StudentRow[];
  /** Ordered cohorts ("Year 1" first); rendered as tabs. */
  cohorts: CohortOption[];
  courses: CourseOption[];
};

/**
 * Students catalog island: students partitioned by cohort tabs with their course choices
 * as badge chips, a name search, and create/edit/delete via dialogs. The active tab seeds
 * the create form's default cohort.
 */
export default function StudentCatalog({ students, cohorts, courses }: Props) {
  const filters = useCatalogFilters(cohorts);
  const dialogs = useCatalogDialogs();
  const coursesById = useMemo(() => new Map(courses.map((course) => [course.id, course])), [courses]);

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
      </div>

      <Tabs value={filters.activeCohortId} onValueChange={filters.setActiveCohortId}>
        <TabsList>
          {cohorts.map((cohort) => (
            <TabsTrigger key={cohort.id} value={cohort.id}>
              {cohort.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {cohorts.map((cohort) => {
          const rows = filterStudents(students, cohort.id, filters.query);
          const cohortTotal = students.filter((student) => student.cohortId === cohort.id).length;
          return (
            <TabsContent key={cohort.id} value={cohort.id}>
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
        student={dialogs.formStudent}
        cohorts={cohorts}
        courses={courses}
        defaultCohortId={filters.activeCohortId}
      />
      <DeleteStudentDialog student={dialogs.deleteTarget} onClose={dialogs.closeDelete} />
      <Toaster />
    </div>
  );
}
