import { CircleCheck, CircleDashed, MoreHorizontal, X } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui";

type Props = {
  /** The chip's course display name — names the trigger and the Remove item for accessibility. */
  name: string;
  /** Current flag state — picks the contextual first item (Mark as optional ⇄ Accept). */
  isOptional: boolean;
  /** Disables the trigger while the row's server id is unsettled (like the retired inline "×"). */
  pending: boolean;
  /** Controlled open state — owned by the chip, which disables its own drag while open. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSetOptional: (isOptional: boolean) => void;
  onRemove: () => void;
};

/**
 * The per-member "⋯" overflow menu — the one home for member verbs on an ungrouped chip:
 * **Mark as optional / Accept** (contextual) and **Remove** (the retired inline "×", migrated).
 * Catalog row-actions precedent (`CourseTable` etc.), but this trigger sits INSIDE a dnd-kit
 * draggable: pointer-down must not bubble into drag activation, and the chip disables its own
 * `useDraggable` while the menu is open (the content portals outside the dnd tree, so an
 * anchored menu must never be orphaned by a mid-open drag). Open state is therefore controlled
 * by the chip, not local.
 */
export function ChipMenu({ name, isOptional, pending, open, onOpenChange, onSetOptional, onRemove }: Props) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          data-slot="chip-menu"
          aria-label={`Actions for ${name}`}
          disabled={pending}
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          className="text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded"
        >
          <MoreHorizontal className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {isOptional ? (
          <DropdownMenuItem
            onSelect={() => {
              onSetOptional(false);
            }}
          >
            <CircleCheck aria-hidden="true" />
            Accept
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => {
              onSetOptional(true);
            }}
          >
            <CircleDashed aria-hidden="true" />
            Mark as optional
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          aria-label={`Remove ${name}`}
          onSelect={() => {
            onRemove();
          }}
        >
          <X aria-hidden="true" />
          Remove
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
