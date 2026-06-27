import { Copy, Inbox, Link, Trash2, Unlink } from "lucide-react";
import { SlotHeaderButton } from "./SlotHeaderButton";

type Props = {
  day: number;
  period: number;
  /** True when the cell behaves as one unit (>=2 occupants, not exploded) — drives toggle/trash state. */
  bundled: boolean;
  /** Show the group/ungroup toggle only when grouping is meaningful (>=2 occupants, grouped or exploded). */
  showToggle: boolean;
  /** Accessible label for the duplicate control — name-specific for a single occupant, generic for a bundle. */
  duplicateLabel: string;
  onToggleBundle: (day: number, period: number, bundled: boolean) => void;
  onDuplicateBundle: (day: number, period: number) => void;
  onLiftBundle: (day: number, period: number) => void;
  onRemoveBundle: (day: number, period: number) => void;
};

/**
 * The slot cell's control strip — rendered for every non-empty cell. It owns no state; `SlotCell`
 * resolves which controls apply and this composes them: a group/ungroup toggle (left, only when
 * grouping is meaningful), then a right-pinned duplicate (always) + bulk-remove trash (only while
 * bundled). Each control is a `SlotHeaderButton`, so adding/altering one is a one-line change here.
 */
export function SlotHeader({
  day,
  period,
  bundled,
  showToggle,
  duplicateLabel,
  onToggleBundle,
  onDuplicateBundle,
  onLiftBundle,
  onRemoveBundle,
}: Props) {
  return (
    <div data-slot="slot-header" className="flex items-center rounded px-0.5">
      {showToggle && (
        <SlotHeaderButton
          dataSlot="toggle-bundle"
          label={bundled ? "Ungroup slot" : "Group slot"}
          onClick={() => {
            onToggleBundle(day, period, bundled);
          }}
        >
          {bundled ? <Link className="size-3.5" /> : <Unlink className="size-3.5" />}
        </SlotHeaderButton>
      )}
      {/* Duplicate (always) + trash (bundled-only), pinned right. Duplicate shows for every
          non-empty cell — single or bundle — so ungrouping never hides it. */}
      <div className="ml-auto flex items-center gap-0.5">
        <SlotHeaderButton
          dataSlot="duplicate-slot"
          label={duplicateLabel}
          onClick={() => {
            onDuplicateBundle(day, period);
          }}
        >
          <Copy className="size-3.5" />
        </SlotHeaderButton>
        <SlotHeaderButton
          dataSlot="lift-to-shelf"
          label="Lift to shelf"
          onClick={() => {
            onLiftBundle(day, period);
          }}
        >
          <Inbox className="size-3.5" />
        </SlotHeaderButton>
        {bundled && (
          <SlotHeaderButton
            dataSlot="remove-bundle"
            tone="destructive"
            label="Remove all from slot"
            onClick={() => {
              onRemoveBundle(day, period);
            }}
          >
            <Trash2 className="size-3.5" />
          </SlotHeaderButton>
        )}
      </div>
    </div>
  );
}
