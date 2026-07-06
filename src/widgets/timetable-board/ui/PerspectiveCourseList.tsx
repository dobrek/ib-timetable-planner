import { cohortLabel } from "@/shared/config";
import { Badge } from "@/shared/ui";
import { formatCourseBadgeLabel } from "@/shared/lib/course-label";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import type { CourseDisplay } from "@/shared/lib/catalog-hash";
import {
  periodTimeRange,
  resolveCourseDisplay,
  weekLabel,
  type PerspectiveCourseItem,
  type PlannerPlacement,
} from "@/entities/timetable";
import type { CourseInfo } from "../model/course-info";

/**
 * One card's content: the entity item plus the persona's pre-rendered "people" props —
 * computed by the page (which owns name resolution), so the widget stays
 * name-resolution-free.
 */
export type PerspectiveCard = {
  item: PerspectiveCourseItem;
  /** Optional line between occurrences and roster (the teacher's "Co-teachers: …"). */
  inlineNote?: string;
  /** Always-visible roster: heading "`label` (N)", list named "`label` of `title`". */
  roster: { label: string; names: string[]; emptyMessage: string };
};

type Props = {
  cards: PerspectiveCard[];
  courseInfo: Record<string, CourseInfo>;
  courseDisplay: Record<string, CourseDisplay>;
  emptyMessage: string;
};

/**
 * The course list below the grid: one card per real course, with occurrence times
 * ("Mon P3 · 09:55–10:40 · week A"), hours placed/required, cohort/level badges, and an
 * always-visible compact multi-column roster — never conditional-rendered (per-person
 * volume is small, and collapsed-out-of-DOM content would break every future print path).
 */
export default function PerspectiveCourseList({ cards, courseInfo, courseDisplay, emptyMessage }: Props) {
  if (cards.length === 0) {
    return (
      <section aria-label="Courses">
        <h2 className="text-lg font-medium">Courses</h2>
        <p className="text-muted-foreground mt-2 text-sm">{emptyMessage}</p>
      </section>
    );
  }

  const sorted = [...cards].sort((a, b) => titleOf(a.item).localeCompare(titleOf(b.item)));

  return (
    <section aria-label="Courses" className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Courses</h2>
      {sorted.map((card) => (
        <CourseCard
          key={card.item.courseId}
          card={card}
          title={titleOf(card.item)}
          mergedIntoName={
            card.item.mergedIntoId ? resolveCourseDisplay(courseDisplay, card.item.mergedIntoId).name : null
          }
        />
      ))}
    </section>
  );

  function titleOf(item: PerspectiveCourseItem): string {
    // Every plan course row should be in `courseInfo` (fetched plan-wide, incl. merge
    // children), but the catalog and course queries are not snapshot-isolated — degrade,
    // don't crash, if a course landed between them.
    return formatCourseBadgeLabel(courseInfo[item.courseId] ?? { name: item.courseId, level: "none", groupIndex: 0 });
  }
}

function CourseCard({
  card,
  title,
  mergedIntoName,
}: {
  card: PerspectiveCard;
  title: string;
  mergedIntoName: string | null;
}) {
  const { item, inlineNote, roster } = card;

  return (
    <article aria-label={title} className="border-border bg-background rounded-lg border p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Badge variant="outline">{cohortLabel(item.cohort)}</Badge>
        {mergedIntoName && (
          <span className="text-muted-foreground text-xs">taught within the merged session {mergedIntoName}</span>
        )}
        {item.hours && (
          <span className="text-muted-foreground ml-auto text-xs" aria-label="Hours placed / required">
            {item.hours.placed}/{item.hours.required} h
          </span>
        )}
      </header>

      <div className="mt-2 flex flex-col gap-2 text-sm">
        {item.occurrences.length > 0 ? (
          <ul aria-label="Occurrences" className="flex flex-wrap gap-x-4 gap-y-1">
            {item.occurrences.map((occurrence) => (
              <li key={occurrence.id} className="text-foreground text-xs">
                {occurrenceLabel(occurrence)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-xs">Not scheduled yet</p>
        )}

        {inlineNote && <p className="text-muted-foreground text-xs">{inlineNote}</p>}

        <div>
          <h4 className="text-muted-foreground text-xs font-medium">
            {roster.label} ({roster.names.length})
          </h4>
          {roster.names.length > 0 ? (
            <ul
              aria-label={`${roster.label} of ${title}`}
              className="mt-1 columns-2 gap-x-6 text-xs sm:columns-3 lg:columns-4"
            >
              {roster.names.map((name, index) => (
                <li key={`${name}-${String(index)}`} className="break-inside-avoid">
                  {name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground mt-1 text-xs">{roster.emptyMessage}</p>
          )}
        </div>
      </div>
    </article>
  );
}

/** "Mon P3 · 09:55–10:40 · week A" — clock times through the `periodTimeRange` seam only. */
const occurrenceLabel = (placement: PlannerPlacement): string => {
  const range = periodTimeRange(placement.period);
  const parts = [
    `${dayLabel(placement.day)} ${periodLabel(placement.period)}`,
    ...(range ? [`${range.start}–${range.end}`] : []),
    ...(placement.week !== "both" ? [weekLabel(placement.week)] : []),
  ];
  return parts.join(" · ");
};
