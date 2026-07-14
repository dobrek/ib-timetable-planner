import { Badge } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import type { GridShape } from "../model/drift-tier";
import type { DriftReport } from "../api/load-comparison";

/**
 * The **sole** guard against misreading a drifted or grid-mismatched comparison. Not decorative.
 *
 * The page renders every row and lets the expert judge, so this banner is the only thing standing
 * between a reader and an apples-to-oranges number. What it must convey is therefore not *what changed*
 * but *which numbers stopped meaning what they say* — the catalogs differ, so the catalog-dependent
 * metrics are counting different populations, while the ones that fold over placements and the grid
 * alone still compare.
 *
 * It deliberately does **not** enumerate the changes. An earlier cut printed per-category counts ("4
 * courses removed, 61 students added, 652 choices added…"), which between two genuinely different plans
 * is a wall of numbers that still cannot say *which* course or *which* student — that would take a
 * second table, not a banner. A count the reader cannot act on is noise dressed as diligence.
 *
 * The wording is directional but not judgemental: the difference is stated *relative to the first-listed
 * plan* because a comparison needs an order, not because that plan is the correct one. Neither is a
 * baseline; nothing here is measured against anything.
 *
 * Slice-local rather than `shared/ui`: there is no React `Alert` component (only `AlertDialog`, a
 * modal, and `Banner.astro`, which cannot mount inside a React island), and this has one consumer.
 */
export function DriftBanner({ reports }: Props) {
  const drifted = reports.filter((report) => report.tier !== "clean");
  // A clean comparison says nothing. Silence is the signal.
  if (drifted.length === 0) return null;

  return (
    <div className="space-y-2">
      {drifted.map((report) => (
        <DriftNotice key={report.planId} report={report} />
      ))}
    </div>
  );
}

type Props = { reports: DriftReport[] };

function DriftNotice({ report }: { report: DriftReport }) {
  const incomparable = report.tier === "incomparable";

  return (
    <div
      role="status"
      data-tier={report.tier}
      className={cn(
        "rounded-md border p-3 text-sm",
        incomparable ? "border-destructive bg-destructive/10 text-foreground" : "bg-muted/50 text-foreground",
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={incomparable ? "destructive" : "secondary"}>
          {incomparable ? "Not comparable" : "Catalog drift"}
        </Badge>
        <span className="font-medium">{report.planName}</span>
      </div>

      {incomparable ? (
        <p className="mt-2">
          The board shape differs from <strong>{report.referenceName}</strong> ({shape(report.grid.reference)} vs{" "}
          {shape(report.grid.other)}). Board-shape, day-edge, slot-census and week-symmetry metrics are{" "}
          <strong>not comparable</strong> between these plans.
        </p>
      ) : (
        <p className="mt-2">
          The catalog is <strong>not identical</strong> to <strong>{report.referenceName}</strong>&apos;s — different
          courses, teachers, students, choices or availability. Catalog-dependent metrics (completeness, students, slot
          census, teachers, subjects) are counting different populations, so they are apples-to-oranges; board shape,
          daily load, week symmetry, adjacency and spread still compare — they fold over placements and the grid alone.
        </p>
      )}
    </div>
  );
}

const shape = ({ days, periods }: GridShape): string => `${String(days)}×${String(periods)}`;
