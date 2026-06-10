import type { CohortTab, CourseRow, TeacherOption } from "@/_pages/courses/model/course";
import { filterCourses } from "@/_pages/courses/model/filter-courses";
import { useCatalogDialogs } from "@/_pages/courses/model/use-catalog-dialogs";
import { useCatalogFilters } from "@/_pages/courses/model/use-catalog-filters";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Toaster } from "@/shared/ui";
import { Combine, Plus } from "lucide-react";
import { useState } from "react";
import CourseFormDialog from "./CourseFormDialog";
import CourseOverlaps from "./CourseOverlaps";
import CourseTable from "./CourseTable";
import DeleteCourseDialog from "./DeleteCourseDialog";
import MergeBuilderDialog from "./MergeBuilderDialog";
import MergeManageDialog from "./MergeManageDialog";
import TeacherFilter from "./TeacherFilter";

type Props = {
  cohorts: CohortTab[];
  courses: CourseRow[];
  teachers: TeacherOption[];
};

/**
 * Catalog island: cross-cohort course list as Year 1 / Year 2 tabs with a teacher
 * multi-select filter, a hide-merged toggle, plus create/edit/delete and overlap
 * authoring via dialogs. Composite merge parents carry a "Merged" badge beside the name
 * but remain fully editable (merge-specific constraints are deferred to the merge-builder
 * slice). Overlap edits update in-memory so the catalog stays live without a page reload.
 * Tokens only (lessons rule #2).
 */
export default function CourseCatalog({ cohorts, courses: initialCourses, teachers }: Props) {
  const [courses, setCourses] = useState(initialCourses);
  const filters = useCatalogFilters(cohorts, teachers);
  const dialogs = useCatalogDialogs(courses, setCourses);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Courses</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage the cross-cohort course catalog.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" className="gap-2" onClick={dialogs.openMergeBuilder}>
            <Combine aria-hidden="true" />
            New merge
          </Button>
          <Button className="gap-2" onClick={dialogs.openCreate}>
            <Plus aria-hidden="true" />
            New course
          </Button>
        </div>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <TeacherFilter
          teachers={teachers}
          selectedIds={filters.selectedTeacherIds}
          onChange={filters.setSelectedTeacherIds}
        />
        <Button
          variant={filters.hideMerged ? "default" : "outline"}
          size="sm"
          aria-pressed={filters.hideMerged}
          onClick={() => {
            filters.setHideMerged((value) => !value);
          }}
        >
          Hide merged
        </Button>
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
          const rows = filterCourses(courses, cohort.id, filters.selectedTeacherIds, filters.hideMerged);
          return (
            <TabsContent key={cohort.id} value={cohort.id}>
              <CourseTable
                rows={rows}
                coursesById={dialogs.coursesById}
                onEdit={dialogs.openEdit}
                onManageOverlaps={dialogs.openOverlaps}
                onManageMerge={dialogs.openMergeManage}
                onDelete={dialogs.openDelete}
              />
            </TabsContent>
          );
        })}
      </Tabs>

      <CourseFormDialog
        open={dialogs.formOpen}
        onOpenChange={(open) => {
          if (!open) dialogs.closeForm();
        }}
        cohorts={cohorts}
        teachers={teachers}
        course={dialogs.formCourse}
        defaultCohortId={filters.activeCohortId}
      />
      <DeleteCourseDialog
        course={dialogs.deleteTarget}
        onOpenChange={(open) => {
          if (!open) dialogs.closeDelete();
        }}
      />
      <CourseOverlaps
        course={dialogs.overlapCourse}
        courses={courses}
        coursesById={dialogs.coursesById}
        onOverlapsChange={dialogs.updateOverlaps}
        onOpenChange={(open) => {
          if (!open) dialogs.closeOverlaps();
        }}
      />
      <MergeBuilderDialog
        open={dialogs.mergeOpen}
        onOpenChange={(open) => {
          if (!open) dialogs.closeMergeBuilder();
        }}
        courses={courses}
        coursesById={dialogs.coursesById}
        teachers={teachers}
        cohortId={filters.activeCohortId}
      />
      <MergeManageDialog
        course={dialogs.mergeManageCourse}
        coursesById={dialogs.coursesById}
        onOpenChange={(open) => {
          if (!open) dialogs.closeMergeManage();
        }}
      />
      <Toaster />
    </div>
  );
}
