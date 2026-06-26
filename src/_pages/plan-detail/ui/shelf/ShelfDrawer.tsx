import { useDroppable } from "@dnd-kit/react";
import { ChevronRight, Inbox, Pin, PinOff } from "lucide-react";
import ParkedBundleCard from "./ParkedBundleCard";
import type { ShelfData } from "../../model/drag";
import type { LocalParkedBundle } from "../../model/parked";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui";

type Props = {
  parkedBundles: LocalParkedBundle[];
  names: Record<string, string>;
  /** Runtime open/closed — owned by `PlannerBoard` so the badge can drive it too. */
  expanded: boolean;
  /** Per-device pin (keep open). When pinned the drawer never auto-collapses. */
  pinned: boolean;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  onRemoveParked: (shelfBundleId: string) => void;
};

/**
 * The collapsible right-edge shelf drawer (3rd grid column). The whole aside is the island-wide
 * `shelf` droppable, so dragging a bundle onto it (even the collapsed tab) parks it — the board's
 * drop dispatch guards the target kind. Idle it is a thin tab showing the parked count; expanding
 * reflows the grid **once** (the `auto` grid column widens) — never mid-drag, so a parked card can
 * be dragged *out* onto a still-visible slot. Mirrors `PlannerPalette`'s aside structure
 * (shrink-0 header / min-h-0 flex-1 overflow-y-auto list). Neutral, semantic tokens only.
 */
export default function ShelfDrawer({
  parkedBundles,
  names,
  expanded,
  pinned,
  onExpandedChange,
  onPinnedChange,
  onRemoveParked,
}: Props) {
  const { ref, isDropTarget } = useDroppable<ShelfData>({ id: "shelf", data: { kind: "shelf" } });
  const count = parkedBundles.length;

  if (!expanded) {
    return (
      <aside
        ref={ref}
        data-slot="shelf-drawer"
        data-expanded="false"
        aria-label="Shelf"
        className={cn(
          "bg-background flex w-9 shrink-0 flex-col items-center rounded-lg border",
          isDropTarget && "ring-ring ring-2",
        )}
      >
        <button
          type="button"
          data-slot="shelf-expand"
          aria-label={`Open shelf (${count} parked)`}
          onClick={() => {
            onExpandedChange(true);
          }}
          className="text-muted-foreground hover:text-foreground flex flex-1 flex-col items-center gap-2 py-3"
        >
          <Inbox className="size-4" />
          <span className="text-xs font-medium tabular-nums">{count}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside
      ref={ref}
      data-slot="shelf-drawer"
      data-expanded="true"
      aria-label="Shelf"
      className={cn(
        "bg-background flex max-h-full min-h-0 w-60 shrink-0 flex-col gap-3 rounded-lg border p-3",
        isDropTarget && "ring-ring ring-2",
      )}
    >
      <header className="flex shrink-0 items-center gap-2 text-sm font-medium">
        <Inbox className="text-muted-foreground size-4" />
        <span>Shelf</span>
        <span data-slot="shelf-count" className="text-muted-foreground tabular-nums">
          {count}
        </span>
        <div className="ml-auto flex items-center gap-0.5">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="shelf-pin"
            aria-label={pinned ? "Unpin shelf" : "Pin shelf open"}
            aria-pressed={pinned}
            onClick={() => {
              onPinnedChange(!pinned);
            }}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded"
          >
            {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            data-slot="shelf-collapse"
            aria-label="Collapse shelf"
            // A pinned drawer stays open, so collapsing is a no-op — disable it rather than letting
            // the click silently do nothing (unpin first to collapse). The title spells out why.
            disabled={pinned}
            title={pinned ? "Unpin to collapse" : "Collapse shelf"}
            onClick={() => {
              onExpandedChange(false);
            }}
            className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded disabled:pointer-events-none disabled:opacity-40"
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </header>
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {count === 0 ? (
          <p data-slot="shelf-empty" className="text-muted-foreground px-1 py-4 text-center text-xs">
            Lift a bundle here to park it.
          </p>
        ) : (
          parkedBundles.map((bundle) => (
            <ParkedBundleCard key={bundle.id} bundle={bundle} names={names} onRemove={onRemoveParked} />
          ))
        )}
      </div>
    </aside>
  );
}
