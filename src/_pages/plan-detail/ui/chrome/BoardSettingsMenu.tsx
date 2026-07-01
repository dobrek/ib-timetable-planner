import { Settings } from "lucide-react";
import { Button, Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import ZoomControl from "./ZoomControl";
import DragHintModeToggle from "./DragHintModeToggle";
import type { HintMode } from "../../lib/drag-hint-mode";

type Props = {
  zoom: number;
  setZoom: (level: number) => void;
  hintMode: HintMode;
  setHintMode: (mode: HintMode) => void;
};

/**
 * The single board-settings affordance in the top bar: a gear button opening a popover with two
 * sections — Zoom (the manual slider + Reset) and the relocated While-dragging drag-hint toggle (which
 * carries its own label). The popover keeps the default dismiss behavior: it stays open during a slider
 * drag and closes on outside click / Escape.
 */
export default function BoardSettingsMenu({ zoom, setZoom, hintMode, setHintMode }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8"
          title="Board settings"
          aria-label="Board settings"
        >
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-4">
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium">Zoom</span>
          <ZoomControl zoom={zoom} setZoom={setZoom} />
        </div>
        <DragHintModeToggle mode={hintMode} onChange={setHintMode} />
      </PopoverContent>
    </Popover>
  );
}
