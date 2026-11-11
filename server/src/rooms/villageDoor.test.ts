import { describe, it, expect } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/constants";
import { isBlocked } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { DOOR_RATE, DOOR_REACH_M, arrivalAfter, useDoor } from "./villageDoor";

const L = VILLAGE_LAYOUT;
const outPad = L.memorial.exterior.doorPad;
const inPad = L.memorial.interior.doorPad;

describe("door constants", () => {
  it("reach is 0.9 m past the pad's edge and a client may use a door once a second", () => {
    expect(DOOR_REACH_M).toBe(0.9);
    expect(DOOR_RATE).toEqual({ count: 1, windowMs: 1000 });
  });
});

describe("arrivalAfter", () => {
  it("village -> hall: the layout's inside spawn, facing -z into the room", () => {
    const a = arrivalAfter("village");
    expect(a.area).toBe("hall");
    expect(a.x).toBe(L.memorial.interior.spawn.x);
    expect(a.z).toBe(L.memorial.interior.spawn.z);
    expect(a.yaw).toBeCloseTo(Math.PI, 12); // atan2(0, -1): north
    expect(a).toMatchObject({ x: L.memorial.interior.spawn.x, z: L.memorial.interior.spawn.z, yaw: L.memorial.interior.spawn.yaw });
  });

  it("hall -> village: the layout's exterior arrival (2.2 m south of the memorial door pad's centre), facing +z away from the building", () => {
    const a = arrivalAfter("hall");
    const { arrival } = L.memorial.exterior;
    expect(a).toEqual({ area: "village", x: arrival.x, z: arrival.z, yaw: arrival.yaw });
    expect(a.z).toBeCloseTo(outPad.centre.z + 2.2, 9); // pad centre + 2.2 m south
    expect(a.yaw).toBe(0); // atan2(dirX, dirZ) with dir = (0, 1): +z (south)
    // South of the building's south face, so the building is behind the player.
    const footprintFrontZ = L.memorial.exterior.centre.z + L.memorial.exterior.size.z / 2;
    expect(a.z).toBeGreaterThan(footprintFrontZ);
  });

  it("both arrival points are collider-free in the village geometry and inside their own area", () => {
    for (const a of [arrivalAfter("village"), arrivalAfter("hall")]) {
      expect(isBlocked(a.x, a.z, PLAYER_RADIUS, villageGeometry.obstacles), JSON.stringify(a)).toBe(false);
      const bounds = L.areas[a.area];
      expect(a.x).toBeGreaterThanOrEqual(bounds.minX + PLAYER_RADIUS);
      expect(a.x).toBeLessThanOrEqual(bounds.maxX - PLAYER_RADIUS);
      expect(a.z).toBeGreaterThanOrEqual(bounds.minZ + PLAYER_RADIUS);
      expect(a.z).toBeLessThanOrEqual(bounds.maxZ - PLAYER_RADIUS);
    }
  });

  it("an arrival is not standing on the door pad it came through the other side of, yet is still near enough to turn back", () => {
    const hall = arrivalAfter("village"); // stands beside the INSIDE pad
    expect(Math.hypot(hall.x - inPad.centre.x, hall.z - inPad.centre.z)).toBeGreaterThan(inPad.radius);
    expect(Math.hypot(hall.x - inPad.centre.x, hall.z - inPad.centre.z)).toBeLessThanOrEqual(inPad.radius + DOOR_REACH_M);
    const village = arrivalAfter("hall"); // stands beside the OUTSIDE pad
    expect(Math.hypot(village.x - outPad.centre.x, village.z - outPad.centre.z)).toBeGreaterThan(outPad.radius);
    expect(Math.hypot(village.x - outPad.centre.x, village.z - outPad.centre.z)).toBeLessThanOrEqual(outPad.radius + DOOR_REACH_M);
  });
});

describe("useDoor", () => {
  it("from the village: allowed within the enlarged memorial pad radius + 0.9 m (2.9 m), refused beyond", () => {
    const reach = outPad.radius + DOOR_REACH_M;
    expect(reach).toBeCloseTo(2.9, 12);
    expect(useDoor("village", outPad.centre.x, outPad.centre.z)).toEqual(arrivalAfter("village"));
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + reach - 0.01)).toEqual(arrivalAfter("village"));
    expect(useDoor("village", outPad.centre.x + reach - 0.01, outPad.centre.z)).not.toBeNull();
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + reach + 0.01)).toBeNull();
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + 5)).toBeNull();
  });

  it("from the hall: allowed within the inside pad radius + 0.9 m (2.3 m), refused beyond", () => {
    const reach = inPad.radius + DOOR_REACH_M;
    expect(reach).toBeCloseTo(2.3, 12);
    expect(useDoor("hall", inPad.centre.x, inPad.centre.z)).toEqual(arrivalAfter("hall"));
    expect(useDoor("hall", inPad.centre.x, inPad.centre.z - reach + 0.01)).toEqual(arrivalAfter("hall"));
    expect(useDoor("hall", inPad.centre.x, inPad.centre.z - reach - 0.01)).toBeNull();
    expect(useDoor("hall", L.memorial.interior.origin.x, L.memorial.interior.origin.z)).toBeNull(); // the middle of the room
  });

  it("the inside spawn is within reach of the way out, so a new arrival can turn straight back", () => {
    const s = L.memorial.interior.spawn;
    expect(useDoor("hall", s.x, s.z)).toEqual(arrivalAfter("hall"));
  });

  it("does not take a village player to the hall door pad by area mix-up: each area only knows its own pad", () => {
    // Standing at the memorial's pad but claiming to be in the hall (or the reverse) does nothing.
    expect(useDoor("hall", outPad.centre.x, outPad.centre.z)).toBeNull();
    expect(useDoor("village", inPad.centre.x, inPad.centre.z)).toBeNull();
  });

  it("drops an unknown area and a non-finite position", () => {
    expect(useDoor("moon", outPad.centre.x, outPad.centre.z)).toBeNull();
    expect(useDoor("", outPad.centre.x, outPad.centre.z)).toBeNull();
    expect(useDoor("village", Number.NaN, outPad.centre.z)).toBeNull();
    expect(useDoor("village", outPad.centre.x, Number.POSITIVE_INFINITY)).toBeNull();
  });
});
