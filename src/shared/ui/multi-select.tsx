import type * as React from "react";
import { Check, X } from "lucide-react";
import { cn } from "@/shared/lib/cn";
import { Badge } from "./badge";
import { Button } from "./button";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "./command";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";

export type MultiSelectItem = { id: string; label: string };

type MultiSelectProps = {
  items: readonly MultiSelectItem[];
  selectedIds: readonly string[];
  onChange: (ids: string[]) => void;
  /** Content of the outline trigger button. */
  trigger: React.ReactNode;
  triggerClassName?: string;
  triggerSize?: React.ComponentProps<typeof Button>["size"];
  /** Forwarded to the trigger button (e.g. an RHF `field.onBlur`). */
  onBlur?: () => void;
  searchPlaceholder: string;
  emptyText: string;
  /** Render the selection as removable badge chips below the trigger (default true). */
  showChips?: boolean;
};

/** Searchable popover multi-select with check marks and removable badge chips. */
export function MultiSelect({
  items,
  selectedIds,
  onChange,
  trigger,
  triggerClassName,
  triggerSize,
  onBlur,
  searchPlaceholder,
  emptyText,
  showChips = true,
}: MultiSelectProps) {
  const selected = new Set(selectedIds);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange([...next]);
  };

  const selectedItems = items.filter((item) => selected.has(item.id));

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <Button type="button" variant="outline" size={triggerSize} className={triggerClassName} onBlur={onBlur}>
            {trigger}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} autoComplete="off" />
            <CommandList>
              <CommandEmpty>{emptyText}</CommandEmpty>
              <CommandGroup>
                {items.map((item) => (
                  <CommandItem
                    key={item.id}
                    value={item.label}
                    onSelect={() => {
                      toggle(item.id);
                    }}
                  >
                    <Check
                      className={cn("mr-2", selected.has(item.id) ? "opacity-100" : "opacity-0")}
                      aria-hidden="true"
                    />
                    {item.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {showChips && selectedItems.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selectedItems.map((item) => (
            <Badge key={item.id} variant="secondary" className="gap-1">
              {item.label}
              <button
                type="button"
                aria-label={`Remove ${item.label}`}
                className="hover:text-foreground -mr-0.5 rounded-sm"
                onClick={() => {
                  toggle(item.id);
                }}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </>
  );
}
