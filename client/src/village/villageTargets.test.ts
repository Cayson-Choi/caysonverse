import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { DOOR_LABEL, DOOR_OFFER_REACH_M, DOOR_SHORT, MEMORIAL_DOOR_ID, doorPadFor, villageTargets } from "./villageTargets";

const outside = VILLAGE_LAYOUT.memorial.exterior;
const inside = VILLAGE_LAYOUT.memorial.interior;

describe("villageTargets — the memorial hall's door", () => {
  it("outside, within reach of the front door: one door target, labelled 추모관 들어가기", () => {
    const pad = outside.doorPad;
    const targets = villageTargets("village", pad.centre.x, pad.centre.z);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: "door", id: MEMORIAL_DOOR_ID, label: "추모관 들어가기", short: "들어가기", icon: "🚪" });
    expect(targets[0].dist).toBe(0);
  });

  it("inside, within reach of the way out: one door target, labelled 밖으로 나가기", () => {
    const pad = inside.doorPad;
    const targets = villageTargets("hall", pad.centre.x, pad.centre.z + 0.5);
    expect(targets).toHaveLength(1);
    expect(targets[0]).toMatchObject({ kind: "door", label: "밖으로 나가기", short: "나가기" });
    expect(targets[0].dist).toBeCloseTo(0.5, 6);
  });

  it("the labels are exactly the owner's words", () => {
    expect(DOOR_LABEL).toEqual({ village: "추모관 들어가기", hall: "밖으로 나가기" });
    expect(DOOR_SHORT).toEqual({ village: "들어가기", hall: "나가기" });
  });

  it.each<[AreaId]>([["village"], ["hall"]])("%s: offered within the pad radius + the offer reach, not an inch past it", (area) => {
    const pad = doorPadFor(area);
    const edge = pad.radius + DOOR_OFFER_REACH_M;
    expect(villageTargets(area, pad.centre.x + edge - 0.001, pad.centre.z)).toHaveLength(1);
    expect(villageTargets(area, pad.centre.x + edge + 0.001, pad.centre.z)).toHaveLength(0);
    expect(villageTargets(area, pad.centre.x, pad.centre.z - edge - 0.001)).toHaveLength(0);
  });

  it("away from the door nothing is offered: the spawn, the plaza, a plot's sign, the middle of the hall", () => {
    const { spawn } = VILLAGE_LAYOUT;
    expect(villageTargets("village", spawn.x, spawn.z)).toHaveLength(0);
    expect(villageTargets("village", 0, 0)).toHaveLength(0);
    const sign = VILLAGE_LAYOUT.plots.find((p) => p.id === "plot_e")!.signPost!;
    expect(villageTargets("village", sign.x, sign.z)).toHaveLength(0);
    expect(villageTargets("hall", inside.origin.x, inside.origin.z)).toHaveLength(0);
    expect(villageTargets("hall", inside.spawn.x, inside.spawn.z - 1)).toHaveLength(0);
  });

  it("each area offers ITS door only: the hall's pad is nothing to a player the village thinks is outside, and the reverse", () => {
    expect(villageTargets("village", inside.doorPad.centre.x, inside.doorPad.centre.z)).toHaveLength(0);
    expect(villageTargets("hall", outside.doorPad.centre.x, outside.doorPad.centre.z)).toHaveLength(0);
  });

  it("a position that is not a number offers nothing", () => {
    expect(villageTargets("village", Number.NaN, 0)).toHaveLength(0);
    expect(villageTargets("hall", 300, Number.NaN)).toHaveLength(0);
  });

  it("the offer reach is inside the server's (pad radius + 0.9 m), read from the server's own file", () => {
    const src = readFileSync(new URL("../../../server/src/rooms/villageDoor.ts", import.meta.url), "utf8");
    const serverReach = Number(src.match(/export const DOOR_REACH_M = ([0-9.]+);/)?.[1]);
    expect(serverReach).toBeGreaterThan(0);
    expect(DOOR_OFFER_REACH_M).toBeLessThan(serverReach);
    expect(DOOR_OFFER_REACH_M).toBeGreaterThan(0);
  });

  it("both arrival points are still within the offer reach, so the button is there again after a door", () => {
    const out = outside.arrival;
    const sp = inside.spawn;
    expect(villageTargets("village", out.x, out.z)).toHaveLength(1); // the way out lands 2.2 m from the front door's centre
    expect(villageTargets("hall", sp.x, sp.z)).toHaveLength(1); // the way in lands 1.6 m from the way out's centre
  });
});
