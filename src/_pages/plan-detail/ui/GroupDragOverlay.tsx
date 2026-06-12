import { DragOverlay } from "@dnd-kit/react";
import { GripVertical } from "lucide-react";
import type { DragData } from "../model/drag";
import type { PlannerGrouping } from "../model/grouping";

type Props = {
  groupings: PlannerGrouping[];
  names: Record<string, string>;
};

/**
 * Pointer-following feedback for whole-group drags: a compact clone of the
 * grouping box (header + member names). While this overlay is mounted, the
 * Feedback plugin uses it as the moving element and leaves the source box in
 * the palette layout (no placeholder gap). Course/placement drags keep their
 * default source-element feedback — the overlay disables itself for those kinds.
 */
export default function GroupDragOverlay({ groupings, names }: Props) {
  return (
    <DragOverlay dropAnimation={null} disabled={(source) => dragKind(source?.data) !== "grouping"}>
      {(source) => {
        const data = source.data as DragData;
        if (data.kind !== "grouping") return null;
        const grouping = groupings.find((candidate) => candidate.id === data.groupingId);
        if (!grouping) return null;

        return (
          <div data-slot="group-drag-overlay" className="bg-background w-64 rounded-lg border shadow-lg">
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium">
              <GripVertical className="text-muted-foreground size-4" />
              <span>{grouping.memberIds.length} courses</span>
            </div>
            <ul className="space-y-1 px-2 pb-2">
              {grouping.memberIds.map((courseId) => (
                <li key={courseId} className="truncate rounded-md border px-2 py-1.5 text-sm">
                  {names[courseId] ?? courseId}
                </li>
              ))}
            </ul>
          </div>
        );
      }}
    </DragOverlay>
  );
}

function dragKind(data: unknown): DragData["kind"] | undefined {
  return (data as DragData | undefined)?.kind;
}
