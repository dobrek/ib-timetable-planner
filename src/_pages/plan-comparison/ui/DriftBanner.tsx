import { Badge } from "@/shared/ui";
import { cn } from "@/shared/lib/class-names";
import { CATEGORIES, type CatalogDiff, type DiffCategory } from "../model/catalog-diff";
import type { DriftReport } from "../api/load-comparison";

/**
 * The **sole** guard against misreading a drifted or grid-mismatched comparison. Not decorative.
 *
 * The page renders every row and lets the expert judge, so this banner is the only thing standing
 * between a reader and an apples-to-oranges number. That is why it NAMES the drift ("3 courses added,
 * 1 teacher removed") rather than merely announcing it: a boolean tells you something is wrong but not
 * whether it's one renamed course — harmless — or a different student body, which invalidates half the
 * scoreboard.
 *
 * The wording is directional but not judgemental: differences are described *relative to the
 * first-listed plan* because a diff needs an order, not because that plan is the correct one. Neither
 * plan is a baseline; nothing here is measured against anything.
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
          The board shape differs from <strong>{report.referenceName}</strong> ({gridLabel(report.diff, "reference")} vs{" "}
          {gridLabel(report.diff, "other")}). Board-shape, day-edge, slot-census and week-symmetry metrics are{" "}
          <strong>not comparable</strong> between these plans.
        </p>
      ) : (
        <p className="mt-2">
          Catalog differs from <strong>{report.referenceName}</strong>: {describe(report.diff)}. Catalog-dependent
          metrics (completeness, students, slot census, teachers, subjects) are apples-to-oranges; board shape, daily
          load, week symmetry, adjacency and spread still compare — they fold over placements and the grid alone.
        </p>
      )}
    </div>
  );
}

const gridLabel = (diff: CatalogDiff, side: "reference" | "other"): string => {
  const { days, periods } = diff.grid[side];
  return `${String(days)}×${String(periods)}`;
};

/** "3 courses added, 1 teacher removed, availability differs" — the whole point of the structured diff. */
const describe = (diff: CatalogDiff): string => {
  const phrases = CATEGORIES.flatMap((category) => describeCategory(category, diff));
  return phrases.length > 0 ? phrases.join(", ") : "the grid differs";
};

const describeCategory = (category: DiffCategory, diff: CatalogDiff): string[] => {
  const { added, removed, changed } = diff[category];
  return [
    ...(added > 0 ? [`${String(added)} ${noun(category, added)} added`] : []),
    ...(removed > 0 ? [`${String(removed)} ${noun(category, removed)} removed`] : []),
    ...(changed > 0 ? [`${String(changed)} ${noun(category, changed)} changed`] : []),
  ];
};

const NOUNS: Record<DiffCategory, [singular: string, plural: string]> = {
  courses: ["course", "courses"],
  teachers: ["teacher", "teachers"],
  students: ["student", "students"],
  choices: ["choice", "choices"],
  availability: ["availability cell", "availability cells"],
};

const noun = (category: DiffCategory, count: number): string => NOUNS[category][count === 1 ? 0 : 1];
