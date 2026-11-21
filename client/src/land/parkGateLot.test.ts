import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { PARK_ARRIVAL, PARK_EXIT_PAD, PARK_GATE_FROM_VILLAGE, PARK_SOLIDS, parkGateDoor } from "@caysonverse/shared/village/parkArea";
import { PARK_WALL_RECT, VILLAGE_GATE_PASSAGE } from "@caysonverse/shared/village/parkWall";
import { villageLot } from "@caysonverse/shared/village/villageLots";
import { isGateLotObject } from "./ParkGateLot";
import { PARK_PORTAL } from "../village/skyline/VillageParkPortal";
import { VILLAGE_VIEW } from "./ParkVillageView";

const G = PARK_GATE_FROM_VILLAGE;
describe("one gate, two sides: the village's gatehouse stands in the park's wall", () => {
  it("the village's gate maps onto the park's: the avenue onto the promenade's axis, the gate's line onto the north wall's", () => {
    const lot = villageLot("lot_gate");
    expect(lot.centre.x + G.dx).toBe(PARK_ARRIVAL.x);
    expect(lot.centre.x + G.dx).toBe(PARK_EXIT_PAD.x);
    // the gatehouse's body (z 92.6 .. 95 in the village) straddles the wall's centreline
    expect(92.6 + G.dz).toBeLessThan(PARK_WALL_RECT.minZ);
    expect(95 + G.dz).toBeGreaterThan(PARK_WALL_RECT.minZ);
    // the 20 m front fills the gap the park's north runs leave (x 30 .. 50)
    expect(lot.centre.x - lot.front / 2 + G.dx).toBe(30);
    expect(lot.centre.x + lot.front / 2 + G.dx).toBe(50);
  });
  it("its passage is walkable in the park and its wings and piers are solid; the way out and the arrival spot are free", () => {
    const hit = (x: number, z: number) => PARK_SOLIDS.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ);
    const px0 = VILLAGE_GATE_PASSAGE.minX + G.dx;
    const px1 = VILLAGE_GATE_PASSAGE.maxX + G.dx;
    expect([px0, px1]).toEqual([37, 43]);
    for (const x of [px0 + 0.5, 40, px1 - 0.5]) expect(hit(x, -186.5), `passage ${x}`).toBe(false);
    for (const x of [31, 34, 36.5, 43.5, 46, 49]) expect(hit(x, -186.5), `wing ${x}`).toBe(true);
    expect(hit(PARK_EXIT_PAD.x, PARK_EXIT_PAD.z)).toBe(false);
    expect(hit(PARK_ARRIVAL.x, PARK_ARRIVAL.z)).toBe(false);
  });
  it("only the gate's own objects are lent to the park", () => {
    for (const n of ["lotdetail__lot_gate", "door__lot_gate_main", "gate_far_dress", "lotnight__lot_gate_lamps", "lotshells_LM_martgate_stone"]) expect(isGateLotObject(n), n).toBe(true);
    for (const n of ["lotdetail__lot_school", "lotshells_LM_school_brick", "door__lot_church_main", "lotnight__lot_temple_lanterns", "village_lots"]) expect(isGateLotObject(n), n).toBe(false);
  });
  it("the two views through the arch are taken from corresponding spots and their pictures are in the client", () => {
    // the park's picture in the village is centred on the forecourt spot; its photos were taken at that spot's place in the park
    const pad = parkGateDoor().pad;
    expect(Math.abs(PARK_PORTAL.eye.x - pad.x)).toBeLessThan(0.01);
    expect(PARK_PORTAL.eye.x + G.dx).toBe(40);
    expect(PARK_PORTAL.eye.z + G.dz).toBe(-194.5);
    expect(PARK_PORTAL.radius).toBe(VILLAGE_VIEW.radius);
    const dir = resolve(__dirname, "..", "..", "public", "textures", "park");
    for (const t of ["day", "dusk", "night"]) for (const s of ["", "_1k"]) expect(existsSync(resolve(dir, `park_view_${t}${s}.webp`)), `${t}${s}`).toBe(true);
  });
});
