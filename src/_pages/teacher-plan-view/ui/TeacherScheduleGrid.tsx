import { Fragment } from "react";
import { TriangleAlert, UserX } from "lucide-react";
import { cohortLabel, subjectChipClass, type AvailabilitySeverity, type Cohort } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import { Badge } from "@/shared/ui";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import {
  breaksAfterPeriod,
  cellKey,
  weekLabel,
  type CellOccupant,
  type CollisionInspectionTarget,
} from "@/entities/timetable";

/** One chip on the teacher grid: the resolved occupant view-model tagged with its cohort. */
export type TeacherGridOccupant = CellOccupant & { cohort: Cohort };

type Props = {
  days: number;
  periods: number;
  gridLabel: string;
  /** cellKey → the teacher's chips at that slot (both cohorts merged, cohort-tagged). */
  occupantsByCell: Map<string, TeacherGridOccupant[]>;
  /** cellKey → severity of the teacher's availability block — shades the cell. */
  unavailable: Map<string, AvailabilitySeverity>;
  onInspect: (cohort: Cohort, target: CollisionInspectionTarget) => void;
};

/**
 * The static, print-viable teacher timetable: no zoom, no sticky headers, no drag, no
 * `overflow-auto` ancestor dependency — all content always in the DOM (the collision
 * *dialog* is the sanctioned disclosure exception; its badges stay visible). Mirrors the
 * board grid's ARIA contract (`grid`/`row`/`columnheader`/`rowheader`/`gridcell`, cells
 * named even when empty) and its visual language (border-gap grid, break bands, subject
 * chip tones) — semantic theme tokens only.
 */
export default function TeacherScheduleGrid({
  days,
  periods,
  gridLabel,
  occupantsByCell,
  unavailable,
  onInspect,
}: Props) {
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);

  return (
    <div
      role="grid"
      aria-label={gridLabel}
      className="bg-border grid gap-px rounded-lg"
      style={{ gridTemplateColumns: `auto repeat(${days}, minmax(8rem, 1fr))` }}
    >
      <div role="row" className="contents">
        <div role="presentation" className="bg-background p-2" />
        {dayList.map((day) => (
          <div
            key={day}
            role="columnheader"
            className="bg-background text-muted-foreground p-2 text-center text-xs font-medium"
          >
            {dayLabel(day)}
          </div>
        ))}
      </div>

      {periodList.map((period) => (
        <Fragment key={period}>
          <div role="row" className="contents">
            <div
              role="rowheader"
              className="bg-background text-muted-foreground flex items-center justify-center p-2 text-xs font-medium"
            >
              {periodLabel(period)}
            </div>
            {dayList.map((day) => {
              const key = cellKey(day, period);
              return (
                <TeacherSlotCell
                  key={day}
                  day={day}
                  period={period}
                  occupants={occupantsByCell.get(key) ?? []}
                  shading={unavailable.get(key)}
                  onInspect={onInspect}
                />
              );
            })}
          </div>
          {breaksAfterPeriod(period, periods) && (
            <div role="presentation" aria-hidden className="bg-background bg-period-break col-[1/-1] h-3" />
          )}
        </Fragment>
      ))}
    </div>
  );
}

function TeacherSlotCell({
  day,
  period,
  occupants,
  shading,
  onInspect,
}: {
  day: number;
  period: number;
  occupants: TeacherGridOccupant[];
  shading: AvailabilitySeverity | undefined;
  onInspect: (cohort: Cohort, target: CollisionInspectionTarget) => void;
}) {
  const hasBlocking = occupants.some((occupant) => occupant.blocking);
  const label = shading
    ? `${dayLabel(day)}, ${periodLabel(period)} — unavailable (${shading})`
    : `${dayLabel(day)}, ${periodLabel(period)}`;

  return (
    <div
      role="gridcell"
      aria-label={label}
      aria-invalid={hasBlocking || undefined}
      className={cn(
        "flex min-h-[34px] flex-col gap-1 p-1",
        // Availability shading via semantic tokens: strong blocks read destructive-tinted,
        // soft preferences read warning-tinted; free cells stay plain background.
        shading === "strong" ? "bg-destructive/10" : shading === "soft" ? "bg-warning/10" : "bg-background",
      )}
    >
      {occupants.map((occupant) => (
        <TeacherChip key={occupant.placement.id} occupant={occupant} day={day} period={period} onInspect={onInspect} />
      ))}
    </div>
  );
}

/**
 * A simpler presentational chip in the board's design language — shared subject-color
 * tokens, the same collision red/amber precedence — without the board chip's drag or
 * remove affordances. Bi-weekly placements carry their week label inline (no lanes).
 */
function TeacherChip({
  occupant,
  day,
  period,
  onInspect,
}: {
  occupant: TeacherGridOccupant;
  day: number;
  period: number;
  onInspect: (cohort: Cohort, target: CollisionInspectionTarget) => void;
}) {
  const { placement, name, color, blocking, warning, unavailable, cohort } = occupant;
  // Collision tones take precedence over the subject color, exactly like the board chip —
  // a conflict is never masked; only the plain tone takes the color.
  const tone = blocking
    ? "border-destructive bg-destructive/10 text-destructive"
    : warning
      ? "border-warning bg-warning/10 text-warning"
      : subjectChipClass(color) || "bg-secondary text-secondary-foreground";

  return (
    <div
      data-slot="teacher-chip"
      aria-roledescription="placement"
      aria-invalid={blocking}
      className={cn("flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs", tone)}
    >
      <span className="truncate">{name}</span>
      <span className="text-muted-foreground shrink-0 text-[10px] uppercase">{cohortLabel(cohort)}</span>
      {placement.week !== "both" && (
        <span className="text-muted-foreground shrink-0 text-[10px]">{weekLabel(placement.week)}</span>
      )}
      {(blocking || warning) && (
        <Badge
          variant={blocking ? "destructive" : "warning"}
          asChild
          data-slot={unavailable ? "unavailable-badge" : "collision-badge"}
          className="ml-auto cursor-pointer gap-0.5 px-1 py-0"
        >
          <button
            type="button"
            aria-label={unavailable ? "Show teacher-unavailable details" : "Show collision details"}
            onClick={() => {
              onInspect(cohort, { day, period, courseId: placement.courseId });
            }}
          >
            {unavailable ? <UserX className="size-3" /> : <TriangleAlert className="size-3" />}
            <span className="sr-only sm:not-sr-only">{unavailable ? "unavailable" : "collision"}</span>
          </button>
        </Badge>
      )}
    </div>
  );
}
