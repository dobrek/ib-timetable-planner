import { type ReactNode } from "react";
import { Badge, Popover, PopoverTrigger } from "@/shared/ui";
import BoardHeader from "./BoardHeader";
import CoursesLeftPopover from "./CoursesLeftPopover";
import UndoRedoControls, { type UndoRedoControlsProps } from "./UndoRedoControls";
import type { CoursesLeftSummary } from "./courses-left-summary";
import type { BoardSurface } from "../../lib/board-surface";

type PlanSummaryBarProps = {
  planName: string;
  /** Assembled hours breakdown — headline totals + the per-cohort sections the popover renders. */
  summary: CoursesLeftSummary;
  /** Combined mode groups the popover rows under DP1/DP2 subheaders; focus mode shows one cohort. */
  combined: boolean;
  /** Number of parked (shelved) bundles — the always-visible durability cue. */
  parkedCount: number;
  /** Open the shelf drawer (the badge doubles as the expand affordance). */
  onExpandShelf: () => void;
  planId: string;
  /** The current `?focus=` surface (a cohort or combined), driving the switcher's active segment. */
  active: BoardSurface;
  /** Undo/redo stack state + triggers — rendered as toolbar buttons beside the trailing controls. */
  undoRedo?: UndoRedoControlsProps;
  /** Trailing controls (the lens trigger/picker + the board-settings menu) — the one header for every mode. */
  trailing?: ReactNode;
};

/** Slim board heading row: plan name + surface switcher + a parked-count cue + how many course hours
 *  still need placing (a Popover trigger revealing which courses), with the lens trigger and the
 *  board-settings menu trailing so there is one header for all modes. */
export default function PlanSummaryBar({
  planName,
  summary,
  combined,
  parkedCount,
  onExpandShelf,
  planId,
  active,
  undoRedo,
  trailing,
}: PlanSummaryBarProps) {
  const { hoursLeft, hoursOver } = summary;
  return (
    <BoardHeader planName={planName} planId={planId} active={active}>
      <div className="ml-auto flex items-center gap-3">
        {parkedCount > 0 && (
          <Badge asChild variant="secondary" className="cursor-pointer">
            <button
              type="button"
              data-slot="parked-badge"
              aria-label={`${parkedCount} parked — open shelf`}
              onClick={onExpandShelf}
            >
              <span className="tabular-nums">{parkedCount}</span> parked
            </button>
          </Badge>
        )}
        <HoursSummary summary={summary} combined={combined} hoursLeft={hoursLeft} hoursOver={hoursOver} />
        {undoRedo && <UndoRedoControls {...undoRedo} />}
        {trailing}
      </div>
    </BoardHeader>
  );
}

/**
 * The counter itself, by edge state: a plain non-interactive span only when nothing is missing AND
 * nothing is over-placed; otherwise a Popover trigger. The over suffix stays warning-toned and the
 * trigger stays clickable even when hours-left is zero, so the Over-placed section is reachable.
 */
function HoursSummary({
  summary,
  combined,
  hoursLeft,
  hoursOver,
}: {
  summary: CoursesLeftSummary;
  combined: boolean;
  hoursLeft: number;
  hoursOver: number;
}) {
  if (hoursLeft === 0 && hoursOver === 0) {
    return (
      <span data-slot="plan-summary" className="text-muted-foreground text-sm">
        <span className="text-foreground font-medium">All course hours placed</span>
      </span>
    );
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          data-slot="plan-summary"
          aria-label={`${ariaLabel(hoursLeft, hoursOver)} — show breakdown`}
          className="text-muted-foreground hover:decoration-foreground decoration-muted-foreground/50 cursor-pointer text-sm underline decoration-dotted underline-offset-4"
        >
          {hoursLeft > 0 ? (
            <>
              <span className="text-foreground font-medium tabular-nums">{hoursLeft}</span>{" "}
              {hoursLeft === 1 ? "hour" : "hours"} left to place
            </>
          ) : (
            <span className="text-foreground font-medium">All hours placed</span>
          )}
          {hoursOver > 0 && (
            <>
              {" · "}
              <span className="text-warning font-medium tabular-nums">{hoursOver}</span> over
            </>
          )}
        </button>
      </PopoverTrigger>
      <CoursesLeftPopover summary={summary} combined={combined} />
    </Popover>
  );
}

// Plain-text label for the trigger's accessible name (the toned markup above is decorative).
const ariaLabel = (hoursLeft: number, hoursOver: number): string => {
  const primary =
    hoursLeft > 0 ? `${hoursLeft} ${hoursLeft === 1 ? "hour" : "hours"} left to place` : "All hours placed";
  return hoursOver > 0 ? `${primary}, ${hoursOver} over` : primary;
};
