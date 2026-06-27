import type { ReactNode } from "react";
import { DragDropProvider } from "@dnd-kit/react";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import { defaultPreset, Feedback } from "@dnd-kit/dom";

type Props = {
  onDragStart: (event: DragStartEvent) => void;
  onDragEnd: (event: DragEndEvent) => void;
  /** data-slot on the 3-column grid: "planner-board" (single) / "combined-board" (combined). */
  gridDataSlot: string;
  /** Top bar above the grid: the single board's PlanSummaryBar / the combined inline header + switcher. */
  header: ReactNode;
  /** 1st column — the palette (single `PlannerPalette` / `CombinedPalettePanel`). */
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
 * The shared board scaffold both planner boards render into: ONE `DragDropProvider` (with the shared
 * `PLUGINS`), the flex column, and the 3-column `auto | minmax(0,1fr) | auto` grid (palette | board |
 * shelf), with the dialog + overlay as siblings inside the provider. Each board supplies its slot
 * content; the known divergences are reconciled OUTSIDE the shell:
 *
 * - the single board keeps its full-screen `empty` early-return (it never renders `BoardShell` then);
 * - the `header` slot differs (single: `PlanSummaryBar`; combined: inline header + `CohortSwitcher`);
 * - the `center` slot carries 1 (single) vs up-to-2 (combined) error banners, and the hint toggle in
 *   different places (single: above the grid; combined: in the header);
 * - the `overlay` differs only by combined's `placementsByCohort`;
 * - each board owns its own inspection wiring and passes a fully-built `dialog`.
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
        <div data-slot={gridDataSlot} className="grid min-h-0 flex-1 gap-6 p-6 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
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
