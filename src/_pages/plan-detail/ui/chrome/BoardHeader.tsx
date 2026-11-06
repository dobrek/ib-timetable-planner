import { type ReactNode } from "react";
import { UserRound } from "lucide-react";
import { creditText, UserCredit, type Credit } from "@/entities/user";
import { Button, CurrentPlanBadge, Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui";
import CohortSwitcher from "./CohortSwitcher";
import type { BoardSurface } from "../../lib/board-surface";

type BoardHeaderProps = {
  planName: string;
  isCurrent: boolean;
  /** Who created the plan (S-407); null when the route could not look it up, which shows nothing. */
  createdBy: Credit | null;
  planId: string;
  active: BoardSurface;
  children?: ReactNode;
};

/**
 * The board's heading row: plan name + surface switcher, with an optional trailing slot. Shared by
 * the populated board (`PlanSummaryBar`, which fills the slot with the counts + hint toggle) and the
 * focus-mode empty/compute-groupings state, so the heading stays identical across that transition.
 * `active` is the current `?focus=` surface (a cohort or combined). `isCurrent` adds the "Current"
 * badge after the name (S-404), and `createdBy` the creator's icon beside it (S-407), in every state,
 * since both render sites pass them.
 */
export default function BoardHeader({ planName, isCurrent, createdBy, planId, active, children }: BoardHeaderProps) {
  return (
    <div className="flex shrink-0 items-center gap-3 border-b px-3 py-2 print:hidden">
      <h1 className="text-foreground text-base font-semibold">{planName}</h1>
      {isCurrent && <CurrentPlanBadge />}
      {createdBy && <CreatorTooltip createdBy={createdBy} />}
      <CohortSwitcher planId={planId} active={active} />
      {children}
    </div>
  );
}

/**
 * Who created the plan, folded into an icon: the row is full of controls, and the creator is
 * something to look up rather than to read every time. Hover or focus shows the credit with the
 * email beneath the name (FR-413). The button's accessible name carries the whole credit, so a screen
 * reader hears it without opening anything. Touch opens no tooltip; the hub's "Created by" column
 * names every plan's creator.
 */
function CreatorTooltip({ createdBy }: { createdBy: Credit }) {
  const label = `Created by ${creditText(createdBy)}`;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          data-slot="plan-creator"
          aria-label={label}
          className="text-muted-foreground size-7"
        >
          <UserRound aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="start" sideOffset={4}>
        <span className="flex flex-col gap-1">
          <span className="opacity-70">Created by</span>
          <UserCredit credit={createdBy} variant="inverse" />
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
