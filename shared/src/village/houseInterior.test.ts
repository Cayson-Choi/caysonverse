import { describe, expect, it } from "vitest";
import { HOUSE_INTERIOR_IDS, HOUSE_INTERIOR_LAYOUTS, houseInteriorLayout } from "./houseInterior";

describe("house interiors", () => {
  it("creates one deterministic interior for each of the ten private B houses", () => {
    expect(HOUSE_INTERIOR_IDS).toHaveLength(10);
    expect(Object.keys(HOUSE_INTERIOR_LAYOUTS)).toEqual([...HOUSE_INTERIOR_IDS]);
    for (const id of HOUSE_INTERIOR_IDS) {
      const layout = houseInteriorLayout(id);
      expect(layout.buildingId).toBe(id);
      expect(layout.furniture).toHaveLength(7);
      expect(layout.seats).toHaveLength(4);
      expect(layout.secondFloorY).toBe(layout.wallHeight);
      expect(Math.abs(layout.stairX)).toBeGreaterThan(2);
    }
  });

  it("varies the room dressing by house while keeping seat ids stable", () => {
    const first = houseInteriorLayout(HOUSE_INTERIOR_IDS[0]!);
    const second = houseInteriorLayout(HOUSE_INTERIOR_IDS[1]!);
    expect(second.variant).not.toBe(first.variant);
    expect(second.furniture.map((f) => [f.kind, f.x, f.z])).not.toEqual(first.furniture.map((f) => [f.kind, f.x, f.z]));
    expect(first.seats.every((s) => s.id.startsWith(`${first.buildingId}:`))).toBe(true);
  });
});
