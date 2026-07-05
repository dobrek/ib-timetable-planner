import { Plus } from "lucide-react";
import { COHORTS } from "@/shared/config";
import { Button, Input, Tabs, TabsList, TabsTrigger, Toaster } from "@/shared/ui";
import { filterTeachers, type CohortFilter } from "../model/filter-teachers";
import { useCatalogDialogs } from "../model/use-catalog-dialogs";
import { useCatalogFilters } from "../model/use-catalog-filters";
import type { TeacherRow } from "../model/teacher";
import DeleteTeacherDialog from "./DeleteTeacherDialog";
import TeacherAvailabilityDialog from "./TeacherAvailabilityDialog";
import TeacherFormDialog from "./TeacherFormDialog";
import TeacherTable from "./TeacherTable";

type Props = {
  planId: string;
  teachers: TeacherRow[];
  /** The plan's grid dimensions — sizes the availability authoring grid. */
  days: number;
  periods: number;
};

/**
 * Teacher catalog island for one plan: flat table with DP1/DP2 assignment columns,
 * text+cohort filters, and create/edit/delete + availability via dialogs. Assignments are
 * read-only (authored on the plan's courses page).
 */
export default function TeacherCatalog({ planId, teachers, days, periods }: Props) {
  const filters = useCatalogFilters();
  const dialogs = useCatalogDialogs();
  const rows = filterTeachers(teachers, filters.query, filters.cohort);

  const cohortOptions: { value: CohortFilter; label: string }[] = [
    { value: "all", label: "All cohorts" },
    ...COHORTS.map((cohort) => ({ value: cohort.value, label: cohort.label })),
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Teachers</h1>
          <p className="text-muted-foreground mt-1 text-sm">Manage teachers and view course assignments.</p>
        </div>
        <Button className="gap-2" onClick={dialogs.openCreate}>
          <Plus aria-hidden="true" />
          New teacher
        </Button>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="search"
          placeholder="Search by code, name, or course…"
          value={filters.query}
          onChange={(event) => {
            filters.setQuery(event.target.value);
          }}
          className="max-w-sm"
          aria-label="Search teachers"
        />
        <Tabs
          value={filters.cohort}
          onValueChange={(value) => {
            filters.setCohort(value as CohortFilter);
          }}
        >
          <TabsList>
            {cohortOptions.map((cohort) => (
              <TabsTrigger key={cohort.value} value={cohort.value}>
                {cohort.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <TeacherTable
        planId={planId}
        rows={rows}
        totalCount={teachers.length}
        cohortFilter={filters.cohort}
        onEdit={dialogs.openEdit}
        onDelete={dialogs.openDelete}
        onEditAvailability={dialogs.openAvailability}
        onCreateFirst={dialogs.openCreate}
      />

      <TeacherFormDialog
        open={dialogs.formOpen}
        onClose={dialogs.closeForm}
        planId={planId}
        teacher={dialogs.formTeacher}
      />
      <DeleteTeacherDialog planId={planId} teacher={dialogs.deleteTarget} onClose={dialogs.closeDelete} />
      <TeacherAvailabilityDialog
        teacher={dialogs.availabilityTarget}
        planId={planId}
        days={days}
        periods={periods}
        onClose={dialogs.closeAvailability}
      />
      <Toaster />
    </div>
  );
}
