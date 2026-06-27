import { useState } from "react";
import { ArrowDownUp } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui";
import { leadingCourseOptions, sortByGroupCount, sortByName } from "../../model/leading-course-options";
import type { LeadingCourseOption } from "../../model/leading-course-options";
import type { PlannerGrouping } from "../../model/grouping";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  value: string | null;
  onChange: (courseId: string | null) => void;
  companionValue: string | null;
  onCompanionChange: (courseId: string | null) => void;
  companionOptions: LeadingCourseOption[];
};

type SortOrder = "by-groups" | "alphabetic";

/** Sentinels for the cleared filters — Radix Select reserves "" for the placeholder. */
const ALL = "__all__";
const ANY_COMPANION = "__any__";

/**
 * Leading-course filter: pick a course and the palette shows only groupings whose
 * member set contains it (membership filter — no seed data needed). The option list
 * is the distinct set of courses that appear in at least one grouping, each labelled
 * with its group count, so every choice narrows to something. Options default to
 * fewest-groupings-first (most constrained surface first); an icon-button toggle
 * switches to alphabetic order. Clearing returns all groupings.
 *
 * Below it sits a cascading companion-course filter, disabled until a leading course
 * is chosen. Its `companionOptions` (co-occurring courses, leading excluded, always
 * alphabetical) are computed by the owning hook; this component only renders them and
 * reports selection. The leading sort toggle governs the leading list only.
 */
export default function GroupingFilter({
  groupings,
  names,
  value,
  onChange,
  companionValue,
  onCompanionChange,
  companionOptions,
}: Props) {
  const [sortOrder, setSortOrder] = useState<SortOrder>("by-groups");
  const base = leadingCourseOptions(groupings, names);
  const courses = sortOrder === "by-groups" ? sortByGroupCount(base) : sortByName(base);

  return (
    <div className="flex flex-col gap-1 text-sm" data-slot="grouping-filter">
      <div className="flex items-center gap-1">
        <span className="text-muted-foreground font-medium">Leading course</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto size-7" aria-label="Sort order">
              <ArrowDownUp aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup
              value={sortOrder}
              onValueChange={(next) => {
                setSortOrder(next as SortOrder);
              }}
            >
              <DropdownMenuRadioItem value="by-groups">By group count</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="alphabetic">Alphabetical</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Select
        value={value ?? ALL}
        onValueChange={(next) => {
          onChange(next === ALL ? null : next);
        }}
      >
        <SelectTrigger className="w-full" aria-label="Leading course">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All groupings</SelectItem>
          {courses.map((course) => (
            <SelectItem key={course.id} value={course.id}>
              {`${course.name} (${course.groupCount})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <span className="text-muted-foreground mt-1 font-medium">Companion course</span>
      <Select
        value={companionValue ?? ANY_COMPANION}
        onValueChange={(next) => {
          onCompanionChange(next === ANY_COMPANION ? null : next);
        }}
        disabled={value === null}
      >
        <SelectTrigger className="w-full" aria-label="Companion course">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ANY_COMPANION}>Any companion</SelectItem>
          {companionOptions.map((course) => (
            <SelectItem key={course.id} value={course.id}>
              {`${course.name} (${course.groupCount})`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
