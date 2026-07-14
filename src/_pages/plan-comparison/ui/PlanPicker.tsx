import { useState } from "react";
import {
  Button,
  MultiSelect,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  type MultiSelectItem,
} from "@/shared/ui";
import { toCompareSearch } from "../lib/compare-params";

/**
 * Pick the plans and designate the baseline. N-ready by construction — the state is
 * `{ planIds[], baselineId }` from day one, and the scoreboard's frozen panes absorb the extra columns.
 *
 * **Changing the selection navigates.** The URL drives the SSR dataset (the loader runs server-side
 * against `Astro.url.searchParams`), so mutating client state would show a scoreboard that no longer
 * matches its own URL. Navigating keeps the comparison shareable and lets the browser own history —
 * the same stance the read-only plan views take.
 *
 * No ownership filter is needed: every policy on `plans` is `for all to authenticated using (true)`, so
 * every authenticated author reads every plan.
 */
export function PlanPicker({ plans, selectedIds, baselineId }: Props) {
  const [picked, setPicked] = useState<string[]>(selectedIds);
  const [baseline, setBaseline] = useState<string | null>(baselineId);

  const items: MultiSelectItem[] = plans.map((plan) => ({ id: plan.id, label: plan.name }));
  const pickedPlans = plans.filter((plan) => picked.includes(plan.id));
  // A baseline must be one of the picked plans; if the last pick removed it, fall back to the first.
  const effectiveBaseline =
    baseline !== null && picked.includes(baseline) ? baseline : picked.length > 0 ? picked[0] : null;

  const dirty = picked.join(",") !== selectedIds.join(",") || (effectiveBaseline ?? "") !== (baselineId ?? "");

  const apply = () => {
    const search = toCompareSearch({ planIds: picked, baselineId: effectiveBaseline });
    window.location.assign(search ? `/plans/compare?${search}` : "/plans/compare");
  };

  return (
    <section className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <span className="text-muted-foreground block text-xs font-medium">Plans</span>
        <MultiSelect
          items={items}
          selectedIds={picked}
          onChange={setPicked}
          trigger={picked.length === 0 ? "Pick plans to compare" : `${String(picked.length)} selected`}
          searchPlaceholder="Search plans…"
          emptyText="No plans found."
        />
      </div>

      <div className="space-y-1">
        <span className="text-muted-foreground block text-xs font-medium">Baseline</span>
        <Select value={effectiveBaseline ?? ""} onValueChange={setBaseline} disabled={pickedPlans.length === 0}>
          <SelectTrigger className="w-56">
            <SelectValue placeholder="Baseline plan" />
          </SelectTrigger>
          <SelectContent>
            {pickedPlans.map((plan) => (
              <SelectItem key={plan.id} value={plan.id}>
                {plan.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Button onClick={apply} disabled={picked.length === 0 || !dirty}>
        Compare
      </Button>
    </section>
  );
}

type Props = {
  /** Every plan an author may compare. */
  plans: { id: string; name: string }[];
  selectedIds: string[];
  baselineId: string | null;
};
