import { ListFilter } from "lucide-react";
import { Badge, Button, MultiSelect } from "@/shared/ui";
import type { CourseOption } from "../model/student";

type Props = {
  /** The active cohort's non-merge-parent courses (computed by the catalog). */
  courses: CourseOption[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
};

/**
 * Searchable multi-select over the active cohort's courses. Empty selection = show all;
 * otherwise keep students who chose any selected course. Selected courses appear as
 * removable badge chips beside the trigger. Page-level (not modal) so it never locks scroll.
 */
export default function CourseFilter({ courses, selectedIds, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect
        items={courses}
        selectedIds={selectedIds}
        onChange={onChange}
        trigger={
          <>
            <ListFilter aria-hidden="true" />
            Course
            {selectedIds.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {selectedIds.length}
              </Badge>
            )}
          </>
        }
        triggerSize="sm"
        triggerClassName="gap-2"
        searchPlaceholder="Search courses…"
        emptyText="No courses found."
      />

      {selectedIds.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange([]);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
