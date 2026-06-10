import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui";
import type { PlannerGrouping } from "@/_pages/plan-detail/model/grouping";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  value: string | null;
  onChange: (courseId: string | null) => void;
};

/** Sentinel for the cleared filter — Radix Select reserves "" for the placeholder. */
const ALL = "__all__";

/**
 * Leading-course filter: pick a course and the palette shows only groupings whose
 * member set contains it (membership filter — no seed data needed). The option list
 * is the distinct set of courses that appear in at least one grouping, so every
 * choice narrows to something. Clearing returns all groupings.
 */
export default function GroupingFilter({ groupings, names, value, onChange }: Props) {
  const courses = leadingCourseOptions(groupings, names);

  return (
    <div className="flex flex-col gap-1 text-sm" data-slot="grouping-filter">
      <span className="text-muted-foreground font-medium">Leading course</span>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => {
          onChange(next === ALL ? null : next);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All groupings</SelectItem>
          {courses.map((course) => (
            <SelectItem key={course.id} value={course.id}>
              {course.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

const leadingCourseOptions = (
  groupings: PlannerGrouping[],
  names: Record<string, string>,
): { id: string; name: string }[] => {
  const ids = new Set(groupings.flatMap((grouping) => grouping.memberIds));
  return [...ids].map((id) => ({ id, name: names[id] ?? id })).sort((a, b) => a.name.localeCompare(b.name));
};
