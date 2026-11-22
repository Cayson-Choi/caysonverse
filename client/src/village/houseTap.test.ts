import { afterEach, describe, expect, it } from "vitest";
import { HOUSE_NUMBERS, HOUSE_PLACES, HOUSE_STAIR_TYPE, STAIR_PLANS, houseFloorArea, localRectToWorld, localToWorld } from "@caysonverse/shared/village/houseAreas";
import { HOUSE_EXIT_TARGET_ID, HOUSE_STAIR_DOWN_TARGET_ID, HOUSE_STAIR_UP_TARGET_ID, houseOffers } from "@caysonverse/shared/village/houseTargets";
import { HOUSE_USE_ARM_MS, armHouseUse, armedHouseUse, disarmHouseUse, houseTapTarget, onStairSurface, takeArmedHouseUse } from "./houseTap";

afterEach(() => armHouseUse(null));

describe("houseTapTarget: a tap on the stair or the front door", () => {
  it("a point on the stair of every house (floor 1) is its up pad; on floor 2 the stairwell is the down pad", () => {
    for (const n of HOUSE_NUMBERS) {
      const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
      const p = HOUSE_PLACES[n];
      for (const floor of [1, 2] as const) {
        const r = localRectToWorld(n, floor, plan.footprint);
        const cx = (r.minX + r.maxX) / 2;
        const cz = (r.minZ + r.maxZ) / 2;
        const tread = floor === 1 ? 2.0 : -2.0; // the middle of the flight: 2 m up on floor 1, 2 m below the floor 2's boards
        const hit = houseTapTarget(houseFloorArea(n, floor), cx, floor === 1 ? tread + 0.3 : 0.3, cz);
        expect(hit, `house ${n} floor ${floor}`).toEqual(
          floor === 1 ? { id: HOUSE_STAIR_UP_TARGET_ID, x: p.upPad.x, z: p.upPad.z } : { id: HOUSE_STAIR_DOWN_TARGET_ID, x: p.downPad.x, z: p.downPad.z },
        );
      }
    }
  });

  it("a tap on the room round the stair is NOT the stair: the back wall, the ceiling and the floor beside the high steps (owner 2026-11-20)", () => {
    for (const n of HOUSE_NUMBERS) {
      const plan = STAIR_PLANS[HOUSE_STAIR_TYPE[n]];
      const r = localRectToWorld(n, 1, plan.footprint);
      const cx = (r.minX + r.maxX) / 2;
      const cz = (r.minZ + r.maxZ) / 2;
      const area = houseFloorArea(n, 1);
      expect(houseTapTarget(area, cx, 3.6, cz), `house ${n}: the ceiling above the middle of the flight`).toBeNull();
      expect(houseTapTarget(area, cx, 0.0, cz), `house ${n}: the floor level beside/under the high steps`).toBeNull();
      expect(houseTapTarget(area, cx, 2.1, cz), `house ${n}: a step`).not.toBeNull();
      // the foot of the flight: the floor at the first steps is the stair
      const f = localRectToWorld(n, 1, { minX: plan.foot.x, maxX: plan.foot.x, minZ: plan.foot.z, maxZ: plan.foot.z });
      expect(onStairSurface(n, 1, f.minX, 0.1, f.minZ), `house ${n}: the first step`).toBe(true);
      expect(onStairSurface(n, 1, f.minX, 2.5, f.minZ), `house ${n}: the wall high above the foot`).toBe(false);
    }
  });

  it("the pad it walks to is where the button is offered (so the use fires on arrival)", () => {
    for (const n of HOUSE_NUMBERS) {
      const p = HOUSE_PLACES[n];
      expect(houseOffers(houseFloorArea(n, 1), p.upPad.x, p.upPad.z).map((o) => o.id)).toContain(HOUSE_STAIR_UP_TARGET_ID);
      expect(houseOffers(houseFloorArea(n, 2), p.downPad.x, p.downPad.z).map((o) => o.id)).toContain(HOUSE_STAIR_DOWN_TARGET_ID);
    }
  });

  it("the front door (floor 1, the glass leaves on the z = 0 wall) is the way out; the same place on floor 2 is nothing", () => {
    const n = 4;
    const door = localToWorld(n, 1, 5.3, 0.1);
    expect(houseTapTarget(houseFloorArea(n, 1), door.x, 1.5, door.z)).toMatchObject({ id: HOUSE_EXIT_TARGET_ID, x: HOUSE_PLACES[n].exitPad.x });
    expect(houseTapTarget(houseFloorArea(n, 1), door.x, 3.3, door.z)).toBeNull(); // above the door
    expect(houseTapTarget(houseFloorArea(n, 1), door.x, 0, door.z)).toBeNull(); // the floor by the door: a walk, never out
    // the glass leaf lets a click through: nothing picked (NaN), the ray alone says it crossed the door; at its foot, past its jamb, upstairs: not
    const eye = localToWorld(n, 1, 5.3, 4);
    const rayTo = (lx: number, y: number) => {
      const to = localToWorld(n, 1, lx, 0);
      const l = Math.hypot(to.x - eye.x, y - 2.8, to.z - eye.z);
      return { o: { x: eye.x, y: 2.8, z: eye.z }, d: { x: (to.x - eye.x) / l, y: (y - 2.8) / l, z: (to.z - eye.z) / l } };
    };
    expect(houseTapTarget(houseFloorArea(n, 1), NaN, NaN, NaN, undefined, rayTo(5.3, 1.4))).toMatchObject({ id: HOUSE_EXIT_TARGET_ID });
    expect(houseTapTarget(houseFloorArea(n, 1), NaN, NaN, NaN, undefined, rayTo(5.3, 0.1))).toBeNull();
    expect(houseTapTarget(houseFloorArea(n, 1), NaN, NaN, NaN, undefined, rayTo(2.0, 1.4))).toBeNull();
    expect(houseTapTarget(houseFloorArea(n, 1), NaN, NaN, NaN, undefined, null)).toBeNull();
    expect(houseTapTarget(houseFloorArea(n, 2), NaN, NaN, NaN, undefined, rayTo(5.3, 1.4))).toBeNull();
    // a floor click whose ray would cross the door plane lower down is still the floor
    expect(houseTapTarget(houseFloorArea(n, 1), door.x, 0, door.z, 1, rayTo(5.3, 1.4), 5)).toBeNull();
    const door2 = localToWorld(n, 2, 5.3, 0.1);
    expect(houseTapTarget(houseFloorArea(n, 2), door2.x, 1.5, door2.z)).toBeNull();
    const side = localToWorld(n, 1, 2.0, 0.1); // the wall beside the door
    expect(houseTapTarget(houseFloorArea(n, 1), side.x, 1.5, side.z)).toBeNull();
  });

  it("nothing in the village, the hall or on a non-finite point", () => {
    expect(houseTapTarget("village", 0, 0, 0)).toBeNull();
    expect(houseTapTarget("hall", 300, 1, 0)).toBeNull();
    expect(houseTapTarget(houseFloorArea(1, 1), Number.NaN, 0, 0)).toBeNull();
  });
});

describe("the armed use", () => {
  it("fires once the walk reaches the pad (its button is offered), and only once", () => {
    armHouseUse(HOUSE_STAIR_UP_TARGET_ID, 1000);
    expect(armedHouseUse()).toBe(HOUSE_STAIR_UP_TARGET_ID);
    expect(takeArmedHouseUse([], 1100)).toBeNull(); // still walking: nothing offered
    expect(takeArmedHouseUse([HOUSE_EXIT_TARGET_ID], 1200)).toBeNull(); // another button: not this one
    expect(takeArmedHouseUse([HOUSE_STAIR_UP_TARGET_ID], 1300)).toBe(HOUSE_STAIR_UP_TARGET_ID);
    expect(takeArmedHouseUse([HOUSE_STAIR_UP_TARGET_ID], 1400)).toBeNull();
  });

  it("entering a house or the keys disarm it", () => {
    armHouseUse(HOUSE_STAIR_UP_TARGET_ID, 0);
    disarmHouseUse();
    expect(armedHouseUse()).toBeNull();
    expect(takeArmedHouseUse([HOUSE_STAIR_UP_TARGET_ID], 10)).toBeNull();
  });

  it("a new tap disarms; so does waiting too long", () => {
    armHouseUse(HOUSE_STAIR_UP_TARGET_ID, 0);
    armHouseUse(null);
    expect(takeArmedHouseUse([HOUSE_STAIR_UP_TARGET_ID], 10)).toBeNull();
    armHouseUse(HOUSE_EXIT_TARGET_ID, 0);
    expect(takeArmedHouseUse([HOUSE_EXIT_TARGET_ID], HOUSE_USE_ARM_MS + 1)).toBeNull();
    expect(armedHouseUse()).toBeNull();
  });
});
