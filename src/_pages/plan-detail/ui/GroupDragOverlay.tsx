import { DragOverlay } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import type { DragData } from "../model/drag";
import type { PlannerGrouping } from "../model/grouping";
import type { LocalPlacement } from "../model/placement";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
  placements: LocalPlacement[];
};

/**
 * Pointer-following feedback for whole-group and whole-slot drags: a compact clone of the
 * dragged set (header + member names). While this overlay is mounted, the Feedback plugin
 * uses it as the moving element and leaves the source in place (no placeholder gap).
 * Course/placement drags keep their default source-element feedback — the overlay disables
 * itself for those kinds.
 */
export default function GroupDragOverlay({ groupings, names, placements }: Props) {
  return (
    <DragOverlay dropAnimation={null} disabled={(source) => !isOverlayKind(source?.data)}>
      {(source) => {
        const data = source.data as DragData;
        if (data.kind === "grouping") {
          const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
          return grouping ? <OverlayCard memberIds={grouping.memberIds} names={names} /> : null;
        }
        if (data.kind === "bundle") {
          const memberIds = placements
            .filter((placement) => placement.day === data.day && placement.period === data.period)
            .map((placement) => placement.courseId);
          return memberIds.length > 0 ? <OverlayCard memberIds={memberIds} names={names} /> : null;
        }
        return null;
      }}
    </DragOverlay>
  );
}

function OverlayCard({ memberIds, names }: { memberIds: string[]; names: Record<string, string> }) {
  return (
    <div data-slot="group-drag-overlay" className="bg-background w-64 rounded-lg border shadow-lg">
      <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
        <GripVertical className="text-muted-foreground size-4" />
        <span>{memberIds.length} courses</span>
      </div>
      <ul className="space-y-1 px-2 pb-2">
        {memberIds.map((courseId) => (
          <li key={courseId} className="truncate rounded-md border px-2 py-1.5 text-sm">
            {names[courseId] ?? courseId}
          </li>
        ))}
      </ul>
    </div>
  );
}

function isOverlayKind(data: unknown): boolean {
  const kind = (data as DragData | undefined)?.kind;
  return kind === "grouping" || kind === "bundle";
}
