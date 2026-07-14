import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import type { ScoreboardSection } from "../model/deltas";

/**
 * One frozen-pane section table: sticky header row, sticky metric-label column, bounded height.
 *
 * **The sticky header does not work without a bounded container, and it fails SILENTLY.** The DS
 * `Table` wraps itself in `div[data-slot=table-container]` with `overflow-x-auto`; per the CSS overflow
 * spec a non-`visible` value on one axis computes the other to `auto`, so that div is *already* a
 * scroll container on both axes — it simply has no height constraint and therefore never scrolls
 * vertically. A naive `sticky top-0` on `<TableHead>` resolves against THAT div, not the viewport, and
 * quietly does nothing: it looks perfect in a short table and breaks in exactly the long one this page
 * is built to render.
 *
 * The height is applied through the `data-slot` selector because `Table` spreads `className` onto the
 * inner `<table>`, not onto the div it owns — selecting it is the only way to bound it from outside.
 * The class is written out in full, never interpolated: Tailwind scans source statically, so a
 * template-built class name emits no CSS and would reintroduce the very failure above.
 *
 * One cap serves every section. A section shorter than the cap simply never scrolls, so the 6-row
 * golden and cross-cohort tables show no scrollbar while the 18-row cohort scoreboard does.
 *
 * Sticky cells need an explicit background and z-index, or rows scroll *through* them. The corner cell
 * outranks both (z-30): it is sticky on both axes at once.
 */
export function ScoreboardTable({ section }: Props) {
  return (
    // Named, so the section is a landmark a screen reader can jump between — the page has five.
    <section aria-label={section.title} className="space-y-2">
      <h2 className="text-base font-semibold">{section.title}</h2>
      <div className="rounded-md border [&_[data-slot=table-container]]:max-h-[34rem] [&_[data-slot=table-container]]:overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="bg-background sticky top-0 left-0 z-30 border-r align-bottom">
                Metric
              </TableHead>
              {section.columns.map((column) => (
                <TableHead
                  key={`${column.planId}-${column.cohort ?? "plan"}`}
                  scope="col"
                  className="bg-background sticky top-0 z-20 text-right align-bottom"
                >
                  <span className="block font-medium">{column.planName}</span>
                  {column.cohort ? (
                    <span className="text-muted-foreground block text-xs font-normal">{column.cohort}</span>
                  ) : null}
                  {column.isBaseline ? (
                    <span className="text-muted-foreground block text-xs font-normal">baseline</span>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.rows.map((row) => (
              <TableRow key={row.id}>
                {/* The row label is a header cell, not data — and with 2N columns, losing it to
                    horizontal scroll is as bad as losing the plan name to vertical scroll. */}
                <TableHead scope="row" className="bg-background sticky left-0 z-10 border-r">
                  {row.label}
                </TableHead>
                {row.cells.map((cell, index) => (
                  <TableCell key={`${row.id}-${String(index)}`} className="text-right tabular-nums">
                    <span>{cell.text}</span>
                    {/* A signed delta, and nothing more. No colour, no arrow, no better/worse: fewer
                        teacher gaps is better and more golden cells is better, but this page does not
                        say so — direction is the expert's call. */}
                    {cell.deltaText === null ? null : (
                      <span className="text-muted-foreground ml-2 text-xs">{cell.deltaText}</span>
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  );
}

type Props = { section: ScoreboardSection };
