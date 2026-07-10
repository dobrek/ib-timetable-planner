import { useMemo, useState } from "react";
import { cohortLabel, type Cohort } from "@/shared/config";
import { PrintButton } from "@/shared/ui";
import type { DragEndEvent, DragStartEvent } from "@dnd-kit/react";
import {
  BoardHeader,
  BoardSettingsMenu,
  BoardShell,
  ErrorBanner,
  ExportMenu,
  PlanSummaryBar,
  buildCoursesLeftSummary,
  inspectedViolations,
  inspectedWeeks,
  useHintMode,
  usePaletteCohortSelection,
  usePaletteDisclosure,
  useShelfDisclosure,
  useZoom,
} from "./chrome";
import { useUndoKeymap } from "./history/use-undo-keymap";
import { LensAnnouncer, LensBar, LensPicker, useLens, useLensKeymap } from "./lens";
import { PlannerGrid, type PairedColumn } from "./grid";
import { GroupDragOverlay } from "./overlay";
import { cellKey, CollisionDetailsDialog, type CollisionInspectionTarget } from "@/entities/timetable";
import { buildLensOptions, buildLensUniverse, combineLensCounts, type LensCohortSource } from "../model/lens";
import { CombinedPalettePanel, ComputeGroupingsEmptyState, type PaletteCohortData } from "./palette";
import ShelfDrawer from "./shelf/ShelfDrawer";
import { resolveCombinedDrop } from "../model/cross-cohort/drop-router";
import { applyDropAction } from "../model/cross-cohort/drop-dispatch";
import type { DragData, DropTargetData, PlannerBoardProps, SharedBoardProps } from "../model/drag";
import { resolvePaletteView } from "../model/grouping/palette-view";
import { placementErrorMessage } from "../model/placement/placement-transitions";
import { useCombinedBoardState, type CohortBoardState } from "../model/use-cohort-board-state";
import type { BoardSurface } from "../lib/board-surface";
import type { ExportCohortData } from "../lib/export-workbook";

type Props = {
  planName: string;
  /** The active surface from `?focus=`: one cohort (focus mode) or the combined two-cohort board. */
  focus: BoardSurface;
  shared: SharedBoardProps;
  dp1: PlannerBoardProps;
  dp2: PlannerBoardProps;
  paletteCollapsed: boolean;
  /** SSR seed (from cookie) for the combined-mode palette cohort, so a recompute refresh keeps it. */
  initialPaletteCohort: Cohort;
};

/**
 * The ONE plan-detail board. `useCombinedBoardState(shared, dp1, dp2, focus)` runs UNCONDITIONALLY in every
 * mode (constant hook count of 2 — the cross-index cycle is built for exactly 2 and keeps working);
 * `focus` only selects each cohort's cross-index input (the hidden cohort idles on its static seed),
 * and the *render* branches on `focus`. `focus = "combined"` renders both cohort columns with the
 * cohort-switcher palette + sibling-dim; `focus = "dp1"|"dp2"` renders one column, the palette locked
 * to that cohort, the shelf filtered to it, no sibling-dim, and a full-screen empty state. One
 * `DragDropProvider`, one drop router, one canonical `applyDropAction` dispatch.
 */
export default function PlannerBoard({
  planName,
  focus,
  shared,
  dp1: dp1Props,
  dp2: dp2Props,
  paletteCollapsed,
  initialPaletteCohort,
}: Props) {
  const { planId, days, periods } = shared;
  // Lens criteria are created ABOVE the board state so the (preview-merged) selection can feed the
  // per-cohort lens derivation. The universe (both cohorts, plan-wide) prunes the rehydrated lens.
  const lens = useLens(planId, buildLensUniverse([toLensSource(dp1Props), toLensSource(dp2Props)]));
  const { dp1, dp2, history } = useCombinedBoardState(shared, dp1Props, dp2Props, focus, lens.effectiveCriteria);
  const resolveState = (cohort: Cohort): CohortBoardState => (cohort === "dp1" ? dp1 : dp2);
  const resolveProps = (cohort: Cohort): PlannerBoardProps => (cohort === "dp1" ? dp1Props : dp2Props);

  useUndoKeymap(history);

  const { hintMode, setHintMode } = useHintMode();
  const { shelfExpanded, pinned, setExpanded, setPinned, collapseUnlessPinned } = useShelfDisclosure();
  const { collapsed: paletteCollapsedState, setCollapsed: setPaletteCollapsed } =
    usePaletteDisclosure(paletteCollapsed);
  const { paletteCohort, setPaletteCohort } = usePaletteCohortSelection(initialPaletteCohort);
  const [activeDragCohort, setActiveDragCohort] = useState<Cohort | null>(null);

  // Per-device manual zoom (a plain number, 1 = 100%), persisted and cross-tab-synced via `useZoom`.
  const { zoom, setZoom } = useZoom();
  const [inspection, setInspection] = useState<{ cohort: Cohort; target: CollisionInspectionTarget } | null>(null);

  useLensKeymap({
    open: lens.open,
    setOpen: lens.setOpen,
    hasCriteria: lens.criteria.length > 0,
    clearAll: lens.clearAll,
    inspectionOpen: inspection !== null,
  });

  const combined = focus === "combined";
  // The `focus === "combined"` discriminant (not the `combined` alias) narrows `focus` to `Cohort`.
  const activeCohort: Cohort = focus === "combined" ? paletteCohort : focus;

  const overlayCourseDisplay = useMemo(
    () => ({ ...dp1.courseDisplay, ...dp2.courseDisplay }),
    [dp1.courseDisplay, dp2.courseDisplay],
  );

  const shelfCohortById = useMemo(() => {
    if (combined) {
      return new Map<string, Cohort>([
        ...dp1.parkedBundles.map((bundle) => [bundle.id, "dp1"] as const),
        ...dp2.parkedBundles.map((bundle) => [bundle.id, "dp2"] as const),
      ]);
    }
    const bundles = focus === "dp1" ? dp1.parkedBundles : dp2.parkedBundles;
    return new Map<string, Cohort>(bundles.map((bundle) => [bundle.id, focus] as const));
  }, [combined, focus, dp1.parkedBundles, dp2.parkedBundles]);

  if (
    inspection &&
    !resolveState(inspection.cohort).collisions.has(cellKey(inspection.target.day, inspection.target.period))
  ) {
    setInspection(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const data = event.operation.source?.data as DragData | undefined;
    if (!data) return;
    const dragCohort = "cohort" in data ? data.cohort : activeCohort;
    resolveState(dragCohort).startDragHints(data);
    setActiveDragCohort(dragCohort);
  }

  function handleDrop(event: DragEndEvent) {
    dp1.clearDragHints();
    dp2.clearDragHints();
    setActiveDragCohort(null);
    if (event.canceled) return;
    const { source, target } = event.operation;
    if (!source || !target) return;

    const action = resolveCombinedDrop(source.data as DragData, target.data as DropTargetData, activeCohort);
    if (action) applyDropAction(action, resolveState, { collapseUnlessPinned });
  }

  function removeParked(shelfBundleId: string) {
    const cohort = shelfCohortById.get(shelfBundleId);
    if (cohort) resolveState(cohort).actions.removeParked(shelfBundleId);
  }

  function paletteData(state: CohortBoardState): PaletteCohortData {
    return {
      cohort: state.cohort,
      planId,
      groupings: state.groupings,
      courseDisplay: state.courseDisplay,
      hours: state.hours,
      stale: state.stale,
    };
  }

  // Live grid state (placements + display, incl. unsaved optimistic edits) for the timetable sheet;
  // server-seeded props (catalog, studentNames) for the roster sheet — the catalog has no in-session
  // edit surface on this page.
  function exportCohort(cohort: Cohort): ExportCohortData {
    const state = resolveState(cohort);
    const cohortProps = resolveProps(cohort);
    return {
      cohort,
      placements: state.placements,
      courseDisplay: state.courseDisplay,
      catalog: cohortProps.catalog,
      studentNames: cohortProps.studentNames,
    };
  }

  function buildColumn(cohort: Cohort, state: CohortBoardState): PairedColumn {
    return {
      cohort,
      placements: state.placements,
      courseDisplay: state.courseDisplay,
      collisions: state.collisions,
      wiring: {
        dropHints: state.dropHints,
        hintMode,
        isExploded: state.isExploded,
        justDuplicated: state.justDuplicated,
        lensMatched: state.lensMatches?.matched ?? null,
        onRemove: state.actions.removePlacement,
        onSetWeek: state.actions.setWeek,
        onSetOptional: state.actions.setOptional,
        onToggleBundle: state.toggleExploded,
        onRemoveBundle: state.actions.removeBundle,
        onDuplicateBundle: state.actions.duplicateBundle,
        onLiftBundle: (day, period) => {
          applyDropAction({ kind: "liftBundle", cohort, day, period }, resolveState, { collapseUnlessPinned });
        },
        onInspect: (target) => {
          setInspection({ cohort, target });
        },
      },
    };
  }

  if (focus !== "combined") {
    const state = resolveState(focus);
    if (resolvePaletteView({ groupingsCount: state.groupings.length, stale: state.stale }) === "empty") {
      return (
        <>
          <BoardHeader planName={planName} planId={planId} active={focus} />
          <div data-slot="planner-board" className="p-6">
            <ComputeGroupingsEmptyState planId={planId} cohort={focus} />
          </div>
        </>
      );
    }
  }

  const states = combined ? [dp1, dp2] : [resolveState(focus)];
  const columns = states.map((state) => buildColumn(state.cohort, state));
  const cohorts = states.map(paletteData);
  const parkedBundles = states.flatMap((state) => state.parkedBundles);
  // Display-resolved, sorted, cohort-tagged breakdown for the top-bar counter + its popover, built from
  // the same `states` array that already resolves active cohorts. Auto-memoized by React Compiler.
  const summary = buildCoursesLeftSummary(
    states.map((state) => ({
      cohort: state.cohort,
      courseDisplay: state.courseDisplay,
      unplaced: state.unplaced,
      overplaced: state.overplaced,
      hoursLeft: state.hoursLeft,
      hoursOver: state.hoursOver,
      optionalByCourse: state.optionalByCourse,
      optionalCount: state.optionalCount,
    })),
  );
  const inspected = inspection ? resolveState(inspection.cohort) : null;
  // Picker options come from the VISIBLE cohorts' props (courses/students cohort-tagged when
  // combined; teachers filtered to visible catalogs). The bar instead resolves labels against the
  // PLAN-WIDE set, so an off-screen cohort's criterion still names its `·0` chip. Counts span the
  // visible cohorts only. All auto-memoized by React Compiler.
  const visibleCohortProps = combined ? [dp1Props, dp2Props] : [resolveProps(focus)];
  const lensOptions = buildLensOptions(visibleCohortProps.map(toLensSource), shared.teacherNames, combined);
  const planWideLensOptions = buildLensOptions([dp1Props, dp2Props].map(toLensSource), shared.teacherNames, false);
  const lensCounts = combineLensCounts(
    states.map((state) => state.lensMatches),
    lens.criteria,
  );

  return (
    <BoardShell
      onDragStart={handleDragStart}
      onDragEnd={handleDrop}
      gridDataSlot="planner-board"
      header={
        <>
          <PlanSummaryBar
            planName={planName}
            summary={summary}
            combined={combined}
            parkedCount={parkedBundles.length}
            onExpandShelf={() => {
              setExpanded(true);
            }}
            planId={planId}
            active={focus}
            undoRedo={history}
            trailing={
              <>
                <LensPicker
                  open={lens.open}
                  setOpen={lens.setOpen}
                  options={lensOptions}
                  criteria={lens.criteria}
                  onToggle={lens.toggleCriterion}
                  preview={lens.preview}
                  onPreview={lens.setPreview}
                />
                <ExportMenu
                  planName={planName}
                  focus={focus}
                  days={days}
                  periods={periods}
                  teacherNames={shared.teacherNames}
                  dp1={exportCohort("dp1")}
                  dp2={exportCohort("dp2")}
                />
                <BoardSettingsMenu zoom={zoom} setZoom={setZoom} hintMode={hintMode} setHintMode={setHintMode} />
                <PrintButton />
              </>
            }
          />
          {lens.criteria.length > 0 && (
            <LensBar
              criteria={lens.criteria}
              counts={lensCounts}
              options={planWideLensOptions}
              onRemove={lens.removeCriterion}
              onClearAll={lens.clearAll}
              onOpenPicker={() => {
                lens.setOpen(true);
              }}
            />
          )}
          <LensAnnouncer criteria={lens.criteria} total={lensCounts.total} />
        </>
      }
      palette={
        <CombinedPalettePanel
          cohorts={cohorts}
          activeCohort={activeCohort}
          onActiveCohortChange={combined ? setPaletteCohort : undefined}
          collapsed={paletteCollapsedState}
          onCollapsedChange={setPaletteCollapsed}
        />
      }
      center={
        <div className="flex min-h-0 flex-col gap-3">
          {/* Print-only plan-name title: the top bar (which carries the on-screen title) is
              print:hidden, so re-add a heading that appears only on paper — parity with the
              student/teacher printouts. Inert on screen (`hidden`), token-styled only. */}
          <div className="hidden print:block">
            <h1 className="text-foreground text-base font-semibold">{planName}</h1>
            <p className="text-muted-foreground text-sm">
              Timetable — {focus === "combined" ? "DP1 & DP2" : cohortLabel(focus)}
            </p>
          </div>
          {dp1.error && (
            <ErrorBanner message={placementErrorMessage(dp1.error, dp1.courseDisplay)} onDismiss={dp1.clearError} />
          )}
          {dp2.error && (
            <ErrorBanner message={placementErrorMessage(dp2.error, dp2.courseDisplay)} onDismiss={dp2.clearError} />
          )}
          <div className="min-h-0 flex-1 overflow-auto print:overflow-visible">
            <PlannerGrid
              days={days}
              periods={periods}
              gridLabel={`${planName} timetable`}
              columns={columns}
              activeDragCohort={combined ? activeDragCohort : null}
              zoom={zoom}
            />
          </div>
        </div>
      }
      shelf={
        <ShelfDrawer
          parkedBundles={parkedBundles}
          courseDisplay={combined ? overlayCourseDisplay : resolveState(focus).courseDisplay}
          expanded={shelfExpanded}
          pinned={pinned}
          cohortById={shelfCohortById}
          onExpandedChange={setExpanded}
          onPinnedChange={setPinned}
          onRemoveParked={removeParked}
        />
      }
      dialog={
        <CollisionDetailsDialog
          target={inspection?.target ?? null}
          violations={inspection && inspected ? inspectedViolations(inspection.target, inspected.collisions) : []}
          courseDisplay={inspected?.courseDisplay ?? overlayCourseDisplay}
          teacherNames={shared.teacherNames}
          studentNames={inspection ? resolveProps(inspection.cohort).studentNames : {}}
          weekByCourseId={inspection && inspected ? inspectedWeeks(inspection.target, inspected.placements) : {}}
          cohort={inspection?.cohort ?? "dp1"}
          onClose={() => {
            setInspection(null);
          }}
        />
      }
      overlay={
        <GroupDragOverlay
          groupings={[...dp1.groupings, ...dp2.groupings]}
          courseDisplay={overlayCourseDisplay}
          placements={[...dp1.placements, ...dp2.placements]}
          parkedBundles={[...dp1.parkedBundles, ...dp2.parkedBundles]}
          placementsByCohort={{ dp1: dp1.placements, dp2: dp2.placements }}
        />
      }
    />
  );
}

/** Project one cohort's board props onto the lens's picker/universe input shape. */
const toLensSource = ({ cohort, courseDisplay, catalog, studentNames }: PlannerBoardProps): LensCohortSource => ({
  cohort,
  courseDisplay,
  catalog,
  studentNames,
});
