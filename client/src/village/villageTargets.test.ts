import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import {
  CUBBY_LABEL,
  CUBBY_REACH_M,
  CUBBY_SHORT,
  DOOR_LABEL,
  DOOR_OFFER_REACH_M,
  DOOR_SHORT,
  MEMORIAL_DOOR_ID,
  cubbyColumn,
  cubbyColumns,
  doorPadFor,
  nearestCubbyColumn,
  villageAndHallTargets,
  villageTargets,
} from "./villageTargets";

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

describe("villageAndHallTargets — the cubbies' close-up inside the hall (Task 9)", () => {
  const cols = cubbyColumns();
  const front = (key: string, d: number) => {
    const c = cubbyColumn(key)!;
    const a = c.rows[0]!;
    // d metres in front of the column, along its facing
    return { x: c.x + Math.sin(a.yaw) * d, z: c.z + Math.cos(a.yaw) * d };
  };

  it("38 columns (20 on the back wall, 18 on the east), each with its 7 rows bottom first", () => {
    expect(cols).toHaveLength(38);
    for (const c of cols) {
      expect(c.rows.map((r) => r.row)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      expect(cubbyColumn(`cubby:${c.key}`)).toBe(cubbyColumn(c.key));
    }
    expect(cubbyColumn("n_99")).toBeNull();
  });

  it("in front of a column: the close-up of that column, labelled 가까이 보기", () => {
    const p = front("n_10", 0.7);
    const t = villageAndHallTargets("hall", p.x, p.z);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "object", id: "cubby:n_10", label: CUBBY_LABEL, short: CUBBY_SHORT });
    expect(t[0]!.dist).toBeCloseTo(0.7, 6);
    expect(CUBBY_LABEL).toBe("가까이 보기");
  });

  it("offered within 1.2 m, not past it; never outside the hall", () => {
    expect(CUBBY_REACH_M).toBe(1.2);
    const near = front("e_4", CUBBY_REACH_M - 0.01);
    const far = front("e_4", CUBBY_REACH_M + 0.01);
    expect(villageAndHallTargets("hall", near.x, near.z)).toHaveLength(1);
    expect(villageAndHallTargets("hall", far.x, far.z)).toHaveLength(0);
    expect(villageAndHallTargets("village", near.x, near.z)).toHaveLength(0);
  });

  it("the nearest column wins (columns are 0.425 m apart)", () => {
    const a = cubbyColumn("n_10")!;
    const b = cubbyColumn("n_11")!;
    const mid = (a.x + b.x) / 2;
    expect(nearestCubbyColumn(mid - 0.05, a.z + 0.6)!.column.key).toBe("n_10");
    expect(nearestCubbyColumn(mid + 0.05, a.z + 0.6)!.column.key).toBe("n_11");
  });

  it("the door still comes alone at the way out (no column near it), and the spawn and the room's middle offer no cubby", () => {
    const pad = inside.doorPad;
    expect(villageAndHallTargets("hall", pad.centre.x, pad.centre.z).map((t) => t.kind)).toEqual(["door"]);
    expect(villageAndHallTargets("hall", inside.origin.x, inside.origin.z)).toHaveLength(0);
  });

  it("the client's reach is inside the server's candle reach (1.5 m)", () => {
    expect(CUBBY_REACH_M).toBeLessThan(CANDLE_REACH_M);
  });
});
