import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";

type Props = {
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** data-slot on the 3-column grid. The one board passes "planner-board" in every mode. */
  gridDataSlot: string;
  /** Header block above the grid: the `PlanSummaryBar` fragment (plus lens bar / live region). */
  header: ReactNode;
  /** 1st column — the one palette panel (`CombinedPalettePanel`, with an optional cohort switcher). */
  palette: ReactNode;
  /** 2nd column (the board column): error banner(s), optional hint toggle, and the grid. */
  center: ReactNode;
  /** 3rd column — the shelf. */
  shelf: ReactNode;
  /** The collision-inspection dialog — each board owns its own inspection, so it passes a wired node. */
  dialog: ReactNode;
  /** The shared drag overlay (combined passes `placementsByCohort`; single does not). */
  overlay: ReactNode;
};

/**
 * The shared board scaffold the one planner board renders into: ONE `DragDropProvider` (with the
 * shared `PLUGINS`), the flex column, and the 3-column `auto | minmax(0,1fr) | auto` grid (palette |
 * board | shelf), with the dialog + overlay as siblings inside the provider. The board supplies its
 * slot content; the `focus`-conditioned variation lives OUTSIDE the shell:
 *
 * - focus mode keeps the full-screen `empty` early-return (it never renders `BoardShell` then);
 * - the `header` is a fragment: `PlanSummaryBar` (counts = the focused cohort's, or the sum in
 *   combined), the active-lens bar while lens criteria exist, and the lens's live region;
 * - the `center` carries up-to-2 error banners (the hidden cohort never errors in focus) + the grid;
 * - the `overlay` always passes `placementsByCohort`;
 * - the board owns its inspection wiring and passes a fully-built `dialog`.
 */
export default function BoardShell({
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
  return (
    <DragDropProvider plugins={PLUGINS} onDragStart={onDragStart} onDragEnd={onDragEnd}>
      <div className="flex min-h-0 flex-1 flex-col">
        {header}

        {/* `minmax(0,1fr)` on the board column (not bare `1fr`, whose min is min-content): lets the
            timetable track shrink + scroll instead of forcing the grid wider than the viewport — so
            the `auto` palette/shelf columns are never cropped when both are expanded. */}
        <div data-slot={gridDataSlot} className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
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
