import { useDraggable } from "@dnd-kit/react";
import { GripVertical, X } from "lucide-react";
import type { ParkedDrag } from "../../model/drag";
import type { LocalParkedBundle } from "../../model/parked";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui";
import { stopDrag } from "../slot-cell/drag-inert";

type Props = {
  bundle: LocalParkedBundle;
  names: Record<string, string>;
  onRemove: (shelfBundleId: string) => void;
};

/**
 * A parked bundle card: the `GroupingBox` shell (header "N courses" + member rows) reused for the
 * off-board unit, but **neutral and flag-free** — a parked bundle isn't validated, so no collision
 * flag, no A/B toggle, no `aria-invalid`. The whole card is the `parked` draggable (drop it on a
 * slot to place it back); the ghost "×" discards the whole card outright (gone, not placed back —
 * the only non-place-back exit from the shelf). Semantic tokens only.
 */
export default function ParkedBundleCard({ bundle, names, onRemove }: Props) {
  const { ref, isDragging } = useDraggable<ParkedDrag>({
    id: `parked:${bundle.id}`,
    data: { kind: "parked", shelfBundleId: bundle.id },
    disabled: bundle.pending === true,
  });
  const count = bundle.members.length;

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
        <span>
          {count} {count === 1 ? "course" : "courses"}
        </span>
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
          <li key={member.courseId} className="truncate rounded-md border px-2 py-1.5 text-sm">
            {names[member.courseId] ?? member.courseId}
          </li>
        ))}
      </ul>
    </div>
  );
}
