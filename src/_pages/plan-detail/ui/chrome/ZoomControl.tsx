import { RotateCcw } from "lucide-react";
import { Button, Slider } from "@/shared/ui";
import { MAX_ZOOM, MIN_ZOOM, ZOOM_STEP } from "../../lib/board-zoom";

type Props = {
  zoom: number;
  setZoom: (level: number) => void;
};

/**
 * The Zoom section of the Board settings popover: a continuous slider bound to the persisted level, a
 * live `%` readout, and a Reset-to-100% button. Manual-only (Fit was cut); everything is built from
 * token-based `Slider` / `Button` variants so the semantic-token rule holds. The slider carries an
 * accessible name and Reset exposes role + name for the e2e contract (`ui-conventions.md`).
 */
export default function ZoomControl({ zoom, setZoom }: Props) {
  return (
    <div data-slot="zoom-control" className="flex items-center gap-3">
      <Slider
        aria-label="Zoom level"
        className="flex-1"
        value={[zoom]}
        min={MIN_ZOOM}
        max={MAX_ZOOM}
        step={ZOOM_STEP}
        onValueChange={([level]) => {
          setZoom(level);
        }}
      />
      <span className="text-muted-foreground w-11 text-right text-sm tabular-nums">{Math.round(zoom * 100)}%</span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-8"
        title="Reset zoom to 100%"
        aria-label="Reset zoom to 100%"
        onClick={() => {
          setZoom(1);
        }}
      >
        <RotateCcw />
      </Button>
    </div>
  );
}
