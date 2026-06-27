import { useDroppable } from "@dnd-kit/react";
import { ChevronRight, Inbox, Pin, PinOff } from "lucide-react";
import type { Cohort } from "@/shared/config";
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
  /** Combined view (S-06): shelfBundleId → owning cohort, so each card is tagged DP1/DP2 and its
   *  place-back is cohort-scoped. Absent on the single-cohort shelf (no tags). */
  cohortById?: Map<string, Cohort>;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  onRemoveParked: (shelfBundleId: string) => void;
};

/** Shared recipe for the two header icon buttons (pin, collapse) — mirrors `SidebarLayout`'s rail. */
const SHELF_ICON_BUTTON = "text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded";

/**
 * The collapsible right-edge shelf drawer (3rd grid column). The whole aside is the island-wide
 * `shelf` droppable, so dragging a bundle onto it (even the collapsed tab) parks it — the board's
 * drop dispatch guards the target kind. Idle it is a thin tab showing the parked count.
 *
 * One persistent `<aside>` whose width animates between the thin tab (`w-9`) and the open drawer
 * (`w-60`), mirroring `SidebarLayout`'s rail (`overflow-hidden transition-[width] duration-200
 * motion-reduce:transition-none`). Both the collapsed tab and the expanded body stay mounted and are
 * toggled by their display class, so the swap never remounts — the box just animates and clips. The
 * 3rd grid track is `auto`, so it tracks this width and the board reflows in step. That reflow only
 * ever fires on a click (expand) or after a drop (auto-collapse), never mid-drag — so a parked card
 * can still be dragged *out* onto a slot that stays visible. Neutral, semantic tokens only.
 */
export default function ShelfDrawer({
  parkedBundles,
  names,
  expanded,
  pinned,
  cohortById,
  onExpandedChange,
  onPinnedChange,
  onRemoveParked,
}: Props) {
  const { ref, isDropTarget } = useDroppable<ShelfData>({ id: "shelf", data: { kind: "shelf" } });
  const count = parkedBundles.length;

  return (
    <aside
      ref={ref}
      data-slot="shelf-drawer"
      data-expanded={expanded}
      aria-label="Shelf"
      className={cn(
        "bg-background flex max-h-full min-h-0 shrink-0 flex-col overflow-hidden rounded-lg border",
        "transition-[width] duration-200 motion-reduce:transition-none",
        expanded ? "w-60" : "w-9",
        isDropTarget && "ring-ring ring-2",
      )}
    >
      <CollapsedTab
        count={count}
        hidden={expanded}
        onExpand={() => {
          onExpandedChange(true);
        }}
      />
      <ExpandedShelf
        hidden={!expanded}
        count={count}
        pinned={pinned}
        parkedBundles={parkedBundles}
        names={names}
        cohortById={cohortById}
        onPinnedChange={onPinnedChange}
        onExpandedChange={onExpandedChange}
        onRemoveParked={onRemoveParked}
      />
    </aside>
  );
}

/** Idle state: a full-height tab showing the parked count; the whole thing expands the drawer. */
function CollapsedTab({ count, hidden, onExpand }: { count: number; hidden: boolean; onExpand: () => void }) {
  return (
    <button
      type="button"
      data-slot="shelf-expand"
      aria-label={`Open shelf (${count} parked)`}
      onClick={onExpand}
      // Toggle display via the class (not the `hidden` attr): a `.flex` utility would override
      // `[hidden]` and keep the tab on screen. `hidden` drops it from layout and the a11y tree.
      className={cn(
        "text-muted-foreground hover:text-foreground flex-col items-center gap-2 py-3",
        hidden ? "hidden" : "flex flex-1",
      )}
    >
      <Inbox className="size-4" />
      <span className="text-xs font-medium tabular-nums">{count}</span>
    </button>
  );
}

/** Open state: header (count, pin, collapse) over the scrollable list of parked bundles. */
function ExpandedShelf({
  hidden,
  count,
  pinned,
  parkedBundles,
  names,
  cohortById,
  onPinnedChange,
  onExpandedChange,
  onRemoveParked,
}: {
  hidden: boolean;
  count: number;
  pinned: boolean;
  parkedBundles: LocalParkedBundle[];
  names: Record<string, string>;
  cohortById?: Map<string, Cohort>;
  onPinnedChange: (pinned: boolean) => void;
  onExpandedChange: (expanded: boolean) => void;
  onRemoveParked: (shelfBundleId: string) => void;
}) {
  return (
    <div className={cn("min-h-0 flex-1 flex-col gap-3 p-3", hidden ? "hidden" : "flex")}>
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
            className={SHELF_ICON_BUTTON}
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
            className={cn(SHELF_ICON_BUTTON, "disabled:pointer-events-none disabled:opacity-40")}
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
            <ParkedBundleCard
              key={bundle.id}
              bundle={bundle}
              names={names}
              cohort={cohortById?.get(bundle.id)}
              onRemove={onRemoveParked}
            />
          ))
        )}
      </div>
    </div>
  );
}
