import type { ReactNode } from "react";
import { cohortLabel, subjectChipClass } from "@/shared/config";
import { PopoverContent, PopoverHeader, PopoverTitle } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import HoursCounter from "../palette/HoursCounter";
import type { CoursesLeftCohort, CoursesLeftRow, CoursesLeftSummary, OptionalCourseRow } from "./courses-left-summary";

type Props = {
  summary: CoursesLeftSummary;
  /** Combined mode groups rows under DP1/DP2 subheaders; focus mode shows one cohort, no subheader. */
  combined: boolean;
};

/**
 * Presentational Popover content for the top-bar placement breakdown: a Missing section (courses
 * still needing board hours), a warning-toned Over-placed section when any course is over-placed,
 * and an Optional section — the review checklist of pending per-member decisions — when any
 * placement is marked optional. Rows mirror the palette member row — subject-color chip +
 * truncated name + placed/required counter (Optional rows carry their count instead). No state,
 * no data fetching; every value arrives assembled via `summary`. The Missing section renders only
 * when hours are left, so the "all placed · M over" state opens straight to it.
 */
export default function CoursesLeftPopover({ summary, combined }: Props) {
  const missingCount = summary.cohorts.reduce((count, cohort) => count + cohort.missing.length, 0);
  const overCount = summary.cohorts.reduce((count, cohort) => count + cohort.over.length, 0);
  const optionalCourseCount = summary.cohorts.reduce((count, cohort) => count + cohort.optional.length, 0);
  return (
    <PopoverContent align="end" data-slot="courses-left-popover" className="w-80">
      <PopoverHeader>
        <PopoverTitle>Course placement</PopoverTitle>
      </PopoverHeader>
      <div className="mt-3 flex max-h-96 flex-col gap-4 overflow-y-auto">
        {summary.hoursLeft > 0 && (
          <Section
            title="Missing"
            subtitle={`${countLabel(missingCount)} · ${hourLabel(summary.hoursLeft)} left`}
            pick={(cohort) => cohort.missing}
            renderRow={(row) => <CourseRow key={row.courseId} row={row} />}
            cohorts={summary.cohorts}
            combined={combined}
          />
        )}
        {summary.hoursOver > 0 && (
          <Section
            title="Over-placed"
            subtitle={`${countLabel(overCount)} · ${hourLabel(summary.hoursOver)} over`}
            pick={(cohort) => cohort.over}
            renderRow={(row) => <CourseRow key={row.courseId} row={row} />}
            cohorts={summary.cohorts}
            combined={combined}
            warning
          />
        )}
        {summary.optionalCount > 0 && (
          <Section
            title="Optional"
            subtitle={`${countLabel(optionalCourseCount)} · ${summary.optionalCount} optional`}
            pick={(cohort) => cohort.optional}
            renderRow={(row) => <OptionalRow key={row.courseId} row={row} />}
            cohorts={summary.cohorts}
            combined={combined}
          />
        )}
      </div>
    </PopoverContent>
  );
}

function Section<Row>({
  title,
  subtitle,
  pick,
  renderRow,
  cohorts,
  combined,
  warning = false,
}: {
  title: string;
  subtitle: string;
  pick: (cohort: CoursesLeftCohort) => Row[];
  renderRow: (row: Row) => ReactNode;
  cohorts: CoursesLeftCohort[];
  combined: boolean;
  warning?: boolean;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className={cn("flex flex-col gap-0.5 border-b pb-1", warning && "border-warning")}>
        <span className={cn("text-sm font-medium", warning && "text-warning")}>{title}</span>
        <span className="text-muted-foreground text-xs">{subtitle}</span>
      </div>
      {cohorts.map((cohort) => {
        const rows = pick(cohort);
        if (rows.length === 0) return null;
        return (
          <div key={cohort.cohort} className="flex flex-col gap-1">
            {combined && (
              <span className="text-muted-foreground text-xs font-medium">{cohortLabel(cohort.cohort)}</span>
            )}
            <ul className="flex flex-col gap-1">{rows.map(renderRow)}</ul>
          </div>
        );
      })}
    </section>
  );
}

function CourseRow({ row }: { row: CoursesLeftRow }) {
  return (
    <li
      data-slot="courses-left-row"
      className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs", subjectChipClass(row.color))}
    >
      <span className="truncate">{row.name}</span>
      <HoursCounter hours={{ placed: row.placed, required: row.required }} />
    </li>
  );
}

/** An Optional-section row: `name · N optional` — a pending decision, not an hours gap, so no HoursCounter. */
function OptionalRow({ row }: { row: OptionalCourseRow }) {
  return (
    <li
      data-slot="optional-course-row"
      className={cn(
        "flex items-center gap-1 rounded-md border border-dashed px-1.5 py-1 text-xs",
        subjectChipClass(row.color),
      )}
    >
      <span className="truncate">{row.name}</span>
      <span className="text-muted-foreground ml-auto shrink-0 text-[10px] italic">{row.count} optional</span>
    </li>
  );
}

const countLabel = (count: number): string => `${count} ${count === 1 ? "course" : "courses"}`;
const hourLabel = (hours: number): string => `${hours} ${hours === 1 ? "hour" : "hours"}`;
