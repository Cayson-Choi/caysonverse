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
import { PLAYER_RADIUS } from "../constants";

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
