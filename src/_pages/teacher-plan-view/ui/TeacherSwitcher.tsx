import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/shared/lib/class-names";
import { Button, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/shared/ui";
import type { TeacherSummary } from "../api/loader";

type Props = {
  planId: string;
  teachers: TeacherSummary[];
  current: TeacherSummary;
};

/**
 * Link-navigation teacher switcher — the `CohortSwitcher` idiom as a dropdown of anchors
 * (teacher count exceeds Tabs scale): each item navigates to the sibling teacher's stable
 * URL, so views stay shareable and the browser owns history.
 */
export default function TeacherSwitcher({ planId, teachers, current }: Props) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="gap-2" aria-label="Switch teacher">
          {teacherLabel(current)}
          <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
        {teachers.map((teacher) => (
          <DropdownMenuItem key={teacher.id} asChild>
            <a
              href={`/plans/${planId}/teachers/${teacher.id}`}
              aria-current={teacher.id === current.id ? "page" : undefined}
            >
              <Check className={cn("size-4", teacher.id !== current.id && "invisible")} aria-hidden="true" />
              {teacherLabel(teacher)}
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

const teacherLabel = (teacher: TeacherSummary): string =>
  teacher.fullName ? `${teacher.code} — ${teacher.fullName}` : teacher.code;
