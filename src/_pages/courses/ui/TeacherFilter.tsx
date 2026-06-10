import { ListFilter } from "lucide-react";
import { Badge, Button, MultiSelect } from "@/shared/ui";
import type { TeacherOption } from "../model/course";

type Props = {
  teachers: readonly TeacherOption[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
};

/**
 * Searchable multi-select over teachers. Empty selection = show all. Selected teachers
 * appear as removable badge chips beside the trigger.
 */
export default function TeacherFilter({ teachers, selectedIds, onChange }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <MultiSelect
        items={teachers}
        selectedIds={selectedIds}
        onChange={onChange}
        trigger={
          <>
            <ListFilter aria-hidden="true" />
            Teacher
            {selectedIds.length > 0 && (
              <Badge variant="secondary" className="ml-1">
                {selectedIds.length}
              </Badge>
            )}
          </>
        }
        triggerSize="sm"
        triggerClassName="gap-2"
        searchPlaceholder="Search teachers…"
        emptyText="No teachers found."
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
