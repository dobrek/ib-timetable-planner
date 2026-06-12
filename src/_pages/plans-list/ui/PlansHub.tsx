import { Copy, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  Button,
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
import ClonePlanDialog from "./ClonePlanDialog";
import DeletePlanDialog from "./DeletePlanDialog";
import PlanFormDialog from "./PlanFormDialog";

type Props = {
  plans: PlanRow[];
};

/**
 * The application hub: every plan is a complete scenario (catalog + board), listed
 * with create-blank, clone (the primary creation path), rename, and delete. No
 * derived comparison metrics — deferred.
 */
export default function PlansHub({ plans }: Props) {
  const [formOpen, setFormOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<PlanRow | null>(null);
  const [cloneSource, setCloneSource] = useState<PlanRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PlanRow | null>(null);

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
                <TableHead>Name</TableHead>
                <TableHead>Grid</TableHead>
                <TableHead>Last updated</TableHead>
                <TableHead className="w-12" aria-label="Actions" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {plans.map((plan) => (
                <TableRow key={plan.id}>
                  <TableCell>
                    <a href={`/plans/${plan.id}`} className="text-foreground font-medium hover:underline">
                      {plan.name}
                    </a>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{plan.slotGridPreset}</TableCell>
                  <TableCell className="text-muted-foreground">{plan.updatedAt.slice(0, 10)}</TableCell>
                  <TableCell className="text-right">
                    <PlanRowActions
                      plan={plan}
                      onClone={setCloneSource}
                      onRename={openRename}
                      onDelete={setDeleteTarget}
                    />
                  </TableCell>
                </TableRow>
              ))}
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
