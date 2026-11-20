import { describe, expect, it } from "vitest";
import {
  COASTER_BOARD_REACH_M,
  CAROUSEL_PAD,
  COASTER_PAD,
  DROP_PAD,
  DROP_SITE_AT,
  MOON_BOAT_PAD,
  MOON_BOAT_SITE_AT,
  WHEEL_PAD,
  PARK_ARRIVAL,
  PARK_BOUNDS,
  PARK_EXIT_PAD,
  PARK_LAMPS,
  PARK_PLAZA,
  PARK_SHOPS,
  PARK_SOLIDS,
  PARK_TREES,
  isParkArea,
  parkGateDoor,
  parkGeometry,
  useParkDoor,
} from "./parkArea";
import { arrivalArea, spreadArrival } from "./arrivalSpot";
import { shopWindows, WINDOW_BOX } from "./parkShopWindowLayout";
import { PLAYER_RADIUS } from "../constants";
import { isBlocked, resolveCollision } from "../collision";

const inSolid = (x: number, z: number, r = PLAYER_RADIUS) => PARK_SOLIDS.some((b) => x > b.minX - r && x < b.maxX + r && z > b.minZ - r && z < b.maxZ + r);

describe("park area doors", () => {
  it("the gate lot's pad takes you into the park and the arch's pad takes you back", () => {
    const g = parkGateDoor();
    const inn = useParkDoor("village", g.pad.x, g.pad.z);
    expect(inn).toEqual({ area: "park", x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z, yaw: PARK_ARRIVAL.yaw });
    const out = useParkDoor("park", PARK_EXIT_PAD.x, PARK_EXIT_PAD.z);
    expect(out?.area).toBe("village");
    expect(Math.hypot(out!.x - g.arrival.x, out!.z - g.arrival.z)).toBeLessThan(0.01);
  });
  it("refuses from afar, from another area and for a non-finite position", () => {
    expect(useParkDoor("village", 0, 0)).toBeNull();
    expect(useParkDoor("park", 0, -100)).toBeNull();
    expect(useParkDoor("hall", PARK_EXIT_PAD.x, PARK_EXIT_PAD.z)).toBeNull();
    expect(useParkDoor("village", Number.NaN, 0)).toBeNull();
    expect(isParkArea("park")).toBe(true);
    expect(isParkArea("village")).toBe(false);
  });
});

describe("park layout", () => {
  it("stops a walker at each shop trough while leaving room to walk beside its end", () => {
    const stoppingDistance = WINDOW_BOX.offset + WINDOW_BOX.depth / 2 + PLAYER_RADIUS;
    for (const s of PARK_SHOPS) for (const w of shopWindows(s)) {
      const [nx, , nz] = w.out;
      const near = (d: number, across: number) => inSolid(w.x + nx * d - nz * across, w.z + nz * d + nx * across);
      expect(near(stoppingDistance - 0.01, 0)).toBe(true);
      expect(near(stoppingDistance + 0.01, 0)).toBe(false);
      expect(near(stoppingDistance - 0.01, WINDOW_BOX.width / 2 + PLAYER_RADIUS + 0.1)).toBe(false);
    }
  });
  it("keeps the arrival, both pads and the plaza free of solids and inside the bounds", () => {
    for (const p of [PARK_ARRIVAL, PARK_EXIT_PAD, COASTER_PAD]) {
      expect(p.x).toBeGreaterThan(PARK_BOUNDS.minX);
      expect(p.x).toBeLessThan(PARK_BOUNDS.maxX);
      expect(p.z).toBeGreaterThan(PARK_BOUNDS.minZ);
      expect(p.z).toBeLessThan(PARK_BOUNDS.maxZ);
      expect(inSolid(p.x, p.z)).toBe(false);
    }
    // the fountain is the plaza's only solid
    expect(inSolid(PARK_PLAZA.x + PARK_PLAZA.radius - 3, PARK_PLAZA.z)).toBe(false);
  });
  it("a spread arrival finds a free spot even with the arrival occupied", () => {
    const at = spreadArrival("park", { x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z, yaw: PARK_ARRIVAL.yaw }, [{ x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z }]);
    expect(inSolid(at.x, at.z)).toBe(false);
    expect(arrivalArea("park").bounds.maxZ).toBe(PARK_BOUNDS.maxZ);
  });
  it("shops are on the promenade's sides and clear of its walking width; no tree stands on a path", () => {
    for (const s of PARK_SHOPS) {
      const near = s.faces === 1 ? s.x + s.d / 2 : s.x - s.d / 2;
      expect(near === s.x + s.d / 2 ? near < 28 : near > 52).toBe(true);
    }
    for (const t of PARK_TREES) {
      expect(Math.hypot(t.x - PARK_PLAZA.x, t.z - PARK_PLAZA.z)).toBeGreaterThan(PARK_PLAZA.radius);
      expect(t.z).toBeLessThan(-7);
    }
    expect(PARK_TREES.length).toBeGreaterThan(80);
    expect(PARK_LAMPS.length).toBeGreaterThan(30);
  });
  it("the queue gate stands within the server's boarding reach of itself and far from the plaza", () => {
    expect(COASTER_BOARD_REACH_M).toBeGreaterThan(COASTER_PAD.radius);
    expect(Math.hypot(COASTER_PAD.x - PARK_PLAZA.x, COASTER_PAD.z - PARK_PLAZA.z)).toBeGreaterThan(COASTER_BOARD_REACH_M * 3);
  });
  it("the geometry is the park's own: bounds, solids, id", () => {
    expect(parkGeometry.id).toBe("park");
    expect(parkGeometry.bounds).toEqual(PARK_BOUNDS);
    expect(parkGeometry.obstacles.length).toBe(PARK_SOLIDS.length);
  });
});

describe("the rides' railings and fences are solid (owner 2026-11-21: the characters walked through the moon boat's rails)", () => {
  // each line: a point on one side, a point on the other, the fence between them (park metres)
  const M = MOON_BOAT_SITE_AT;
  const lines: { name: string; ax: number; az: number; bx: number; bz: number }[] = [];
  for (const sz of [-1, 1]) for (const dx of [8.5, 11, 13, 15]) lines.push({ name: `moon queue fence z${sz} x+${dx}`, ax: M.x + dx, az: M.z + sz * 3.5, bx: M.x + dx, bz: M.z + sz * 1.0 });
  for (const sz of [-1, 1]) for (const dx of [3.6, 4.5, 6, 7.5]) lines.push({ name: `moon platform rail z${sz} x+${dx}`, ax: M.x + dx, az: M.z + sz * 6, bx: M.x + dx, bz: M.z });
  lines.push({ name: "moon steps from the pad", ax: M.x + 13, az: M.z, bx: M.x + 9, bz: M.z });
  for (const sz of [-1, 1]) for (const dx of [8, 10, 12]) lines.push({ name: `drop queue fence z${sz} x+${dx}`, ax: DROP_SITE_AT.x + dx, az: DROP_SITE_AT.z + sz * 3.5, bx: DROP_SITE_AT.x + dx, bz: DROP_SITE_AT.z + sz * 0.8 });
  for (const a of [0, 1, 2, 3, 4, 5, 6, 7]) lines.push({ name: `carousel fence ${a}`, ax: 110 + Math.sin((a * Math.PI) / 4) * 20, az: -135 - Math.cos((a * Math.PI) / 4) * 20, bx: 110, bz: -135 });
  lines.push({ name: "wheel steps", ax: 205, az: -140 + 12.5, bx: 205, bz: -140 + 8 });
  for (const l of lines) {
    for (const dir of [1]) {
      it(`${l.name} (${dir > 0 ? "outside in" : "inside out"})`, () => {
        const [sx, sz, ex, ez] = dir > 0 ? [l.ax, l.az, l.bx, l.bz] : [l.bx, l.bz, l.ax, l.az];
        // start where the circle is free (walk the start out of any solid first is not needed: the starts are in the open)
        let x = sx, z = sz;
        const len = Math.hypot(ex - sx, ez - sz);
        const n = Math.ceil(len / 0.1);
        let crossedFree = false;
        for (let i = 0; i < n; i++) {
          const r = resolveCollision(x, z, (ex - sx) / n, (ez - sz) / n, PLAYER_RADIUS, PARK_SOLIDS);
          x = r.x;
          z = r.z;
          expect(isBlocked(x, z, PLAYER_RADIUS, PARK_SOLIDS)).toBe(false);
        }
        // never got to the far side of the line
        crossedFree = Math.hypot(x - ex, z - ez) < 0.35;
        expect(crossedFree).toBe(false);
      });
    }
  }
  it("every ride's boarding pad centre stays open", () => {
    for (const p of [MOON_BOAT_PAD, DROP_PAD, WHEEL_PAD, CAROUSEL_PAD, COASTER_PAD]) expect(inSolid(p.x, p.z)).toBe(false);
  });
});
