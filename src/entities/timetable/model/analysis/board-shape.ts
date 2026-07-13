import { countInteriorHoles } from "../generation/objective";
import { countOccupiedSlots } from "../generation/occupied-slots";
import type { AnalyzerRow, BoardShapeFeatures, DayEdgeProfile } from "./types";

/**
 * One cohort's board shape: how many cells it burns and WHERE the free ones sit. The expert's
 * quality claim ("48 of 50, free slots at the edges") is an edge-position statement, so the free
 * slots are split into day-start vs day-end rather than pooled into one "free" count — that split
 * is what separates the expert's packed-mornings-short-Friday board from the engine's free mornings.
 *
 * Cells are counted week-agnostically (a `both` and an `a` row in the same cell are one occupied
 * slot) — the slot-census convention, matching `countOccupiedSlots`.
 */
export const deriveBoardShape = (rows: AnalyzerRow[], days: number, periods: number): BoardShapeFeatures => {
  const profiles = dayProfiles(rows, days, periods);
  return {
    occupiedSlots: countOccupiedSlots(rows),
    placementRows: rows.length,
    interiorHoles: countInteriorHoles(rows, days),
    freeSlotsAtDayStart: sumOf(profiles, (profile) => profile.freeAtStart),
    freeSlotsAtDayEnd: sumOf(profiles, (profile) => profile.freeAtEnd),
    emptyDays: profiles.filter((profile) => profile.occupied === 0).length,
    days: profiles,
  };
};

const dayProfiles = (rows: AnalyzerRow[], days: number, periods: number): DayEdgeProfile[] =>
  Array.from({ length: days }, (_, index) => dayProfile(rows, index + 1, periods));

const dayProfile = (rows: AnalyzerRow[], day: number, periods: number): DayEdgeProfile => {
  const used = [...new Set(rows.filter((row) => row.day === day).map((row) => row.period))].sort((a, b) => a - b);
  // An unused day has no span, so its free periods are all "before the first lesson" — keeping the
  // per-day identity `occupied + freeAtStart + freeAtEnd + interiorHoles === periods` intact.
  if (used.length === 0) {
    return { day, first: null, last: null, span: 0, occupied: 0, freeAtStart: periods, freeAtEnd: 0, interiorHoles: 0 };
  }
  const first = used[0];
  const last = used[used.length - 1];
  const span = last - first + 1;
  return {
    day,
    first,
    last,
    span,
    occupied: used.length,
    freeAtStart: first - 1,
    freeAtEnd: periods - last,
    interiorHoles: span - used.length,
  };
};

const sumOf = (profiles: DayEdgeProfile[], pick: (profile: DayEdgeProfile) => number): number =>
  profiles.reduce((sum, profile) => sum + pick(profile), 0);
