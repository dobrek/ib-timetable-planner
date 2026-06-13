import { useRef } from "react";
import { Ban, Minus } from "lucide-react";
import { type AvailabilitySeverity, dayLabel, periodLabel } from "@/shared/config";
import { cn } from "@/shared/lib/cn";
import { refreshPage } from "@/shared/lib/forms";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui";
import { useTeacherAvailability } from "../model/use-teacher-availability";
import type { TeacherRow } from "../model/teacher";

type Props = {
  /** The teacher whose availability is being edited, or null when closed. */
  teacher: TeacherRow | null;
  planId: string;
  days: number;
  periods: number;
  onClose: () => void;
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
 */
export default function TeacherAvailabilityDialog({ teacher, planId, days, periods, onClose }: Props) {
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
        {teacher && (
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
        )}
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
    availability.setColumn(day, nextLineSeverity(periodList.map((period) => availability.severityAt(day, period))));
  };

  const cycleRow = (period: number) => {
    onChange();
    availability.setRow(period, nextLineSeverity(dayList.map((day) => availability.severityAt(day, period))));
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

function AvailabilityCell({
  severity,
  onClick,
  label,
}: {
  severity: AvailabilitySeverity | null;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-severity={severity ?? "available"}
      aria-label={`${label}: ${SEVERITY_LABEL[severity ?? "available"]}`}
      className={cn(
        "flex h-8 items-center justify-center transition-colors",
        severity === null && "bg-background hover:bg-accent",
        severity === "soft" && "bg-warning/15 text-warning hover:bg-warning/25",
        severity === "strong" && "bg-destructive/15 text-destructive hover:bg-destructive/25",
      )}
    >
      {severity === "soft" && <Minus className="size-4" aria-hidden="true" />}
      {severity === "strong" && <Ban className="size-4" aria-hidden="true" />}
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

/**
 * Bulk-cycle for a whole line (a column or a row), mirroring the per-cell cycle at line
 * granularity: uniformly strong → clear; uniformly soft → strong; anything else
 * (empty/mixed) → soft.
 */
function nextLineSeverity(severities: (AvailabilitySeverity | null)[]): AvailabilitySeverity | null {
  if (severities.every((s) => s === "strong")) return null;
  if (severities.every((s) => s === "soft")) return "strong";
  return "soft";
}
