import { Button } from "@/shared/ui";

type Props = {
  count: number;
  onEdit: () => void;
  onClear: () => void;
};

/**
 * Persistent bar surfacing the live selection count — the only WYSIWYG indicator once
 * hidden selections are impossible — plus the entry point to the bulk-edit dialog. Renders
 * nothing when the selection is empty. Presentational; callbacks come from the island.
 */
export default function BulkActionBar({ count, onEdit, onClear }: Props) {
  if (count === 0) return null;

  return (
    <div className="border-border bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-2">
      <span className="text-foreground text-sm font-medium">{count} selected</span>
      <Button size="sm" onClick={onEdit}>
        Edit choices…
      </Button>
      <Button variant="ghost" size="sm" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
