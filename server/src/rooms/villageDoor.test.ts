import { describe, it, expect } from "vitest";
import { PLAYER_RADIUS } from "@caysonverse/shared/constants";
import { isBlocked } from "@caysonverse/shared/collision";
import { VILLAGE_LAYOUT, villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import { ENTRY_SPAWN, EXIT_PAD, HOUSE_NUMBERS, HOUSE_PLACES, HOUSE_STAIR_TYPE, STAIR_PLANS, houseFloorArea, localToWorld } from "@caysonverse/shared/village/houseAreas";
import { DOOR_INSIDE_HALF_WIDTH_M, DOOR_RATE, DOOR_REACH_M, arrivalAfter, useDoor, useHouseExit, useStair } from "./villageDoor";

const L = VILLAGE_LAYOUT;
const outPad = L.memorial.exterior.doorPad;
const inPad = L.memorial.interior.doorPad;

describe("door constants", () => {
  it("reach is 1.3 m past the pad's edge and a client may use a door once a second", () => {
    expect(DOOR_REACH_M).toBe(1.3);
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
      const bounds = a.area === "village" ? L.areas.village : L.areas.hall;
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
  it("from the village: allowed within the enlarged memorial pad radius + 1.3 m (3.3 m), refused beyond", () => {
    const reach = outPad.radius + DOOR_REACH_M;
    expect(reach).toBeCloseTo(3.3, 12);
    expect(useDoor("village", outPad.centre.x, outPad.centre.z)).toEqual(arrivalAfter("village"));
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + reach - 0.01)).toEqual(arrivalAfter("village"));
    expect(useDoor("village", outPad.centre.x + reach - 0.01, outPad.centre.z)).not.toBeNull();
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + reach + 0.01)).toBeNull();
    expect(useDoor("village", outPad.centre.x, outPad.centre.z + 5)).toBeNull();
  });

  it("from the hall: allowed within the inside pad radius + 1.3 m (2.7 m), refused beyond", () => {
    const reach = inPad.radius + DOOR_REACH_M;
    expect(reach).toBeCloseTo(2.7, 12);
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

describe("the way out is used from in front of the door only (round 6 review, 2026-11-15)", () => {
  it("not from the lounge entrance beside it; on the pad and straight in front, yes", () => {
    const pad = VILLAGE_LAYOUT.memorial.interior.doorPad;
    expect(useDoor("hall", 298.8, 3.15)).toBeNull(); // the lounge entrance, 2.37 m from the pad's centre
    expect(useDoor("hall", pad.centre.x + DOOR_INSIDE_HALF_WIDTH_M - 0.01, pad.centre.z - 2.3)).not.toBeNull();
    expect(useDoor("hall", pad.centre.x + DOOR_INSIDE_HALF_WIDTH_M + 0.01, pad.centre.z - 2.3)).toBeNull();
    expect(useDoor("hall", pad.centre.x + pad.radius - 0.01, pad.centre.z)).not.toBeNull();
    const spawn = VILLAGE_LAYOUT.memorial.interior.spawn;
    expect(useDoor("hall", spawn.x, spawn.z)).not.toBeNull();
  });

  it("past the pad's edge only on the room's side of the door (round 7 review: the rule looked at the sideways offset alone)", () => {
    const pad = VILLAGE_LAYOUT.memorial.interior.doorPad;
    // straight in front, 2 m into the room: yes; the same 2 m the other way (behind the door, in the wall): no
    expect(useDoor("hall", pad.centre.x, pad.centre.z - 2.0)).not.toBeNull();
    expect(useDoor("hall", pad.centre.x, pad.centre.z + 2.0)).toBeNull();
    // on the pad itself either way: yes
    expect(useDoor("hall", pad.centre.x, pad.centre.z + pad.radius - 0.01)).not.toBeNull();
  });
});

describe("a house's way out and stair (집 실내 G)", () => {
  const w = (n: (typeof HOUSE_NUMBERS)[number], floor: 1 | 2, lx: number, lz: number) => localToWorld(n, floor, lx, lz);

  it("a house floor is no memorial door: useDoor ignores it", () => {
    const p = HOUSE_PLACES[1];
    expect(useDoor(houseFloorArea(1, 1), p.exitPad.x, p.exitPad.z)).toBeNull();
    expect(useDoor(houseFloorArea(1, 2), p.downPad.x, p.downPad.z)).toBeNull();
  });

  it("the way out: from the exit pad (and 1.3 m in front of it) to the house's porch, in the village, facing away from the door", () => {
    const entries = keypadEntries();
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      const entry = entries.find((e) => e.buildingId === `house_${n}`)!;
      const out = useHouseExit(houseFloorArea(n, 1), p.exitPad.x, p.exitPad.z);
      expect(out, `house ${n}`).toEqual({ area: "village", x: entry.exit.x, z: entry.exit.z, yaw: entry.exit.yaw });
      // straight in front, on the room's side, up to the pad's reach (radius 0.7 + 1.3 = 2.0 m): yes; just past it: no
      expect(useHouseExit(houseFloorArea(n, 1), ...(Object.values(w(n, 1, EXIT_PAD.x, EXIT_PAD.z + 1.9)) as [number, number]))).not.toBeNull();
      expect(useHouseExit(houseFloorArea(n, 1), ...(Object.values(w(n, 1, EXIT_PAD.x + 1.5, EXIT_PAD.z + 1.9)) as [number, number]))).toBeNull();
      // the arrival spot inside (spawn__h<N>_in, 2.2 m from the pad) offers no button, but the server takes the way out from it: the rescue of
      // a house whose model would not load (HOUSE_ENTRY_RESCUE_M); 1.5 m off it, no
      expect(useHouseExit(houseFloorArea(n, 1), p.spawnIn.x, p.spawnIn.z)).not.toBeNull();
      expect(useHouseExit(houseFloorArea(n, 1), ...(Object.values(w(n, 1, ENTRY_SPAWN.x + 1.5, ENTRY_SPAWN.z + 0.5)) as [number, number]))).toBeNull();
      expect(useHouseExit(houseFloorArea(n, 1), ...(Object.values(w(n, 1, EXIT_PAD.x + 1.2, EXIT_PAD.z + 0.5)) as [number, number]))).toBeNull();
      expect(useHouseExit(houseFloorArea(n, 2), p.exitPad.x, p.exitPad.z + 30)).toBeNull();
      expect(useHouseExit("village", p.exitPad.x, p.exitPad.z)).toBeNull();
    }
    expect(useHouseExit(houseFloorArea(1, 1), Number.NaN, 0)).toBeNull();
  });

  it("the porch arrival is on free ground (the porch steps do not block it) for every house", () => {
    for (const e of keypadEntries()) expect(isBlocked(e.exit.x, e.exit.z, PLAYER_RADIUS, villageGeometry.obstacles, 0), e.buildingId).toBe(false);
  });

  it("the stair: floor 1's up pad → floor 2's arrival, floor 2's down pad → floor 1's arrival, both ways usable from where they put you", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      const up = useStair(houseFloorArea(n, 1), p.upPad.x, p.upPad.z);
      expect(up, `house ${n} up`).toEqual({ area: houseFloorArea(n, 2), x: p.spawnUp.x, z: p.spawnUp.z, yaw: p.spawnUp.yaw });
      const down = useStair(houseFloorArea(n, 2), p.downPad.x, p.downPad.z);
      expect(down, `house ${n} down`).toEqual({ area: houseFloorArea(n, 1), x: p.spawnDown.x, z: p.spawnDown.z, yaw: p.spawnDown.yaw });
      // the arrival spots are 0.35 m from their pads: the stair can be used straight back
      expect(useStair(houseFloorArea(n, 2), p.spawnUp.x, p.spawnUp.z), `house ${n} back down`).not.toBeNull();
      expect(useStair(houseFloorArea(n, 1), p.spawnDown.x, p.spawnDown.z), `house ${n} back up`).not.toBeNull();
      // the way in (spawn__h<N>_in) is far from the stair
      expect(useStair(houseFloorArea(n, 1), p.spawnIn.x, p.spawnIn.z)).toBeNull();
    }
    expect(useStair("village", 0, 0)).toBeNull();
    expect(useStair("hall", 300, 0)).toBeNull();
    expect(useStair(houseFloorArea(1, 1), Number.NaN, 0)).toBeNull();
  });

  it("only in front of the stair pad: not from behind it (toward the stair), not 2 m away", () => {
    for (const n of HOUSE_NUMBERS) {
      const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
      const area = houseFloorArea(n, 1);
      const fx = Math.sin(plan.upPad.facing);
      const fz = Math.cos(plan.upPad.facing);
      const at = (d: number) => w(n, 1, plan.upPad.x + fx * d, plan.upPad.z + fz * d);
      expect(useStair(area, at(-1.0).x, at(-1.0).z), `house ${n} 1.0 m in front`).not.toBeNull();
      expect(useStair(area, at(-2.0).x, at(-2.0).z), `house ${n} 2 m in front`).toBeNull();
      expect(useStair(area, at(0.9).x, at(0.9).z), `house ${n} behind`).toBeNull();
    }
  });
});
