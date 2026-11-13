import { describe, expect, it } from "vitest";
import { AVATAR_TOP_M, HALL_DRAWN_CEILING_M, HEAD_CLEARANCE_M, HEADROOM_FEATHER, ROOF_EDGE_MARGIN_M, ceilingAbove, jumpHeadroom, villageOverheads } from "./overhead";
import { BUS_SHELTER_ROOF, VILLAGE_LAYOUT, busShelterRoofSlab, houseArea } from "./villageLayout";
import { HOUSE_INTERIOR_IDS, HOUSE_INTERIOR_LAYOUTS } from "./houseInterior";

const c = VILLAGE_LAYOUT.busStop.shelter.centre;

describe("what is over a jumper's head", () => {
  it("the open village has no roof: infinite headroom, so a hop is unchanged", () => {
    expect(ceilingAbove(0, 14, "village")).toBe(Infinity);
    expect(jumpHeadroom(0, 14, "village")).toBe(Infinity);
    expect(jumpHeadroom(34.1, -6.5, "village")).toBe(Infinity); // on the bus's lane, 6 m from the shelter
  });

  it("under the bus shelter's roof the headroom is the roof's underside less the tallest head, well under the 1 m hop", () => {
    const room = jumpHeadroom(c.x, c.z, "village");
    expect(room).toBeCloseTo(BUS_SHELTER_ROOF.underside - AVATAR_TOP_M - HEAD_CLEARANCE_M, 9);
    expect(room).toBeGreaterThan(0);
    expect(room).toBeLessThan(1); // the 1 m apex would put the head through the roof
    // everywhere in the shelter's glass footprint, front edge to back
    for (const [dx, dz] of [[-0.7, -1.7], [0.7, 1.7], [0, 0], [-0.7, 1.7]]) expect(jumpHeadroom(c.x + dx!, c.z + dz!, "village")).toBeCloseTo(room, 9);
  });

  it("each avatar's own height counts: a tall hat leaves less room, and one taller than the roof has none", () => {
    const bare = jumpHeadroom(c.x, c.z, "village", 2.18);
    const beanie = jumpHeadroom(c.x, c.z, "village", 2.48);
    const wizard = jumpHeadroom(c.x, c.z, "village", 2.69);
    expect(bare).toBeGreaterThan(beanie);
    expect(beanie).toBeGreaterThan(0);
    expect(wizard).toBe(0); // the 2.69 m hat is already through the 2.55 m roof: it cannot rise
    expect(bare).toBeCloseTo(BUS_SHELTER_ROOF.underside - 2.18 - HEAD_CLEARANCE_M, 9);
  });

  it("the headroom eases back to the open air outside the roof's edge instead of jumping", () => {
    const edge = c.x - BUS_SHELTER_ROOF.halfX - ROOF_EDGE_MARGIN_M; // the road side
    const under = jumpHeadroom(edge + 0.001, c.z, "village");
    const out = jumpHeadroom(edge - 0.5, c.z, "village");
    expect(under).toBeCloseTo(BUS_SHELTER_ROOF.underside - AVATAR_TOP_M - HEAD_CLEARANCE_M, 2);
    expect(out).toBeCloseTo(under + 0.5 * HEADROOM_FEATHER, 2);
    expect(jumpHeadroom(edge - 5, c.z, "village")).toBeGreaterThan(5);
    expect(jumpHeadroom(edge - 30, c.z, "village")).toBe(Infinity);
  });

  it("the roof is the same one the camera's slab covers (the camera and the head stop under the same sheet)", () => {
    const slab = busShelterRoofSlab();
    const roof = villageOverheads()[0]!;
    for (const k of ["minX", "maxX", "minZ", "maxZ"] as const) expect(roof.box[k]).toBeCloseTo(slab[k], 5);
    expect(slab.minY!).toBeLessThan(roof.underside);
    expect(slab.minY!).toBeGreaterThan(roof.underside - 0.1);
    expect(slab.height!).toBe(BUS_SHELTER_ROOF.top);
  });

  it("the hall and the houses are roofed everywhere; their ceilings are higher than a hop, so a normal jump stays", () => {
    expect(ceilingAbove(300, 0, "hall")).toBe(HALL_DRAWN_CEILING_M);
    expect(jumpHeadroom(300, 0, "hall")).toBeCloseTo(HALL_DRAWN_CEILING_M - AVATAR_TOP_M - HEAD_CLEARANCE_M, 9);
    for (const id of HOUSE_INTERIOR_IDS) {
      const wall = HOUSE_INTERIOR_LAYOUTS[id]!.wallHeight;
      expect(ceilingAbove(300, 0, houseArea(id))).toBe(wall);
      expect(jumpHeadroom(300, 0, houseArea(id))).toBeCloseTo(wall - AVATAR_TOP_M - HEAD_CLEARANCE_M, 9);
    }
  });
});
