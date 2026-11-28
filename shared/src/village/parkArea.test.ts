import { describe, expect, it } from "vitest";
import {
  COASTER_BOARD_REACH_M,
  COASTER_PAD,
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
import * as P from "./parkArea";
import { parkBenchSolids } from "./parkBenches";

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
    // the plaza between its flower troughs (ring 17.5) and its lamp posts (ring 23.5, solid since 2026-11-21) is open
    expect(inSolid(PARK_PLAZA.x + PARK_PLAZA.radius - 5, PARK_PLAZA.z)).toBe(false);
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

// owner 2026-11-28: every path straight on its door (the shops stood 7 m of lawn off the promenade with no walk to their doors)
describe("the shops' front walks", () => {
  it("one per shop, centred on its door, from the promenade's edge to under the door's step", () => {
    expect(P.PARK_SHOP_WALKS.length).toBe(P.PARK_SHOPS.length);
    for (const s of P.PARK_SHOPS) {
      const w = P.PARK_SHOP_WALKS.find((x) => x.id === s.id)!;
      const d = P.parkShopDoor(s);
      expect((w.minZ + w.maxZ) / 2).toBeCloseTo(d.z, 6);
      expect(w.maxZ - w.minZ).toBeGreaterThanOrEqual(1.7); // the door
      expect(w.maxZ - w.minZ).toBeLessThanOrEqual(2.0);
      if (s.faces === 1) {
        expect(w.maxX).toBe(P.PARK_PROMENADE.minX);
        expect(w.minX).toBeLessThan(d.stepX); // under the step
        expect(w.minX).toBeGreaterThan(d.x); // never into the wall
      } else {
        expect(w.minX).toBe(P.PARK_PROMENADE.maxX);
        expect(w.maxX).toBeGreaterThan(d.stepX);
        expect(w.maxX).toBeLessThan(d.x);
      }
    }
  });
  it("no lamp post, bin, bench or planter stands on a walk, its kerb (14 cm) or in front of its mouth (3 m into the promenade)", () => {
    // footprints: lamps and bins as points, the benches (2 m x 0.72 m) and the stone planters as boxes
    const things = [
      ...[...P.PARK_LAMPS, ...P.PARK_BINS].map((l) => ({ id: `(${l.x}, ${l.z})`, minX: l.x, maxX: l.x, minZ: l.z, maxZ: l.z })),
      ...parkBenchSolids().map((b) => ({ id: `bench (${(b.minX + b.maxX) / 2}, ${(b.minZ + b.maxZ) / 2})`, ...b })),
      ...P.PARK_PLANTERS.map((p) => ({ id: `planter (${p.x}, ${p.z})`, minX: p.x - p.w / 2, maxX: p.x + p.w / 2, minZ: p.z - p.d / 2, maxZ: p.z + p.d / 2 })),
    ];
    for (const w of P.PARK_SHOP_WALKS) {
      // the walk with its mouth carried 3 m on into the promenade (2026-11-28: the planters and a bench pair stood there)
      const west = w.maxX === P.PARK_PROMENADE.minX;
      const z = { minX: west ? w.minX : w.minX - 3, maxX: west ? w.maxX + 3 : w.maxX, minZ: w.minZ, maxZ: w.maxZ };
      for (const t of things) {
        const dx = Math.max(z.minX - 0.14 - t.maxX, 0, t.minX - z.maxX - 0.14);
        const dz = Math.max(z.minZ - 0.14 - t.maxZ, 0, t.minZ - z.maxZ - 0.14);
        expect(Math.hypot(dx, dz), `${w.id} by ${t.id}`).toBeGreaterThan(0.5);
      }
    }
  });
});
