"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { ToggleGroup as ToggleGroupPrimitive } from "radix-ui";

import { cn } from "@/shared/lib/class-names";

const toggleGroupItemVariants = cva(
  "inline-flex items-center justify-center gap-1 font-medium whitespace-nowrap transition-colors outline-none hover:bg-accent hover:text-accent-foreground focus-visible:ring-ring/50 focus-visible:ring-2 focus-visible:ring-inset disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      size: {
        default: "h-9 px-3 text-sm",
        sm: "h-8 px-2 text-sm",
        xs: "px-1 text-xs",
      },
    },
    defaultVariants: { size: "default" },
  },
);

/** A segmented control. With `type="single"` Radix renders `radiogroup`/`radio` semantics. */
function ToggleGroup({ className, ...props }: React.ComponentProps<typeof ToggleGroupPrimitive.Root>) {
  return (
    <ToggleGroupPrimitive.Root
      data-slot="toggle-group"
      className={cn("border-border flex overflow-hidden rounded border", className)}
      {...props}
    />
  );
}

function ToggleGroupItem({
  className,
  size,
  ...props
}: React.ComponentProps<typeof ToggleGroupPrimitive.Item> & VariantProps<typeof toggleGroupItemVariants>) {
  return (
    <ToggleGroupPrimitive.Item
      data-slot="toggle-group-item"
      className={cn(toggleGroupItemVariants({ size }), className)}
      {...props}
    />
  );
}

export { ToggleGroup, ToggleGroupItem, toggleGroupItemVariants };
