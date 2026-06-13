import { CircleCheck, TriangleAlert } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui";
import type { HintMode } from "../lib/drag-hint-mode";

type Props = {
  mode: HintMode;
  onChange: (mode: HintMode) => void;
};

/**
 * Per-device segmented control for how the grid encodes drag hints. It only affects
 * feedback shown *while dragging*, so the label says so. The board persists the choice.
 */
export default function DragHintModeToggle({ mode, onChange }: Props) {
  return (
    <div data-slot="drag-hint-mode-toggle" className="flex items-center gap-2 text-xs">
      <span className="text-muted-foreground">While dragging</span>
      <Tabs
        value={mode}
        onValueChange={(value) => {
          onChange(value as HintMode);
        }}
      >
        <TabsList>
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
