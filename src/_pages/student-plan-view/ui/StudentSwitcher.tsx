import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { COHORTS, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@/shared/ui";
import type { StudentSummary } from "../api/loader";

type Props = {
  planId: string;
  students: StudentSummary[];
  current: StudentSummary;
};

/**
 * Student switcher with a cohort dimension the teacher switcher lacks: a dp1/dp2 toggle
 * (client state — a bare cohort has no URL; initialized to the current student's cohort)
 * re-scopes the dropdown list without navigating, and picking a student navigates via a
 * plain anchor to their stable URL (shareable, middle-clickable). The current student is
 * check-marked only while their own cohort is selected.
 */
export default function StudentSwitcher({ planId, students, current }: Props) {
  const [cohort, setCohort] = useState<Cohort>(current.cohort);
  const scoped = students.filter((student) => student.cohort === cohort);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs
        value={cohort}
        onValueChange={(value) => {
          setCohort(value as Cohort);
        }}
      >
        <TabsList>
          {COHORTS.map((option) => (
            <TabsTrigger key={option.value} value={option.value}>
              {option.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="gap-2" aria-label="Switch student">
            {current.fullName}
            <ChevronsUpDown className="size-4 opacity-50" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
          {scoped.length === 0 && <DropdownMenuItem disabled>No students in this cohort</DropdownMenuItem>}
          {scoped.map((student) => (
            <DropdownMenuItem key={student.id} asChild>
              <a
                href={`/plans/${planId}/students/${student.id}`}
                aria-current={student.id === current.id ? "page" : undefined}
              >
                <Check className={cn("size-4", student.id !== current.id && "invisible")} aria-hidden="true" />
                {student.fullName}
              </a>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
