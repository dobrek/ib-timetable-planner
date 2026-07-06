import { Check, ChevronsUpDown } from "lucide-react";
import { COHORTS } from "@/shared/config";
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
import { cohortLeads } from "../lib";

type Props = {
  planId: string;
  students: StudentSummary[];
  current: StudentSummary;
};

/**
 * Student switcher with a cohort dimension the teacher switcher lacks: a dp1/dp2 tab pair that
 * mirrors the board's `CohortSwitcher` contract. The active tab (the current student's cohort) is
 * a plain, non-navigating trigger; the inactive tab is an anchor to the other cohort's first
 * name-ordered student, so toggling cohort navigates the whole page in one step (a shareable,
 * middle-clickable URL) — a student belongs to exactly one cohort, so the only outcome of
 * switching is jumping to a different student. Where the other cohort has no students, its tab
 * renders disabled rather than linking nowhere. The dropdown is scoped to the current cohort, so
 * the current student is always listed and check-marked; picking a student navigates via a plain
 * anchor to their stable URL.
 */
export default function StudentSwitcher({ planId, students, current }: Props) {
  const leads = cohortLeads(students);
  const scoped = students.filter((student) => student.cohort === current.cohort);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tabs value={current.cohort}>
        <TabsList>
          {COHORTS.map((option) => {
            if (option.value === current.cohort) {
              return (
                <TabsTrigger key={option.value} value={option.value}>
                  {option.label}
                </TabsTrigger>
              );
            }
            const lead = leads[option.value];
            return lead ? (
              <TabsTrigger key={option.value} value={option.value} asChild>
                <a href={`/plans/${planId}/students/${lead.id}`}>{option.label}</a>
              </TabsTrigger>
            ) : (
              <TabsTrigger key={option.value} value={option.value} disabled aria-disabled="true">
                {option.label}
              </TabsTrigger>
            );
          })}
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
