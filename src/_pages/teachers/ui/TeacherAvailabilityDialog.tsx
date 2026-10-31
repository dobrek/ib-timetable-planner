import { useRef } from "react";
import { Ban, Minus } from "lucide-react";
import { type AvailabilitySeverity } from "@/shared/config";
import { dayLabel, periodLabel } from "@/shared/lib/slot-labels";
import { cn } from "@/shared/lib/class-names";
import { refreshPage } from "@/shared/lib/forms";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui";
import { severityAt } from "../model/availability";
import { useTeacherAvailability } from "../model/use-teacher-availability";
import type { TeacherRow } from "../model/teacher";

type Props = {
  /** The teacher whose availability is being edited, or null when closed. */
  teacher: TeacherRow | null;
  planId: string;
  days: number;
  periods: number;
  onClose: () => void;
  /** Without it the grid only shows each slot's availability — no toggles, nothing saved (S-405). */
  canEdit: boolean;
};

/**
 * Tri-state day×period availability grid for one teacher. Click a cell to cycle
 * available → soft → strong → available; click a day header to bulk-cycle the whole
 * column. Edits persist optimistically via `useTeacherAvailability`; failures roll back
 * and surface in the inline banner.
 *
 * Edits save immediately, but the row's badge count is server-loaded — so when the dialog
 * closes after an edit we re-run the page loader (`refreshPage`) to refresh it, matching
 * the catalog's create/edit/delete flow. The body is keyed by teacher id so its optimistic
 * state re-seeds whenever a different teacher is opened.
 *
 * Without `canEdit` the dialog is the read-only view of the same grid (S-405): the row's badge is
 * where availability is shown, so a viewer still needs it to open something. That body never mounts
 * `useTeacherAvailability` (the write path), and renders each slot as a named, non-interactive
 * gridcell through the same `AvailabilityCell`, so what a viewer reads cannot drift from what an
 * author toggles.
 */
export default function TeacherAvailabilityDialog({ teacher, planId, days, periods, onClose, canEdit }: Props) {
  const dirtyRef = useRef(false);

  const handleClose = () => {
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;
    onClose();
    if (wasDirty) void refreshPage();
  };

  return (
    <Dialog
      open={teacher !== null}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) handleClose();
      }}
    >
      <DialogContent className="flex max-h-[90vh] max-w-2xl flex-col gap-4 overflow-hidden">
        {teacher &&
          (canEdit ? (
            <AvailabilityBody
              key={teacher.id}
              teacher={teacher}
              planId={planId}
              days={days}
              periods={periods}
              onChange={() => {
                dirtyRef.current = true;
              }}
              onDone={handleClose}
            />
          ) : (
            <ReadOnlyAvailabilityBody
              key={teacher.id}
              teacher={teacher}
              days={days}
              periods={periods}
              onDone={handleClose}
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function AvailabilityBody({
  teacher,
  planId,
  days,
  periods,
  onChange,
  onDone,
}: {
  teacher: TeacherRow;
  planId: string;
  days: number;
  periods: number;
  onChange: () => void;
  onDone: () => void;
}) {
  const availability = useTeacherAvailability(teacher.availability, { planId, teacherId: teacher.id, days, periods });
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);

  const cycleCell = (day: number, period: number) => {
    onChange();
    availability.cycleCell(day, period);
  };

  const cycleColumn = (day: number) => {
    onChange();
    availability.cycleColumn(day);
  };

  const cycleRow = (period: number) => {
    onChange();
    availability.cycleRow(period);
  };

  return (
    <>
      <DialogHeader>
        <DialogTitle>Availability — {teacher.fullName ?? teacher.code}</DialogTitle>
        <DialogDescription>
          Click a cell to cycle available → soft (prefers not) → strong (cannot). Click a day header or a period label
          to bulk-set the whole column or row. Changes save automatically.
        </DialogDescription>
      </DialogHeader>

      {availability.error && (
        <div
          role="alert"
          className="border-destructive/50 bg-destructive/10 text-destructive flex items-center justify-between rounded-md border px-3 py-2 text-sm"
        >
          <span>{availability.error}</span>
          <Button
            variant="link"
            onClick={availability.clearError}
            className="text-destructive h-auto p-0 text-xs underline"
          >
            Dismiss
          </Button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          className="bg-border grid gap-px rounded-lg"
          style={{ gridTemplateColumns: `auto repeat(${days}, minmax(2.25rem, 1fr))` }}
        >
          <div className="bg-background p-1.5" />
          {dayList.map((day) => (
            <button
              key={day}
              type="button"
              onClick={() => {
                cycleColumn(day);
              }}
              className="bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground p-1.5 text-center text-xs font-medium"
              aria-label={`Cycle the whole ${dayLabel(day)} column`}
            >
              {dayLabel(day)}
            </button>
          ))}

          {periodList.map((period) => (
            <div key={period} className="contents">
              <button
                type="button"
                onClick={() => {
                  cycleRow(period);
                }}
                className="bg-background text-muted-foreground hover:bg-accent hover:text-accent-foreground flex items-center justify-center px-2 text-xs font-medium"
                aria-label={`Cycle the whole ${periodLabel(period)} row`}
              >
                {periodLabel(period)}
              </button>
              {dayList.map((day) => (
                <AvailabilityCell
                  key={day}
                  severity={availability.severityAt(day, period)}
                  onClick={() => {
                    cycleCell(day, period);
                  }}
                  label={`${dayLabel(day)} ${periodLabel(period)}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Legend />

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}

/**
 * The same day×period grid with nothing to press: a labelled ARIA grid (the `ScheduleGrid` contract —
 * `grid`/`row`/`columnheader`/`rowheader`/`gridcell`, every cell named) whose cells carry the very
 * accessible names the editable cells do. Severity is read straight off the teacher row, since there
 * are no optimistic writes to reconcile.
 */
function ReadOnlyAvailabilityBody({
  teacher,
  days,
  periods,
  onDone,
}: {
  teacher: TeacherRow;
  days: number;
  periods: number;
  onDone: () => void;
}) {
  const name = teacher.fullName ?? teacher.code;
  const dayList = Array.from({ length: days }, (_, i) => i + 1);
  const periodList = Array.from({ length: periods }, (_, i) => i + 1);

  return (
    <>
      <DialogHeader>
        <DialogTitle>Availability — {name}</DialogTitle>
        <DialogDescription>
          When this teacher can teach, period by period: available, soft (prefers not) or strong (cannot).
        </DialogDescription>
      </DialogHeader>

      <div className="min-h-0 flex-1 overflow-auto">
        <div
          role="grid"
          aria-label={`Availability — ${name}`}
          aria-readonly="true"
          className="bg-border grid gap-px rounded-lg"
          style={{ gridTemplateColumns: `auto repeat(${days}, minmax(2.25rem, 1fr))` }}
        >
          <div role="row" className="contents">
            <div role="presentation" className="bg-background p-1.5" />
            {dayList.map((day) => (
              <div
                key={day}
                role="columnheader"
                className="bg-background text-muted-foreground p-1.5 text-center text-xs font-medium"
              >
                {dayLabel(day)}
              </div>
            ))}
          </div>

          {periodList.map((period) => (
            <div key={period} role="row" className="contents">
              <div
                role="rowheader"
                className="bg-background text-muted-foreground flex items-center justify-center px-2 text-xs font-medium"
              >
                {periodLabel(period)}
              </div>
              {dayList.map((day) => (
                <AvailabilityCell
                  key={day}
                  severity={severityAt(teacher.availability, day, period)}
                  label={`${dayLabel(day)} ${periodLabel(period)}`}
                />
              ))}
            </div>
          ))}
        </div>
      </div>

      <Legend />

      <DialogFooter>
        <Button onClick={onDone}>Done</Button>
      </DialogFooter>
    </>
  );
}

/**
 * One slot. With `onClick` it is the cycle button an editor presses; without it (the read-only grid)
 * it is a named gridcell — the absent-handler idiom (S-405). Both share the name, tone and glyph.
 */
function AvailabilityCell({
  severity,
  onClick,
  label,
}: {
  severity: AvailabilitySeverity | null;
  onClick?: () => void;
  label: string;
}) {
  const state = severity ?? "available";
  const accessibleName = `${label}: ${SEVERITY_LABEL[state]}`;
  const glyph = (
    <>
      {severity === "soft" && <Minus className="size-4" aria-hidden="true" />}
      {severity === "strong" && <Ban className="size-4" aria-hidden="true" />}
    </>
  );

  if (!onClick) {
    return (
      <div role="gridcell" aria-label={accessibleName} className={cn(CELL_CLASS, SEVERITY_TONE[state])}>
        {glyph}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      data-severity={state}
      aria-label={accessibleName}
      className={cn(CELL_CLASS, "transition-colors", SEVERITY_TONE[state], SEVERITY_HOVER[state])}
    >
      {glyph}
    </button>
  );
}

function Legend() {
  return (
    <div className="text-muted-foreground flex flex-wrap items-center gap-4 text-xs">
      <span className="flex items-center gap-1.5">
        <span className="border-border size-3 rounded-sm border" /> Available
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-warning/15 text-warning flex size-3 items-center justify-center rounded-sm">
          <Minus className="size-2.5" aria-hidden="true" />
        </span>
        Soft — prefers not
      </span>
      <span className="flex items-center gap-1.5">
        <span className="bg-destructive/15 text-destructive flex size-3 items-center justify-center rounded-sm">
          <Ban className="size-2.5" aria-hidden="true" />
        </span>
        Strong — cannot
      </span>
    </div>
  );
}

const SEVERITY_LABEL: Record<AvailabilitySeverity | "available", string> = {
  available: "available",
  soft: "soft (prefers not)",
  strong: "strong (cannot)",
};

const CELL_CLASS = "flex h-8 items-center justify-center";

/** Semantic tokens only; the hover tint is added only where the cell is a button. */
const SEVERITY_TONE: Record<AvailabilitySeverity | "available", string> = {
  available: "bg-background",
  soft: "bg-warning/15 text-warning",
  strong: "bg-destructive/15 text-destructive",
};

const SEVERITY_HOVER: Record<AvailabilitySeverity | "available", string> = {
  available: "hover:bg-accent",
  soft: "hover:bg-warning/25",
  strong: "hover:bg-destructive/25",
};
