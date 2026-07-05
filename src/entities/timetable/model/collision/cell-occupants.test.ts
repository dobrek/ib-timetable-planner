import { describe, expect, it } from "vitest";
import { groupCellOccupants } from "./cell-occupants";
import { cellKey } from "./cell-key";
import { type CellCollisions } from "./collisions";
import type { LocalPlacement } from "../placement";

const placement = (id: string, courseId: string, day = 1, period = 1): LocalPlacement => ({
  id,
  courseId,
  day,
  period,
  week: "both",
});

describe("groupCellOccupants", () => {
  it("sorts each cell's occupants by display name, then courseId", () => {
    const placements = [placement("p1", "zebra"), placement("p2", "apple"), placement("p3", "mango")];
    const names = {
      zebra: { name: "Zebra", color: null },
      apple: { name: "Apple", color: null },
      mango: { name: "Mango", color: null },
    };

    const occupants = groupCellOccupants(placements, names, new Map()).get(cellKey(1, 1));

    expect(occupants?.map((o) => o.placement.courseId)).toEqual(["apple", "mango", "zebra"]);
  });

  it("breaks name ties by courseId", () => {
    // Two occupants share a display name → courseId decides the order.
    const placements = [placement("p1", "b-id"), placement("p2", "a-id")];
    const names = { "a-id": { name: "Same", color: null }, "b-id": { name: "Same", color: null } };

    const occupants = groupCellOccupants(placements, names, new Map()).get(cellKey(1, 1));

    expect(occupants?.map((o) => o.placement.courseId)).toEqual(["a-id", "b-id"]);
  });

  it("falls back to the courseId when the id is absent from names", () => {
    const occupants = groupCellOccupants([placement("p1", "unknown")], {}, new Map()).get(cellKey(1, 1));

    expect(occupants?.[0]?.name).toBe("unknown");
    expect(occupants?.[0]?.color).toBeNull();
  });

  it("resolves each occupant's subject color (null when uncolored or absent)", () => {
    const placements = [placement("p1", "math"), placement("p2", "art"), placement("p3", "ghost")];
    const courseDisplay = {
      math: { name: "Math", color: "rose" as const },
      art: { name: "Art", color: null },
    };

    const occupants = groupCellOccupants(placements, courseDisplay, new Map()).get(cellKey(1, 1)) ?? [];
    const byCourse = new Map(occupants.map((o) => [o.placement.courseId, o.color]));

    expect(byCourse.get("math")).toBe("rose");
    expect(byCourse.get("art")).toBeNull();
    expect(byCourse.get("ghost")).toBeNull();
  });

  it("maps blocking/warning/unavailable flags from the cell's CellCollisions", () => {
    const collisions = new Map<string, CellCollisions>([
      [
        cellKey(1, 1),
        {
          blockingIds: new Set(["block"]),
          warningIds: new Set(["warn"]),
          unavailableIds: new Set(["gone"]),
          violations: [],
        },
      ],
    ]);
    const names = {
      block: { name: "Block", color: null },
      warn: { name: "Warn", color: null },
      gone: { name: "Gone", color: null },
    };
    const placements = [placement("p1", "block"), placement("p2", "warn"), placement("p3", "gone")];

    const occupants = groupCellOccupants(placements, names, collisions).get(cellKey(1, 1)) ?? [];
    const byCourse = new Map(occupants.map((o) => [o.placement.courseId, o]));

    expect(byCourse.get("block")).toMatchObject({ blocking: true, warning: false, unavailable: false });
    expect(byCourse.get("warn")).toMatchObject({ blocking: false, warning: true, unavailable: false });
    expect(byCourse.get("gone")).toMatchObject({ blocking: false, warning: false, unavailable: true });
  });

  it("flags a single unavailable occupant in a cell with no other collisions", () => {
    const collisions = new Map<string, CellCollisions>([
      [
        cellKey(1, 1),
        { blockingIds: new Set(), warningIds: new Set(), unavailableIds: new Set(["solo"]), violations: [] },
      ],
    ]);

    const occupant = groupCellOccupants(
      [placement("p1", "solo")],
      { solo: { name: "Solo", color: null } },
      collisions,
    ).get(cellKey(1, 1))?.[0];

    expect(occupant).toMatchObject({ blocking: false, warning: false, unavailable: true });
  });

  it("yields all-false flags for a collision-free cell", () => {
    const occupant = groupCellOccupants(
      [placement("p1", "clean")],
      { clean: { name: "Clean", color: null } },
      new Map(),
    ).get(cellKey(1, 1))?.[0];

    expect(occupant).toMatchObject({ name: "Clean", blocking: false, warning: false, unavailable: false });
  });
});
