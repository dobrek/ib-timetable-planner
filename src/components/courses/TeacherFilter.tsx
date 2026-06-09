import { Check, ListFilter, X } from "lucide-react";
import { Badge } from "@/shared/ui";
import { Button } from "@/shared/ui";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/shared/ui";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui";
import { cn } from "@/shared/lib/cn";
import type { TeacherOption } from "@/components/courses/types";

type TeacherFilterProps = {
  teachers: readonly TeacherOption[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
};

/**
 * Searchable multi-select over teachers. Empty selection = show all. Selected teachers
 * appear as removable badge chips beside the trigger. Token-styled (lessons rule #2).
 */
export function TeacherFilter({ teachers, selectedIds, onChange }: TeacherFilterProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const selectedTeachers = teachers.filter((teacher) => selected.has(teacher.id));

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="outline" size="sm" className="gap-2">
            <ListFilter aria-hidden="true" />
            Teacher
            {selected.size > 0 && (
              <Badge variant="secondary" className="ml-1">
                {selected.size}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search teachers…" autoComplete="off" />
            <CommandList>
              <CommandEmpty>No teachers found.</CommandEmpty>
              <CommandGroup>
                {teachers.map((teacher) => {
                  const isSelected = selected.has(teacher.id);
                  return (
                    <CommandItem
                      key={teacher.id}
                      value={teacher.label}
                      onSelect={() => {
                        toggle(teacher.id);
                      }}
                    >
                      <Check className={cn("mr-2", isSelected ? "opacity-100" : "opacity-0")} aria-hidden="true" />
                      {teacher.label}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {selectedTeachers.map((teacher) => (
        <Badge key={teacher.id} variant="secondary" className="gap-1">
          {teacher.label}
          <button
            type="button"
            aria-label={`Remove ${teacher.label} filter`}
            className="hover:text-foreground -mr-0.5 rounded-sm"
            onClick={() => {
              toggle(teacher.id);
            }}
          >
            <X className="size-3" aria-hidden="true" />
          </button>
        </Badge>
      ))}

      {selected.size > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            onChange([]);
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
