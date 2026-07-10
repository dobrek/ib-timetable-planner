import { BookOpen, GraduationCap, User, X } from "lucide-react";
import { subjectChipClass, type SubjectColor } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import {
  criterionId,
  type LensCounts,
  type LensCriterion,
  type LensKind,
  type LensOptionGroups,
} from "../../model/lens";

type Props = {
  criteria: LensCriterion[];
  /** `combineLensCounts` output over the VISIBLE cohorts (an off-screen criterion shows ·0). */
  counts: LensCounts;
  /** PLAN-WIDE display lookup (both cohorts), so an off-screen cohort's criterion still labels. */
  options: LensOptionGroups;
  onRemove: (criterion: LensCriterion) => void;
  onClearAll: () => void;
  onOpenPicker: () => void;
};

/**
 * The active-lens ("applied filters") bar under the summary bar, rendered by the shell only while
 * criteria exist: one chip per criterion (kind icon, course color swatch, label, `·N` count, `×`
 * remove), the union total (or the zero-match message explaining the fully-dimmed board), and Clear
 * all. Clicking a chip body reopens the picker. The `role="status"` live region deliberately does
 * NOT live here — this bar unmounts at zero criteria, which would silence the first-criterion and
 * lens-cleared announcements; the shell mounts `LensAnnouncer` permanently instead.
 */
export default function LensBar({ criteria, counts, options, onRemove, onClearAll, onOpenPicker }: Props) {
  const displayById = new Map(
    [...options.courses, ...options.teachers, ...options.students].map(
      (option) => [criterionId(option.criterion), option] as const,
    ),
  );
  return (
    <div
      data-slot="lens-bar"
      className="bg-background flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5 print:hidden"
    >
      {criteria.map((criterion) => {
        const id = criterionId(criterion);
        const display = displayById.get(id);
        return (
          <LensChip
            key={id}
            criterion={criterion}
            label={display?.label ?? criterion.key}
            color={display?.color ?? null}
            count={counts.byCriterion.get(id) ?? 0}
            onOpenPicker={onOpenPicker}
            onRemove={onRemove}
          />
        );
      })}
      <span data-slot="lens-total" className="text-muted-foreground ml-auto text-xs whitespace-nowrap">
        {totalText(counts.total)}
      </span>
      <button
        type="button"
        aria-label="Clear lens"
        onClick={onClearAll}
        className="text-muted-foreground hover:text-foreground cursor-pointer text-xs underline decoration-dotted underline-offset-4"
      >
        Clear all
      </button>
    </div>
  );
}

/** One criterion chip: kind icon + optional course swatch + label + `·N`, with its own remove. */
function LensChip({
  criterion,
  label,
  color,
  count,
  onOpenPicker,
  onRemove,
}: {
  criterion: LensCriterion;
  label: string;
  color: SubjectColor | null;
  count: number;
  onOpenPicker: () => void;
  onRemove: (criterion: LensCriterion) => void;
}) {
  const KindIcon = KIND_ICONS[criterion.kind];
  return (
    <span
      data-slot="lens-chip"
      className="border-input bg-secondary text-secondary-foreground flex items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-1.5 text-xs"
    >
      <button
        type="button"
        aria-label={`Edit lens criterion ${label}`}
        onClick={onOpenPicker}
        className="flex cursor-pointer items-center gap-1"
      >
        <KindIcon className="text-muted-foreground size-3 shrink-0" aria-hidden="true" />
        {color !== null && (
          <span className={cn("size-2.5 shrink-0 rounded-sm border", subjectChipClass(color))} aria-hidden="true" />
        )}
        <span className="max-w-40 truncate">{label}</span>
        <span className="text-muted-foreground tabular-nums">·{count}</span>
      </button>
      <button
        type="button"
        aria-label={`Remove ${label} from lens`}
        onClick={() => {
          onRemove(criterion);
        }}
        className="text-muted-foreground hover:bg-destructive/20 hover:text-destructive cursor-pointer rounded p-0.5"
      >
        <X className="size-3" aria-hidden="true" />
      </button>
    </span>
  );
}

/** The union total (placed chips) — doubles as the zero-match explanation slot. */
const totalText = (total: number): string =>
  total === 0 ? "No placements match the lens" : `${total} ${total === 1 ? "placement" : "placements"}`;

const KIND_ICONS: Record<LensKind, typeof BookOpen> = { course: BookOpen, teacher: User, student: GraduationCap };
