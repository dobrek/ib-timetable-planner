import { Plus } from "lucide-react";
import { Button } from "@/shared/ui";
import { Input } from "@/shared/ui";
import { Toaster } from "@/shared/ui";
import { filterTeachers } from "@/_pages/teachers/model/filter-teachers";
import type { YearFilter } from "@/_pages/teachers/model/filter-teachers";
import { useCatalogDialogs } from "@/_pages/teachers/model/use-catalog-dialogs";
import { useCatalogFilters } from "@/_pages/teachers/model/use-catalog-filters";
import type { TeacherRow } from "@/_pages/teachers/model/teacher";
import DeleteTeacherDialog from "./DeleteTeacherDialog";
import TeacherFormDialog from "./TeacherFormDialog";
import TeacherTable from "./TeacherTable";

type Props = {
  teachers: TeacherRow[];
  cohortIds: { y1: string; y2: string };
};

const YEAR_OPTIONS: { value: YearFilter; label: string }[] = [
  { value: "all", label: "All years" },
  { value: "y1", label: "Year 1" },
  { value: "y2", label: "Year 2" },
];

/**
 * Teacher catalog island: flat table with Y1/Y2 assignment columns, text+year filters,
 * and create/edit/delete via dialogs. Assignments are read-only (authored on /courses).
 */
export default function TeacherCatalog({ teachers, cohortIds }: Props) {
  const filters = useCatalogFilters();
  const dialogs = useCatalogDialogs();
  const rows = filterTeachers(teachers, filters.query, filters.year, cohortIds);

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
        <div className="flex items-center gap-1" role="group" aria-label="Filter by year">
          {YEAR_OPTIONS.map((option) => (
            <Button
              key={option.value}
              variant={filters.year === option.value ? "default" : "outline"}
              size="sm"
              aria-pressed={filters.year === option.value}
              onClick={() => {
                filters.setYear(option.value);
              }}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>

      <TeacherTable
        rows={rows}
        totalCount={teachers.length}
        cohortIds={cohortIds}
        onEdit={dialogs.openEdit}
        onDelete={dialogs.openDelete}
        onCreateFirst={dialogs.openCreate}
      />

      <TeacherFormDialog open={dialogs.formOpen} onClose={dialogs.closeForm} teacher={dialogs.formTeacher} />
      <DeleteTeacherDialog teacher={dialogs.deleteTarget} onClose={dialogs.closeDelete} />
      <Toaster />
    </div>
  );
}
