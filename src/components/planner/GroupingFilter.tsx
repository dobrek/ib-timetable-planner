import { useMemo } from "react";
import type { PlannerGrouping } from "@/components/planner/types";
import { cn } from "@/lib/utils";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  value: string | null;
  onChange: (courseId: string | null) => void;
};

/**
 * Leading-course filter: pick a course and the palette shows only groupings whose
 * member set contains it (membership filter — no seed data needed). The option list
 * is the distinct set of courses that appear in at least one grouping, so every
 * choice narrows to something. Clearing returns all groupings.
 */
export default function GroupingFilter({ groupings, names, value, onChange }: Props) {
  const courses = useMemo(() => leadingCourseOptions(groupings, names), [groupings, names]);

  return (
    <label className="flex flex-col gap-1 text-sm" data-slot="grouping-filter">
      <span className="text-muted-foreground font-medium">Leading course</span>
      <select
        className={cn(
          "bg-background h-9 rounded-md border px-3 text-sm shadow-xs outline-none",
          "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
        )}
        value={value ?? ""}
        onChange={(event) => {
          onChange(event.target.value || null);
        }}
      >
        <option value="">All groupings</option>
        {courses.map((course) => (
          <option key={course.id} value={course.id}>
            {course.name}
          </option>
        ))}
      </select>
    </label>
  );
}

const leadingCourseOptions = (
  groupings: PlannerGrouping[],
  names: Record<string, string>,
): { id: string; name: string }[] => {
  const ids = new Set(groupings.flatMap((grouping) => grouping.memberIds));
  return [...ids].map((id) => ({ id, name: names[id] ?? id })).sort((a, b) => a.name.localeCompare(b.name));
};
