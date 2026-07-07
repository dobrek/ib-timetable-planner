import type { Cohort, PlacementWeek } from "@/shared/config";
import type { ParkedMember } from "../model/placement/parked";
import {
  moveBundleMembers,
  placeCourse,
  removeBundleMembers,
  updatePlacementOptional,
  updatePlacementWeek,
} from "./placement-client";
import { deleteShelfBundle, shelveBundle, shelveCourses, unshelveBundle } from "./shelf-client";

/**
 * The plan+cohort-bound RPC surface the optimistic write path and the reconcile executor share.
 * `planId`/`cohort` are spelled once here, not re-passed at every call site. Method names mirror the
 * `placement-client` / `shelf-client` functions one-for-one, so the suites that mock those modules
 * keep working unchanged. Two clients can't bind uniformly: `updatePlacementWeek` takes neither
 * `planId` nor `cohort` (pure pass-through), and `deleteShelfBundle` takes only `planId`.
 */
export function makeRpcs(planId: string, cohort: Cohort) {
  return {
    placeCourse: (args: { courseId: string; day: number; period: number; week: PlacementWeek; isOptional: boolean }) =>
      placeCourse({ planId, cohort, ...args }),
    moveBundleMembers: (args: {
      day: number;
      period: number;
      courseIds: string[];
      targetDay: number;
      targetPeriod: number;
    }) => moveBundleMembers({ planId, cohort, ...args }),
    removeBundleMembers: (args: { day: number; period: number; courseIds: string[] }) =>
      removeBundleMembers({ planId, cohort, ...args }),
    updatePlacementWeek: (id: string, week: PlacementWeek) => updatePlacementWeek(id, week),
    updatePlacementOptional: (id: string, isOptional: boolean) => updatePlacementOptional(id, isOptional),
    shelveBundle: (args: { day: number; period: number }) => shelveBundle({ planId, cohort, ...args }),
    unshelveBundle: (args: { shelfBundleId: string; targetDay: number; targetPeriod: number }) =>
      unshelveBundle({ planId, cohort, ...args }),
    deleteShelfBundle: (args: { shelfBundleId: string }) => deleteShelfBundle({ planId, ...args }),
    shelveCourses: (args: { members: ParkedMember[] }) => shelveCourses({ planId, cohort, ...args }),
  };
}

export type Rpcs = ReturnType<typeof makeRpcs>;
