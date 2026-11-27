import { afterEach, describe, expect, it } from "vitest";
import { HOUSE_PLACES, houseFloorArea } from "@caysonverse/shared/village/houseAreas";
import { HOUSE_STAIR_UP_TARGET_ID } from "@caysonverse/shared/village/houseTargets";
import { serverAgreedTargets } from "./serverReach";
import { villageTargets } from "./villageTargets";
import { PAD_WALK_DONE_M, PAD_WALK_TRIES, currentPadWalk, disarmHouseUse, setPadWalk, stepPadWalk } from "./houseTap";

afterEach(() => disarmHouseUse());

describe("serverAgreedTargets: a house's stair button only where the server has me in reach too", () => {
  const area = houseFloorArea(2, 1);
  const pad = HOUSE_PLACES[2].upPad;
  // 1.65 m in front of the pad (room side): offered from here; 2.0 m: not (the server's own reach is 1.8 m)
  const near = { x: pad.x, z: pad.z + 1.65 };
  const far = { x: pad.x, z: pad.z + 2.0 };

  it("offered when the client and the server both stand in reach", () => {
    const t = villageTargets(area, near.x, near.z);
    expect(t.some((x) => x.id === HOUSE_STAIR_UP_TARGET_ID)).toBe(true);
    expect(serverAgreedTargets(area, t, { ...near, area }, villageTargets).map((x) => x.id)).toContain(HOUSE_STAIR_UP_TARGET_ID);
  });

  it("held back while the server has me out of reach (the walk's last moves not taken yet)", () => {
    const t = villageTargets(area, near.x, near.z);
    expect(serverAgreedTargets(area, t, { ...far, area }, villageTargets)).toEqual([]);
  });

  it("held back while the server has me in another area", () => {
    const t = villageTargets(area, near.x, near.z);
    expect(serverAgreedTargets(area, t, { ...near, area: "village" }, villageTargets)).toEqual([]);
  });

  it("no server pose yet, or an area that is no house / lot room: unchanged", () => {
    const t = villageTargets(area, near.x, near.z);
    expect(serverAgreedTargets(area, t, null, villageTargets)).toBe(t);
    const v = villageTargets("village", 0, 0);
    expect(serverAgreedTargets("village", v, { x: 999, z: 999, area: "village" }, villageTargets)).toBe(v);
  });
});

describe("stepPadWalk: a tap's walk to a pad is followed onto it", () => {
  const pad = { id: HOUSE_STAIR_UP_TARGET_ID, x: 10, z: 10 };

  it("nothing before the walk has started, nothing while it walks", () => {
    setPadWalk(pad, 0);
    expect(stepPadWalk(0, 0, false, 10)).toBe("none");
    expect(stepPadWalk(1, 1, true, 20)).toBe("none");
  });

  it("ended on the pad: done", () => {
    setPadWalk(pad, 0);
    stepPadWalk(5, 5, true, 10);
    expect(stepPadWalk(10, 10 + PAD_WALK_DONE_M - 0.01, false, 20)).toBe("none");
    expect(currentPadWalk()).toBeNull();
  });

  it("ended short: planned again, at most PAD_WALK_TRIES times", () => {
    setPadWalk(pad, 0);
    let replans = 0;
    for (let k = 0; k < 10; k++) {
      stepPadWalk(8, 8, true, 10 + k);
      if (stepPadWalk(8, 8, false, 11 + k) === "replan") replans++;
    }
    expect(replans).toBe(PAD_WALK_TRIES);
    expect(currentPadWalk()).toBeNull();
  });

  it("the keys / another tap drop it", () => {
    setPadWalk(pad, 0);
    disarmHouseUse();
    expect(currentPadWalk()).toBeNull();
    setPadWalk(pad, 0);
    setPadWalk(null, 1);
    expect(currentPadWalk()).toBeNull();
  });
});
