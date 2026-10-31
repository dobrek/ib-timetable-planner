import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { Accessibility, defaultPreset, Feedback } from "@dnd-kit/dom";
import { cn } from "@/shared/lib/class-names";

type Props = {
  /** The caller may edit (`allows(access, "edit")`, computed by the route). Without it the provider
   *  runs without dnd-kit's Accessibility plugin — see `READ_ONLY_PLUGINS`. */
  canEdit: boolean;
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** data-slot on the 3-column grid. The one board passes "planner-board" in every mode. */
  gridDataSlot: string;
  /** Header block above the grid: the `PlanSummaryBar` fragment (plus lens bar / live region). */
  header: ReactNode;
  /** 1st column — the one palette panel (`CombinedPalettePanel`, with an optional cohort switcher).
   *  Omitted, together with `shelf`, for a caller who may not edit (S-405). */
  palette?: ReactNode;
  /** 2nd column (the board column): error banner(s), optional hint toggle, and the grid. */
  center: ReactNode;
  /** 3rd column — the shelf. Omitted, together with `palette`, for a caller who may not edit. */
  shelf?: ReactNode;
  /** The collision-inspection dialog — each board owns its own inspection, so it passes a wired node. */
  dialog: ReactNode;
  /** The shared drag overlay (combined passes `placementsByCohort`; single does not). */
  overlay: ReactNode;
};

/**
 * The shared board scaffold the one planner board renders into: ONE `DragDropProvider` (with the
 * shared `PLUGINS`, or `READ_ONLY_PLUGINS` for a caller who may not edit), the flex column, and the 3-column `auto | minmax(0,1fr) | auto` grid (palette |
 * board | shelf), with the dialog + overlay as siblings inside the provider. The board supplies its
 * slot content; the `focus`-conditioned variation lives OUTSIDE the shell:
 *
 * - focus mode keeps the full-screen `empty` early-return (it never renders `BoardShell` then);
 * - the `header` is a fragment: `PlanSummaryBar` (counts = the focused cohort's, or the sum in
 *   combined), the active-lens bar while lens criteria exist, and the lens's live region;
 * - the `center` carries up-to-2 error banners (the hidden cohort never errors in focus) + the grid;
 * - the `overlay` always passes `placementsByCohort`;
 * - the board owns its inspection wiring and passes a fully-built `dialog`;
 * - a read-only board (S-405) omits `palette` and `shelf`, and the grid collapses to the board
 *   column alone — a lone child in the 3-column template would land in the `auto` palette track
 *   and size to the timetable's full width instead of scrolling.
 */
export default function BoardShell({
  canEdit,
  onDragStart,
  onDragEnd,
  gridDataSlot,
  header,
  palette,
  center,
  shelf,
  dialog,
  overlay,
}: Props) {
  const sideColumns = palette !== undefined || shelf !== undefined;
  return (
    <DragDropProvider plugins={canEdit ? PLUGINS : READ_ONLY_PLUGINS} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 flex-col">
        {header}

        {/* `minmax(0,1fr)` on the board column (not bare `1fr`, whose min is min-content): lets the
            timetable track shrink + scroll instead of forcing the grid wider than the viewport — so
            the `auto` palette/shelf columns are never cropped when both are expanded. */}
        <div
          data-slot={gridDataSlot}
          className={cn(
            "grid min-h-0 flex-1 gap-3 p-3",
            sideColumns ? "lg:grid-cols-[auto_minmax(0,1fr)_auto]" : "lg:grid-cols-[minmax(0,1fr)]",
          )}
        >
          {palette}
          {center}
          {shelf}
        </div>
      </div>
      {dialog}
      {overlay}
    </DragDropProvider>
  );
}

// Disable the drop "return" animation. A palette course is *copied* onto the grid — its source stays
// in the palette — so dnd-kit's default animation flies the drag feedback back to the palette, which
// reads as "the drop bounced / failed." With the chip already placed optimistically, the feedback
// should just vanish at the drop point. One shared const for both boards (was byte-identical in each).
const PLUGINS = defaultPreset.plugins.map((plugin) =>
  plugin === Feedback ? Feedback.configure({ dropAnimation: null }) : plugin,
);

// A read-only board (S-405) still registers its cells and chips as draggables, disabled. dnd-kit's
// Accessibility plugin decorates every registered draggable, enabled or not: a tab stop, `role=button`,
// "draggable" with pick-up instructions, and `aria-disabled` — which every control inside inherits, so
// a viewer's Group/Ungroup and collision badge would be announced as unavailable. With nothing to drag,
// the plugin has nothing to announce, so a viewer's board runs without it.
const READ_ONLY_PLUGINS = PLUGINS.filter((plugin) => plugin !== Accessibility);
