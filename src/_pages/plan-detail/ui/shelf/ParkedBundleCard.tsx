import { useDraggable } from "@dnd-kit/react";
import { GripVertical, X } from "lucide-react";
import type { ParkedDrag } from "../../model/drag";
import type { LocalParkedBundle, ParkedMember } from "../../model/parked";
import { cn } from "@/shared/lib/class-names";
import { Badge, Button } from "@/shared/ui";
import { stopDrag } from "../slot-cell/drag-inert";

type Props = {
  bundle: LocalParkedBundle;
  names: Record<string, string>;
  onRemove: (shelfBundleId: string) => void;
};

/**
 * A parked bundle card: the `GroupingBox` shell reused for the off-board unit, but **neutral and
 * flag-free** — a parked bundle isn't validated, so no collision flag, no A/B *toggle*, no
 * `aria-invalid`. It is **week-aware** though: it carries each member's parked A/B week, so the
 * card surfaces an "A/B" summary badge and a per-member week tag (a read-only formation cue, not a
 * control). The redundant "N courses" count is dropped — the member rows already show it. The whole
 * card is the `parked` draggable (drop it on a slot to place it back); the ghost "×" discards it
 * outright (the only non-place-back exit from the shelf). Semantic tokens only.
 */
export default function ParkedBundleCard({ bundle, names, onRemove }: Props) {
  const { ref, isDragging } = useDraggable<ParkedDrag>({
    id: `parked:${bundle.id}`,
    data: { kind: "parked", shelfBundleId: bundle.id },
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
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <GripVertical className="text-muted-foreground size-4" />
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
        {bundle.members.map((member) => (
          <li key={member.courseId} className="flex items-center gap-2 rounded-md border px-2 py-1.5 text-sm">
            <span className="truncate">{names[member.courseId] ?? member.courseId}</span>
            <WeekTag week={member.week} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A read-only week cue on a member row — "A"/"B" for a week-specific course, nothing for `both`. */
function WeekTag({ week }: { week: ParkedMember["week"] }) {
  if (week === "both") return null;
  return (
    <span className="text-muted-foreground ml-auto shrink-0 text-xs font-semibold uppercase tabular-nums">{week}</span>
  );
}
