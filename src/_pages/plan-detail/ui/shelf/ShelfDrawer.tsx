import { useDroppable } from "@dnd-kit/react";
import { Inbox, Pin, PinOff } from "lucide-react";
import type { Cohort } from "@/shared/config";
import ParkedBundleCard from "./ParkedBundleCard";
import CollapsibleEdgePanel, { EDGE_PANEL_ICON_BUTTON } from "../chrome/CollapsibleEdgePanel";
import type { CourseDisplay } from "../../model/course-display";
import type { ShelfData } from "../../model/drag";
import type { LocalParkedBundle } from "../../model/placement/parked";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui";

type Props = {
  parkedBundles: LocalParkedBundle[];
  courseDisplay: Record<string, CourseDisplay>;
  /** Runtime open/closed — owned by `PlannerBoard` so the badge can drive it too. */
  expanded: boolean;
  /** Per-device pin (keep open). When pinned the drawer never auto-collapses. */
  pinned: boolean;
  /** shelfBundleId → owning cohort — total over `parkedBundles`, so each card is tagged DP1/DP2 and
   *  its place-back is cohort-scoped (the combined shelf maps both cohorts; the single board its one). */
  cohortById: Map<string, Cohort>;
  onExpandedChange: (expanded: boolean) => void;
  onPinnedChange: (pinned: boolean) => void;
  onRemoveParked: (shelfBundleId: string) => void;
};

/**
 * The collapsible right-edge shelf drawer (3rd grid column), a thin composition over the shared
 * `CollapsibleEdgePanel`. The shell owns the width-animated chrome (rail ↔ open, header, collapse);
 * the shelf keeps everything dnd- and pin-specific: the island-wide `useDroppable` (the WHOLE aside
 * is the drop target — its ref + the `ring-ring ring-2` drop ring ride on the panel's root so even a
 * drop onto the collapsed tab parks), the pin button (passed as `headerActions`), and the
 * disable-collapse-when-pinned rule (passed as `collapseDisabled`/`collapseTitle`). The shelf's
 * bordered box lives on the aside itself (unlike the palette, whose box is its rail), so it passes
 * the border/bg via `className`. The display-class collapse toggle in the shell keeps a parked card
 * draggable *out* even as the box animates closed after a drop.
 */
export default function ShelfDrawer({
  parkedBundles,
  courseDisplay,
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
    <CollapsibleEdgePanel
      side="right"
      icon={Inbox}
      label="Shelf"
      name="shelf"
      countNoun="parked"
      count={count}
      collapsed={!expanded}
      onCollapsedChange={(collapsed) => {
        onExpandedChange(!collapsed);
      }}
      openWidthClass="w-60"
      dataSlot="shelf-drawer"
      ariaLabel="Shelf"
      containerRef={ref}
      className={cn("bg-background rounded-lg border", isDropTarget && "ring-ring ring-2")}
      bodyClassName="gap-3 p-3"
      collapseDisabled={pinned}
      collapseTitle={pinned ? "Unpin to collapse" : "Collapse shelf"}
      headerActions={
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
          className={EDGE_PANEL_ICON_BUTTON}
        >
          {pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
        </Button>
      }
    >
      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
        {count === 0 ? (
          <p data-slot="shelf-empty" className="text-muted-foreground px-1 py-4 text-center text-xs">
            Lift a bundle here to park it.
          </p>
        ) : (
          parkedBundles.map((bundle) => {
            // `cohortById` is total over `parkedBundles`; the guard narrows `Cohort | undefined` → `Cohort`
            // (a missing entry would be a wiring bug, so render nothing rather than an untagged card).
            const cohort = cohortById.get(bundle.id);
            if (!cohort) return null;
            return (
              <ParkedBundleCard
                key={bundle.id}
                bundle={bundle}
                courseDisplay={courseDisplay}
                cohort={cohort}
                onRemove={onRemoveParked}
              />
            );
          })
        )}
      </div>
    </CollapsibleEdgePanel>
  );
}
