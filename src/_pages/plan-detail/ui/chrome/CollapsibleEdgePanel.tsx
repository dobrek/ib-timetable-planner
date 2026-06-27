import type { ReactNode, Ref } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@/shared/lib/class-names";
import { Button } from "@/shared/ui";

type Props = {
  /** Rail edge + collapse-chevron direction: `left` = palette (1st column), `right` = shelf (3rd). */
  side: "left" | "right";
  /** Identity icon, shown in both the collapsed rail and the expanded header. */
  icon: LucideIcon;
  /** Expanded-header text ("Groupings" / "Shelf"). */
  label: string;
  /** Lowercase noun for the rail/collapse aria-labels + the per-control data-slots ("palette" / "shelf"). */
  name: string;
  /** Plural noun completing the collapsed-rail accessible name: "Open palette (N groupings)". */
  countNoun: string;
  count: number;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Tailwind width for the expanded panel ("w-64" palette / "w-60" shelf); the rail is always `w-9`. */
  openWidthClass: string;
  /** data-slot identity for the root aside ("planner-palette" / "shelf-drawer"). */
  dataSlot: string;
  /** aria-label on the root aside (role=complementary). Shelf is named "Shelf"; the palette is unnamed. */
  ariaLabel?: string;
  /** Extra classes on the root aside — the shelf passes its border/bg + the conditional drop ring. */
  className?: string;
  /** Extra classes on the collapsed rail button — the palette puts its border/bg here (its aside has none). */
  railClassName?: string;
  /** Extra classes on the expanded body wrapper — gap + padding differ per side (palette `gap-6`, shelf `gap-3 p-3`). */
  bodyClassName?: string;
  /** Ref on the root aside — the shelf attaches its island-wide droppable here so the whole box is a drop target. */
  containerRef?: Ref<HTMLElement>;
  /** Right-aligned header controls before the collapse chevron (shelf: the pin button). */
  headerActions?: ReactNode;
  /** Disable the collapse control (shelf: when pinned). */
  collapseDisabled?: boolean;
  /** title on the collapse control (shelf: "Unpin to collapse" / "Collapse shelf"). */
  collapseTitle?: string;
  /** Rendered below the header, above the body, expanded-only — the combined palette's cohort Tabs. */
  toolbar?: ReactNode;
  /** Body: the palette filter+list, or the shelf's parked cards. */
  children: ReactNode;
};

/**
 * The one collapsible edge drawer that both the palette (left) and the shelf (right) compose. One
 * width-animated `<aside>` (rail `w-9` ↔ open) whose collapsed rail and expanded body BOTH stay
 * mounted, toggled by display class — so the swap never remounts, dnd-kit draggable sources survive
 * a collapse, and the palette's filter selection is preserved across a collapse/expand cycle. The
 * expanded section is header (icon + label + count + `headerActions` + collapse chevron) → optional
 * `toolbar` (below the header, expanded-only — this is what fixes the combined palette-header
 * hierarchy: the cohort switcher sits *under* the panel's own header, not floating above it) → body.
 *
 * Presentational + dnd-agnostic: the shelf passes its `useDroppable` ref via `containerRef` and folds
 * its drop ring into `className`, so the whole bordered aside (rail + body) is the drop target exactly
 * as before; the palette passes neither. The bordered "box" lives on different elements per side
 * (palette: the rail; shelf: the aside), so the skin is parameterized via `className`/`railClassName`/
 * `bodyClassName` while the structure + ARIA + collapse mechanics are shared.
 */
export default function CollapsibleEdgePanel({
  side,
  icon: Icon,
  label,
  name,
  countNoun,
  count,
  collapsed,
  onCollapsedChange,
  openWidthClass,
  dataSlot,
  ariaLabel,
  className,
  railClassName,
  bodyClassName,
  containerRef,
  headerActions,
  collapseDisabled,
  collapseTitle,
  toolbar,
  children,
}: Props) {
  const CollapseChevron = side === "left" ? ChevronLeft : ChevronRight;

  return (
    <aside
      ref={containerRef}
      data-slot={dataSlot}
      data-collapsed={collapsed}
      aria-label={ariaLabel}
      className={cn(
        "flex max-h-full min-h-0 shrink-0 flex-col overflow-hidden",
        "transition-[width] duration-200 motion-reduce:transition-none",
        collapsed ? "w-9" : openWidthClass,
        className,
      )}
    >
      {/* Idle rail: a full-height button framing the count; the whole thing expands the panel. Toggle
          display via the class (not the `hidden` attr) so a `.flex` utility can't override it; `hidden`
          drops it from layout + the a11y tree, so the rail and body are never both present. */}
      <button
        type="button"
        data-slot={`${name}-expand`}
        aria-label={`Open ${name} (${count} ${countNoun})`}
        onClick={() => {
          onCollapsedChange(false);
        }}
        className={cn(
          "text-muted-foreground hover:text-foreground flex-col items-center gap-2 py-3",
          collapsed ? "flex flex-1" : "hidden",
          railClassName,
        )}
      >
        <Icon className="size-4" />
        <span className="text-xs font-medium tabular-nums">{count}</span>
      </button>

      <div className={cn("min-h-0 flex-1 flex-col", collapsed ? "hidden" : "flex", bodyClassName)}>
        <header className="flex shrink-0 items-center gap-2 text-sm font-medium">
          <Icon className="text-muted-foreground size-4" />
          <span>{label}</span>
          <span data-slot={`${name}-count`} className="text-muted-foreground tabular-nums">
            {count}
          </span>
          <div className="ml-auto flex items-center gap-0.5">
            {headerActions}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-slot={`${name}-collapse`}
              aria-label={`Collapse ${name}`}
              disabled={collapseDisabled}
              title={collapseTitle}
              onClick={() => {
                onCollapsedChange(true);
              }}
              className={cn(EDGE_PANEL_ICON_BUTTON, "disabled:pointer-events-none disabled:opacity-40")}
            >
              <CollapseChevron className="size-3.5" />
            </Button>
          </div>
        </header>
        {toolbar}
        {children}
      </div>
    </aside>
  );
}

/** The header icon-button recipe (collapse chevron, shelf pin). One source; the shelf imports it for its pin. */
export const EDGE_PANEL_ICON_BUTTON =
  "text-muted-foreground hover:bg-accent hover:text-accent-foreground size-5 rounded";
