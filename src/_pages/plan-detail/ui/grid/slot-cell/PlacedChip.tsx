import { useDraggable } from "@dnd-kit/react";
import { TriangleAlert, UserX, X } from "lucide-react";
import { subjectChipClass, type Cohort, type PlacementWeek, type SubjectColor } from "@/shared/config";
import { Badge, Button } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import type { CollisionInspectionTarget } from "../../overlay/CollisionDetailsDialog";
import type { CellOccupant } from "../../../model/collision/cell-occupants";
import type { PlacementDrag } from "../../../model/drag";
import { isBiweekly } from "../../../model/week";
import { stopDrag } from "../../../lib/drag-inert";
import { WeekToggle } from "./WeekToggle";

/**
 * The cell-level wiring every chip in a cell shares — slot identity plus the callbacks. Each chip
 * carries its own resolved `CellOccupant` (name + blocking/warning/unavailable flags), so neither
 * `SlotCell` nor `WeekLane` has to thread per-chip props or a `render` callback — each just hands
 * the same wiring to every chip.
 */
export type ChipWiring = {
  day: number;
  period: number;
  /** The chip's cohort — always set; stamped onto the single-placement drag so a cross-cohort
   *  single-course move is guarded (one board, two columns in combined; the single board its one). */
  cohort: Cohort;
  bundled: boolean;
  /** Placement ids matched by the active highlight lens; null = lens inactive. Each chip resolves
   *  its own membership from this shared set — no per-chip boolean threads through the cell. */
  lensMatched: Set<string> | null;
  onRemove: (placementId: string) => void;
  onSetWeek: (placementId: string, week: PlacementWeek) => void;
  onInspect: (target: CollisionInspectionTarget) => void;
};

/**
 * One placed course-hour. A chip in a blocking violation reads destructive and counts invalid; a
 * warn-only chip reads amber. The collision badge opens the details dialog; the A/B control (only
 * on a bi-weekly placement) moves the chip between week lanes. While the cell is bundled the chip's
 * own drag and remove go inert — the whole slot drags as one unit.
 */
export function PlacedChip({
  occupant,
  day,
  period,
  cohort,
  bundled,
  lensMatched,
  onRemove,
  onSetWeek,
  onInspect,
}: ChipWiring & { occupant: CellOccupant }) {
  const { placement, name, color, blocking, warning, unavailable } = occupant;
  const { ref, isDragging } = useDraggable<PlacementDrag>({
    id: placement.id,
    data: { kind: "placement", placementId: placement.id, courseId: placement.courseId, cohort },
    disabled: bundled || placement.pending === true,
  });

  // A bi-weekly placement always resolves to a single week (a/b); agnostic stays `both`.
  const biweekly = isBiweekly(placement.week);

  return (
    <div
      ref={ref}
      data-slot="placed-chip"
      aria-roledescription="placement"
      // Blocking (collision/strong-NO) is the invalid state; the Badge already styles aria-invalid.
      aria-invalid={blocking}
      className={cn(
        CHIP_LAYOUT,
        chipToneClass({ blocking, warning, color }),
        placement.pending && "opacity-60",
        !placement.pending && !bundled && "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
        // Highlight lens: matches keep full strength plus the semantic ring (static — the pulse
        // stays exclusive to `justDuplicated`); the rest recedes on the shared opacity axis, which
        // preserves the collision red/amber underneath so a dimmed blocking chip still reads red.
        lensMatched !== null && (lensMatched.has(placement.id) ? "ring-ring ring-2 ring-inset" : "opacity-40"),
      )}
    >
      <span className="truncate">{name}</span>
      {(blocking || warning) && (
        <Badge
          variant={blocking ? "destructive" : "warning"}
          asChild
          data-slot={unavailable ? "unavailable-badge" : "collision-badge"}
          className="cursor-pointer gap-0.5 px-1 py-0"
        >
          <button
            type="button"
            aria-label={unavailable ? "Show teacher-unavailable details" : "Show collision details"}
            {...stopDrag(() => {
              onInspect({ day, period, courseId: placement.courseId });
            })}
          >
            {unavailable ? <UserX className="size-3" /> : <TriangleAlert className="size-3" />}
            <span className="sr-only sm:not-sr-only">{unavailable ? "unavailable" : "collision"}</span>
          </button>
        </Badge>
      )}
      {/* The A/B control gates on week only (it opts out of drag), so a bundled opposite-week
          pair stays adjustable; the remove button stays bundled-gated like before. */}
      {(biweekly || !bundled) && (
        <div className="ml-auto flex shrink-0 items-center gap-0.5">
          {biweekly && (
            <WeekToggle
              week={placement.week}
              pending={placement.pending === true}
              onSelect={(week) => {
                onSetWeek(placement.id, week);
              }}
            />
          )}
          {!bundled && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot="remove-placement"
              aria-label={`Remove ${name}`}
              disabled={placement.pending}
              {...stopDrag(() => {
                onRemove(placement.id);
              })}
              className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive size-5 rounded"
            >
              <X className="size-4" />
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

/** Shared chip layout. Opacity (pending/dragging) composes separately — it is not a tone. */
const CHIP_LAYOUT = "flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs shadow-xs";

/**
 * The chip's tone resolved to exactly ONE bg/text pair, so a subject color *replaces* the neutral
 * background rather than layering a second `bg-*` (two `bg-*` utilities resolve non-deterministically
 * from the markup). Collision tones take precedence: a blocking/warning chip keeps its red/amber
 * regardless of color, so a conflict is never masked; only the plain `neutral` tone takes the color.
 */
export const chipToneClass = ({
  blocking,
  warning,
  color,
}: {
  blocking: boolean;
  warning: boolean;
  color: SubjectColor | null;
}): string =>
  blocking
    ? "border-destructive bg-destructive/10 text-destructive"
    : warning
      ? "border-warning bg-warning/10 text-warning"
      : color
        ? subjectChipClass(color)
        : "bg-secondary text-secondary-foreground";
