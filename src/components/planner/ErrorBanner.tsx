import { Button } from "@/components/ui/button";

type ErrorBannerProps = { message: string; onDismiss: () => void };

/** Dismissible alert surfacing a persistence error from the optimistic write path. */
export default function ErrorBanner({ message, onDismiss }: ErrorBannerProps) {
  return (
    <div
      role="alert"
      className="border-destructive/50 bg-destructive/10 text-destructive flex shrink-0 items-center justify-between rounded-md border px-3 py-2 text-sm"
    >
      <span>{message}</span>
      <Button
        type="button"
        variant="link"
        onClick={onDismiss}
        className="text-destructive h-auto p-0 text-xs underline"
      >
        Dismiss
      </Button>
    </div>
  );
}
