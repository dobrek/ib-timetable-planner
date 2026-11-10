import { toast } from "sonner";
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/shared/ui";
import type { PasswordReveal } from "../model/schemas";

type Props = {
  /** The password to show, or null when closed. */
  reveal: PasswordReveal | null;
  onClose: () => void;
};

const COPIED = "Password copied";
const NOT_COPIED = "Couldn't copy. Select the password and copy it by hand.";

/**
 * Shows a temporary password once (S-409). It can only be closed with the button: a click outside
 * or Escape would lose a password nobody has copied yet. It is not shown again and cannot be
 * recovered; a lost one is replaced with "Re-issue password".
 */
export default function TemporaryPasswordDialog({ reveal, onClose }: Props) {
  return (
    <Dialog open={reveal !== null}>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
        }}
        onInteractOutside={(event) => {
          event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>Temporary password</DialogTitle>
          <DialogDescription>
            Give this to {reveal?.email} yourself. It will not be shown again. They choose their own password at their
            first sign-in; until then they have no access.
          </DialogDescription>
        </DialogHeader>

        <output
          aria-label="Password to hand over"
          className="bg-muted text-foreground block rounded-md px-3 py-2 font-mono text-base break-all select-all"
        >
          {reveal?.password}
        </output>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (reveal) void copy(reveal.password);
            }}
          >
            Copy password
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const copy = async (password: string): Promise<void> => {
  try {
    await navigator.clipboard.writeText(password);
    toast.success(COPIED);
  } catch {
    toast.error(NOT_COPIED);
  }
};
