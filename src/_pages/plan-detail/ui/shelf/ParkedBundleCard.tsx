import { useDraggable } from "@dnd-kit/react";
import { GripVertical, X } from "lucide-react";
import { cohortLabel, subjectChipClass, type Cohort } from "@/shared/config";
import { resolveCourseDisplay, type CourseDisplay } from "@/entities/timetable";
import type { ParkedDrag } from "../../model/drag";
import type { LocalParkedBundle, ParkedMember } from "../../model/placement/parked";
import { cn } from "@/shared/lib/class-names";
import { Badge, Button } from "@/shared/ui";
import { stopDrag } from "../../lib/drag-inert";

type Props = {
  bundle: LocalParkedBundle;
  courseDisplay: Record<string, CourseDisplay>;
  /** The bundle's owning cohort — always set; tags the card DP1/DP2 and scopes its place-back drag
   *  to that cohort (one shared shelf in combined; the single board tags its one cohort too). */
  cohort: Cohort;
  onRemove: (shelfBundleId: string) => void;
};

/**
 * A parked bundle card: a standalone component that **mirrors `GroupingBox`'s layout/classes** for
 * the off-board unit (not the same component), as a **neutral, week-aware variant** — a parked
 * bundle isn't validated, so no collision flag, no A/B *toggle*, no
 * `aria-invalid`. It is **week-aware** though: it carries each member's parked A/B week, so the
 * card surfaces an "A/B" summary badge and a per-member week tag (a read-only formation cue, not a
 * control). The redundant "N courses" count is dropped — the member rows already show it. The whole
 * card is the `parked` draggable (drop it on a slot to place it back); the ghost "×" discards it
 * outright (the only non-place-back exit from the shelf). Semantic tokens only.
 */
export default function ParkedBundleCard({ bundle, courseDisplay, cohort, onRemove }: Props) {
  const { ref, isDragging } = useDraggable<ParkedDrag>({
    id: `parked:${bundle.id}`,
    data: { kind: "parked", shelfBundleId: bundle.id, cohort },
    disabled: bundle.pending === true,
  });
  const weekAware = bundle.members.some((member) => member.week !== "both");

  return (
    <div
      ref={ref}
      data-slot="parked-bundle-card"
      aria-roledescription="parked bundle"
      className={cn(
        "bg-background rounded-lg border",
        !bundle.pending && "cursor-grab active:cursor-grabbing",
        (bundle.pending === true || isDragging) && "opacity-60",
      )}
    >
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <Badge data-slot="parked-cohort-badge" variant="outline" title={`Parked from ${cohortLabel(cohort)}`}>
          {cohortLabel(cohort)}
        </Badge>
        {weekAware && (
          <Badge data-slot="parked-week-badge" variant="secondary" title="Members run on specific weeks (A/B)">
            A/B
          </Badge>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="remove-parked"
          aria-label="Discard parked bundle"
          disabled={bundle.pending}
          {...stopDrag(() => {
            onRemove(bundle.id);
          })}
          className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive ml-auto size-5 rounded"
        >
          <X className="size-4" />
        </Button>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {bundle.members.map((member) => {
          const display = resolveCourseDisplay(courseDisplay, member.courseId);
          return (
            <li
              key={member.courseId}
              data-optional={member.isOptional ? "true" : undefined}
              className={cn(
                "flex items-center gap-1 rounded-md border px-1.5 py-1 text-xs",
                subjectChipClass(display.color),
                // The parked twin of the board chip's optional axis — the pending decision stays
                // visible while parked (no invisible state where temporary choices accumulate).
                member.isOptional && "border-dashed saturate-75",
              )}
            >
              <span className="truncate">{display.name}</span>
              <OptionalTag isOptional={member.isOptional} />
              <WeekTag week={member.week} />
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** A read-only optional cue on a member row — the WeekTag pattern for the pending-decision axis. */
function OptionalTag({ isOptional }: { isOptional: boolean }) {
  if (!isOptional) return null;
  return (
    <span data-slot="optional-tag" className="text-muted-foreground shrink-0 text-[10px] italic">
      optional
    </span>
  );
}

/** A read-only week cue on a member row — "A"/"B" for a week-specific course, nothing for `both`. */
function WeekTag({ week }: { week: ParkedMember["week"] }) {
  if (week === "both") return null;
  return (
    <span className="text-muted-foreground ml-auto shrink-0 text-xs font-semibold uppercase tabular-nums">{week}</span>
  );
}
