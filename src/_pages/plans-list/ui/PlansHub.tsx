import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Button,
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Toaster,
} from "@/shared/ui";
import type { PlanRow } from "../api/loader";
import type { IndicatorsByPlan } from "../model/job-progress-store";
import { useGenerationIndicators } from "../model/use-generation-indicators";
import { indicatorsForRow } from "../model/row-indicators";
import { announcementsFor } from "../model/generation-toasts";
import { canCompare, compareHref, EMPTY_SELECTION, toggleAllSelection, toggleId } from "../model/plan-selection";
import ClonePlanDialog from "./ClonePlanDialog";
import PlanIndicatorsCell from "./PlanIndicatorsCell";
import ComparePlansBar from "./ComparePlansBar";
import DeletePlanDialog from "./DeletePlanDialog";
import PlanFormDialog from "./PlanFormDialog";

type Props = {
  plans: PlanRow[];
};

/**
 * The application hub: every plan is a complete scenario (catalog + board), listed
 * with create-blank, clone (the primary creation path), rename, and delete.
 *
 * Still no derived metrics *per row* — a plan is not scored in isolation. Comparison is inherently
 * multi-plan, so it is driven by **ticking rows here** and pressing Compare, not by a picker on the
 * comparison page: that page renders strictly what its URL names, and a picker over on it would be
 * client state quietly disagreeing with SSR'd numbers.
 *
 * The **Activity** column is the one live thing on this page, and it lives here rather than on the
 * plan page for a structural reason: a CP-SAT solve runs for 12–20 minutes on a server, and FR-312
 * requires that watching it never contend with editing the board. There is no board on `/plans`, and
 * `PlansHub` is this page's only island — so the question of a poll re-rendering the grid cannot
 * arise, instead of being answered by a memoization argument nobody can verify by reading.
 */
export default function PlansHub({ plans }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PlanRow | null>(null);
  const [cloneSource, setCloneSource] = useState<PlanRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(EMPTY_SELECTION);

  const planIds = plans.map((plan) => plan.id);
  // Seeded from the SSR'd indicators, so the first paint already shows a running job; the store then
  // keeps them current — and is the ONLY input to what each row renders. `plan.indicators` is the
  // seed and nothing else: keeping it as a per-row fallback would resurrect a badge the poll had just
  // evicted, which is rule 4 of the store (server-confirmed memory) repealed at the render layer.
  const liveIndicators = useGenerationIndicators(
    plans.flatMap((plan) => plan.indicators),
    planIds,
  );
  useGenerationAnnouncements(liveIndicators, plans);
  const allSelected = planIds.length > 0 && planIds.every((id) => selectedIds.has(id));
  const someSelected = planIds.some((id) => selectedIds.has(id));
  const headerState: boolean | "indeterminate" = allSelected ? true : someSelected ? "indeterminate" : false;

  const clearSelection = () => {
    setSelectedIds(EMPTY_SELECTION);
  };

  const openCreate = () => {
    setRenameTarget(null);
    setFormOpen(true);
  };
  const openRename = (plan: PlanRow) => {
    setRenameTarget(plan);
    setFormOpen(true);
  };
  const closeForm = () => {
    setFormOpen(false);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-foreground text-2xl font-semibold tracking-tight">Plans</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Each plan is a complete scenario — catalog and timetable. Clone one to explore a what-if.
          </p>
        </div>
        <Button className="gap-2" onClick={openCreate}>
          <Plus aria-hidden="true" />
          New plan
        </Button>
      </header>

      <ComparePlansBar
        count={selectedIds.size}
        href={compareHref(plans, selectedIds)}
        canCompare={canCompare(selectedIds)}
        onClear={clearSelection}
      />

      {plans.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground text-sm">No plans yet — create your first plan.</p>
          <Button className="mt-4 gap-2" onClick={openCreate}>
            <Plus aria-hidden="true" />
            New plan
          </Button>
        </div>
      ) : (
        <div className="border-border overflow-hidden rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10">
                  <Checkbox
                    checked={headerState}
                    onCheckedChange={() => {
                      setSelectedIds((current) => toggleAllSelection(current, planIds));
                    }}
                    aria-label="Select all plans"
                  />
                </TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Grid</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead>Activity</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => {
                const selected = selectedIds.has(plan.id);
                return (
                  <TableRow key={plan.id} data-state={selected ? "selected" : undefined}>
                    <TableCell>
                      <Checkbox
                        checked={selected}
                        onCheckedChange={() => {
                          setSelectedIds((current) => toggleId(current, plan.id));
                        }}
                        aria-label={`Select ${plan.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <a href={`/plans/${plan.id}`} className="text-foreground font-medium hover:underline">
                        {plan.name}
                      </a>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{plan.slotGridPreset}</TableCell>
                    <TableCell className="text-muted-foreground">{plan.updatedAt.slice(0, 10)}</TableCell>
                    <TableCell>
                      <PlanIndicatorsCell indicators={indicatorsForRow(plan.id, liveIndicators, planIds)} />
                    </TableCell>
                    <TableCell className="text-right">
                      <PlanRowActions
                        plan={plan}
                        onClone={setCloneSource}
                        onRename={openRename}
                        onDelete={setDeleteTarget}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      <PlanFormDialog open={formOpen} onClose={closeForm} plan={renameTarget} />
      <ClonePlanDialog
        source={cloneSource}
        onClose={() => {
          setCloneSource(null);
        }}
      />
      <DeletePlanDialog
        plan={deleteTarget}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
      <Toaster />
    </div>
  );
}

/**
 * Announce a job that finished while the hub was open — FR-309's in-app half.
 *
 * **An effect is the right shape here, and it is compliant.** React 19's
 * `react-hooks/set-state-in-effect` rule (which is why the poll itself is an external store rather
 * than an effect) forbids calling `setState` from an effect; `toast()` is not `setState` — it pushes
 * onto sonner's own store, outside this island's render — so nothing here can loop or re-render the
 * grid. What the effect genuinely needs is a *previous* value to diff against, and a ref is the
 * standard way to hold one.
 *
 * The diff itself is pure and lives in `generation-toasts.ts`, so the rule about WHAT counts as an
 * event (active → terminal, once) is tested without a DOM.
 */
const useGenerationAnnouncements = (live: IndicatorsByPlan, plans: readonly PlanRow[]): void => {
  const previous = useRef<IndicatorsByPlan>(live);

  useEffect(() => {
    const nameOf = (planId: string) => plans.find((plan) => plan.id === planId)?.name;
    for (const { tone, title, description, href } of announcementsFor(previous.current, live, nameOf)) {
      const notify = tone === "error" ? toast.error : toast.success;
      notify(title, {
        description,
        action:
          href === null
            ? undefined
            : {
                label: "Open",
                onClick: () => {
                  window.location.assign(href);
                },
              },
      });
    }
    previous.current = live;
  }, [live, plans]);
};

function PlanRowActions({
  plan,
  onClone,
  onRename,
  onDelete,
}: {
  plan: PlanRow;
  onClone: (plan: PlanRow) => void;
  onRename: (plan: PlanRow) => void;
  onDelete: (plan: PlanRow) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={`Actions for ${plan.name}`}>
          <MoreHorizontal aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          onSelect={() => {
            onClone(plan);
          }}
        >
          <Copy aria-hidden="true" />
          Clone
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={() => {
            onRename(plan);
          }}
        >
          <Pencil aria-hidden="true" />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onSelect={() => {
            onDelete(plan);
          }}
        >
          <Trash2 aria-hidden="true" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
