import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/shared/ui";
import type { ScoreboardSection } from "../model/scoreboard";
import { MetricHelp } from "./MetricHelp";

/**
 * One section table. The longest is 18 rows, which fits a desktop viewport, so the table simply grows
 * to its full height and the page scrolls — no bounded container, no sticky header row.
 *
 * **If a vertical freeze is ever wanted back, it needs an explicit `max-h` on the container and it
 * fails SILENTLY without one.** The DS `Table` wraps itself in `div[data-slot=table-container]` with
 * `overflow-x-auto`; per the CSS overflow spec a non-`visible` value on one axis computes the other to
 * `auto`, so that div is *already* a scroll container on both axes — it just has no height constraint
 * and therefore never scrolls vertically. A `sticky top-0` on `<TableHead>` resolves against THAT div,
 * not the viewport, and quietly does nothing.
 *
 * The metric-label column stays frozen, and that is a *horizontal* concern, unrelated to row count: a
 * cohort section is 2N columns wide, so at three or four plans it scrolls sideways and the row label
 * would slide out of view — leaving a column of numbers naming nothing. It works against the container's
 * own `overflow-x-auto`, so it needs no height bound. Sticky cells need an explicit background, or rows
 * scroll *through* them.
 */
export function ScoreboardTable({ section }: Props) {
  return (
    // Named, so the section is a landmark a screen reader can jump between — the page has five.
    <section aria-label={section.title} className="space-y-2">
      <h2 className="text-base font-semibold">{section.title}</h2>
      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="bg-background sticky left-0 z-10 border-r align-bottom">
                Metric
              </TableHead>
              {section.columns.map((column) => (
                <TableHead
                  key={`${column.planId}-${column.cohort ?? "plan"}`}
                  scope="col"
                  className="text-right align-bottom"
                >
                  <span className="block font-medium">{column.planName}</span>
                  {column.cohort ? (
                    <span className="text-muted-foreground block text-xs font-normal">{column.cohort}</span>
                  ) : null}
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {section.rows.map((row) => (
              <TableRow key={row.id}>
                {/* The row label is a header cell, not data — and with 2N columns, losing it to
                    horizontal scroll leaves a column of numbers naming nothing. */}
                <TableHead scope="row" className="bg-background sticky left-0 z-10 border-r">
                  <span className="inline-flex items-center gap-1.5">
                    {row.label}
                    {/* Only on the rows that need it. An icon on "Occupied slots" would be noise, and a
                        help affordance everywhere is a help affordance nowhere. */}
                    {row.help ? (
                      <MetricHelp title={row.label}>
                        {row.help.map((paragraph) => (
                          <p key={paragraph}>{paragraph}</p>
                        ))}
                      </MetricHelp>
                    ) : null}
                  </span>
                </TableHead>
                {/* The value, and nothing more. No delta, no colour, no arrow, no better/worse — fewer
                    teacher gaps is better and more golden cells is better, but this page does not say
                    so. It reports; the expert judges.

                    A link is not a judgement: the two worst-case rows name a person, and the link goes
                    to that person's timetable in that plan — the number says who, the timetable says
                    why. */}
                {row.cells.map((cell, index) => (
                  <TableCell key={`${row.id}-${String(index)}`} className="text-right tabular-nums">
                    {cell.href ? (
                      <a href={cell.href} className="underline underline-offset-4 hover:no-underline">
                        {cell.text}
                      </a>
                    ) : (
                      cell.text
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
