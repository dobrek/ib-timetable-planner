import { describe, expect, it } from "vitest";
import { block, row } from "./__fixtures__/builders";
import { deriveBoardShape } from "./board-shape";

const PERIODS = 10;

describe("deriveBoardShape", () => {
  it("separates free slots at the day start from free slots at the day end", () => {
    // Day 1 starts at P1 and ends at P8 (2 free at the tail — the expert's short-Friday shape);
    // day 2 starts at P3 (2 free mornings — the engine's shape) and runs to P10.
    const rows = [...block("dp1", "math", 1, 1, 8), ...block("dp1", "bio", 2, 3, 8)];

    const shape = deriveBoardShape(rows, 2, PERIODS);

    expect(shape.freeSlotsAtDayStart).toBe(2);
    expect(shape.freeSlotsAtDayEnd).toBe(2);
    expect(shape.days[0]).toMatchObject({ day: 1, first: 1, last: 8, freeAtStart: 0, freeAtEnd: 2 });
    expect(shape.days[1]).toMatchObject({ day: 2, first: 3, last: 10, freeAtStart: 2, freeAtEnd: 0 });
  });

  it("counts occupied cells week-agnostically but placement rows one per hour", () => {
    // Two biweekly courses sharing one cell (the expert's CAS(a)+EE(b) pairing) — one slot, two rows.
    const rows = [row("dp1", "cas", 3, 8, "a"), row("dp1", "ee", 3, 8, "b")];

    const shape = deriveBoardShape(rows, 5, PERIODS);

    expect(shape.occupiedSlots).toBe(1);
    expect(shape.placementRows).toBe(2);
  });

  it("reports interior holes per day and keeps them out of the edge counts", () => {
    const rows = [...block("dp1", "math", 1, 2, 2), row("dp1", "bio", 1, 6)];

    const shape = deriveBoardShape(rows, 1, PERIODS);

    expect(shape.interiorHoles).toBe(2); // P4, P5 inside the P2–P6 span
    expect(shape.days[0]).toMatchObject({ span: 5, occupied: 3, interiorHoles: 2, freeAtStart: 1, freeAtEnd: 4 });
  });

  it("books an empty day's whole grid column as free-at-start", () => {
    const shape = deriveBoardShape([], 1, PERIODS);

    expect(shape.days[0]).toEqual({
      day: 1,
      first: null,
      last: null,
      span: 0,
      occupied: 0,
      freeAtStart: PERIODS,
      freeAtEnd: 0,
      interiorHoles: 0,
    });
  });

  it("keeps the per-day identity: occupied + free edges + interior holes = periods", () => {
    const rows = [...block("dp1", "math", 1, 2, 2), row("dp1", "bio", 1, 6), ...block("dp1", "art", 2, 1, 3)];

    for (const day of deriveBoardShape(rows, 3, PERIODS).days) {
      expect(day.occupied + day.freeAtStart + day.freeAtEnd + day.interiorHoles).toBe(PERIODS);
    }
  });
});
