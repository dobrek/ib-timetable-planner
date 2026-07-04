import { useRef } from "react";
import { Check } from "lucide-react";
import { subjectChipClass } from "@/shared/config";
import { cn } from "@/shared/lib/class-names";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/shared/ui";
import { criterionId, type LensCriterion, type LensOption, type LensOptionGroups } from "../../model/lens";
import LensTrigger from "./LensTrigger";

type Props = {
  open: boolean;
  setOpen: (open: boolean) => void;
  options: LensOptionGroups;
  criteria: LensCriterion[];
  onToggle: (criterion: LensCriterion) => void;
  /** The currently highlighted candidate — doubles as cmdk's controlled highlight value. */
  preview: LensCriterion | null;
  /** Live preview: the highlighted candidate changed (null when the highlight leaves the list). */
  onPreview: (criterion: LensCriterion | null) => void;
};

/**
 * The lens's anchored picker: the fake-input trigger and a Command-in-Popover multi-select over
 * three kind groups (the `MultiSelect` idiom) as ONE Radix Popover, so the board stays visible
 * while browsing. Items stay open on select (check/uncheck live); arrowing previews the highlighted
 * candidate via cmdk's `onValueChange`. Item identity: `value` = `criterionId` (unique across
 * cohorts) while text matching routes through `keywords` (label + cohort tag) — duplicate display
 * names exist across cohorts on the combined view.
 */
export default function LensPicker({ open, setOpen, options, criteria, onToggle, preview, onPreview }: Props) {
  // cmdk auto-highlights the first item on open/filter — without this gate, merely opening the
  // picker would dim the whole board against the first course. Preview only follows highlights the
  // user caused (arrow keys, typing, pointer), tracked in capture phase so the arming runs before
  // cmdk's own handlers move the highlight.
  const interacted = useRef(false);
  const checkedIds = new Set(criteria.map(criterionId));
  const criterionByValue = new Map(
    [...options.courses, ...options.teachers, ...options.students].map(
      (option) => [criterionId(option.criterion), option.criterion] as const,
    ),
  );
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        interacted.current = false;
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <LensTrigger criteriaCount={criteria.length} />
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        {/* cmdk fires `onValueChange` (highlight changes) only in CONTROLLED mode — the preview
            criterion is the backing state, "" when nothing is highlighted. */}
        <Command
          value={preview ? criterionId(preview) : ""}
          filter={keywordFilter}
          onKeyDownCapture={() => {
            interacted.current = true;
          }}
          onPointerMoveCapture={() => {
            interacted.current = true;
          }}
          onValueChange={(value) => {
            if (!interacted.current) return;
            onPreview(criterionByValue.get(value) ?? null);
          }}
        >
          <CommandInput placeholder="Search courses, teachers, students…" autoComplete="off" />
          <CommandList className="max-h-[20rem]">
            <CommandEmpty>No matching courses, teachers, or students.</CommandEmpty>
            <LensOptionGroup heading="Courses" options={options.courses} checkedIds={checkedIds} onToggle={onToggle} />
            <LensOptionGroup
              heading="Teachers"
              options={options.teachers}
              checkedIds={checkedIds}
              onToggle={onToggle}
            />
            <LensOptionGroup
              heading="Students"
              options={options.students}
              checkedIds={checkedIds}
              onToggle={onToggle}
            />
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

/** One kind group: checkable, stay-open items with the course color swatch and combined cohort tag. */
function LensOptionGroup({
  heading,
  options,
  checkedIds,
  onToggle,
}: {
  heading: string;
  options: LensOption[];
  checkedIds: Set<string>;
  onToggle: (criterion: LensCriterion) => void;
}) {
  if (options.length === 0) return null;
  return (
    <CommandGroup heading={heading}>
      {options.map((option) => {
        const id = criterionId(option.criterion);
        const checked = checkedIds.has(id);
        return (
          <CommandItem
            key={id}
            value={id}
            keywords={keywordsOf(option)}
            onSelect={() => {
              onToggle(option.criterion);
            }}
          >
            <Check className={cn("size-4 shrink-0", checked ? "opacity-100" : "opacity-0")} aria-hidden="true" />
            {option.color != null && (
              <span
                className={cn("size-2.5 shrink-0 rounded-sm border", subjectChipClass(option.color))}
                aria-hidden="true"
              />
            )}
            <span className="truncate">{option.label}</span>
            {option.cohortTag !== undefined && (
              <span className="text-muted-foreground ml-auto shrink-0 text-xs">{option.cohortTag}</span>
            )}
          </CommandItem>
        );
      })}
    </CommandGroup>
  );
}

/** What typing matches against — never the opaque `criterionId` value (uuid noise). */
const keywordsOf = (option: LensOption): string[] =>
  option.cohortTag !== undefined ? [option.label, option.cohortTag] : [option.label];

/** Substring match over keywords only: item values are opaque ids and must not affect ranking. */
const keywordFilter = (_value: string, search: string, keywords?: string[]): number =>
  (keywords ?? []).join(" ").toLowerCase().includes(search.toLowerCase()) ? 1 : 0;
