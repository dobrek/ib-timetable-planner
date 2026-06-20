import { Combine, Plus } from "lucide-react";
import { useState } from "react";
import { COHORTS, type Cohort } from "@/shared/config";
import { Button, Tabs, TabsContent, TabsList, TabsTrigger, Toaster } from "@/shared/ui";
import type { CourseRow, TeacherOption } from "../model/course";
import { filterCourses } from "../model/filter-courses";
import { useCatalogDialogs } from "../model/use-catalog-dialogs";
import { useCatalogFilters } from "../model/use-catalog-filters";
import CourseFormDialog from "./CourseFormDialog";
import CourseOverlaps from "./CourseOverlaps";
import CourseTable from "./CourseTable";
import DeleteCourseDialog from "./DeleteCourseDialog";
import MergeBuilderDialog from "./MergeBuilderDialog";
import MergeManageDialog from "./MergeManageDialog";
import TeacherFilter from "./TeacherFilter";

type Props = {
  planId: string;
  courses: CourseRow[];
  teachers: TeacherOption[];
};

/**
 * Catalog island for one plan: cross-cohort course list as DP1 / DP2 tabs with a
 * teacher multi-select filter, a hide-merged toggle, plus create/edit/delete and overlap
 * authoring via dialogs. Composite merge parents carry a "Merged" badge beside the name
 * but remain fully editable. Overlap edits update in-memory so the catalog stays live
 * without a page reload.
 */
export default function CourseCatalog({ planId, courses: initialCourses, teachers }: Props) {
  const [courses, setCourses] = useState(initialCourses);
  const filters = useCatalogFilters(teachers);
  const dialogs = useCatalogDialogs(courses, setCourses);

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Courses</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage the plan&apos;s cross-cohort course catalog.</p>
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
            filters.setHideMerged(!filters.hideMerged);
          }}
        >
          Hide merged
        </Button>
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
          const rows = filterCourses(courses, cohort.value, filters.selectedTeacherIds, filters.hideMerged);
          return (
            <TabsContent key={cohort.value} value={cohort.value}>
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
        onClose={dialogs.closeForm}
        planId={planId}
        teachers={teachers}
        course={dialogs.formCourse}
        defaultCohort={filters.activeCohort}
      />
      <DeleteCourseDialog planId={planId} course={dialogs.deleteTarget} onClose={dialogs.closeDelete} />
      <CourseOverlaps
        planId={planId}
        course={dialogs.overlapCourse}
        courses={courses}
        coursesById={dialogs.coursesById}
        onOverlapsChange={dialogs.updateOverlaps}
        onClose={dialogs.closeOverlaps}
      />
      <MergeBuilderDialog
        open={dialogs.mergeOpen}
        onClose={dialogs.closeMergeBuilder}
        planId={planId}
        courses={courses}
        coursesById={dialogs.coursesById}
        teachers={teachers}
        cohort={filters.activeCohort}
      />
      <MergeManageDialog
        planId={planId}
        course={dialogs.mergeManageCourse}
        coursesById={dialogs.coursesById}
        onClose={dialogs.closeMergeManage}
      />
      <Toaster />
    </div>
  );
}
