import { CircleCheck, TriangleAlert } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";
import { isHintMode, type HintMode } from "../../lib/drag-hint-mode";

type Props = {
  mode: HintMode;
  onChange: (mode: HintMode) => void;
};

/**
 * Per-device segmented control for how the grid encodes drag hints. It only affects
 * feedback shown *while dragging*, so the label says so. The board persists the choice.
 *
 * Stacks vertically (label over a full-width segmented control) so it fits inside the Board settings
 * popover — its only home — instead of overflowing the way a horizontal row of two labelled tabs did.
 */
export default function DragHintModeToggle({ mode, onChange }: Props) {
  return (
    <div data-slot="drag-hint-mode-toggle" className="flex flex-col gap-2 text-xs">
      <span className="text-muted-foreground font-medium">While dragging</span>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          if (isHintMode(value)) onChange(value);
        }}
      >
        <TabsList className="w-full">
          <TabsTrigger value="dim-blocked">
            <TriangleAlert />
            Mark collisions
          </TabsTrigger>
          <TabsTrigger value="highlight-free">
            <CircleCheck />
            Highlight free
          </TabsTrigger>
        </TabsList>
      </Tabs>
    </div>
  );
}
