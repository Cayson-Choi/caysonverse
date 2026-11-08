import { describe, expect, it } from "vitest";
import { pickInteraction } from "../game/interact";
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
  GUIDE_SHORT,
  GUIDE_TARGET_PREFIX,
  guideTarget,
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

describe("villageAndHallTargets — the guides' 문의하기 (Task 9A)", () => {
  it("within 2.2 m of the plaza guide: 문의하기 on that guide; past it, or from the hall, nothing", () => {
    const t = villageAndHallTargets("village", 5, 12 + 1.5);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "object", id: `${GUIDE_TARGET_PREFIX}plaza_guide`, label: "문의하기", short: GUIDE_SHORT });
    expect(t[0]!.dist).toBeCloseTo(1.5, 6);
    expect(villageAndHallTargets("village", 5, 12 + 2.3)).toHaveLength(0);
    expect(villageAndHallTargets("hall", 5, 13.5)).toHaveLength(0);
    expect(guideTarget("village", 5, 13.5)?.id).toBe("guide:plaza_guide");
  });

  it("the hall desk offers 문의하기 inside the hall, not at the arrival point and not at the way out", () => {
    const t = villageAndHallTargets("hall", 301.2, 3.0);
    expect(t.map((x) => x.id)).toContain("guide:hall_desk");
    expect(villageAndHallTargets("hall", inside.spawn.x, inside.spawn.z).map((x) => x.id)).not.toContain("guide:hall_desk");
    const pad = inside.doorPad;
    expect(villageAndHallTargets("hall", pad.centre.x, pad.centre.z).map((t) => t.kind)).toEqual(["door"]);
  });

  it("the plaza spawn offers nothing (the guide stands outside the spawn's reach)", () => {
    const s = VILLAGE_LAYOUT.spawn;
    expect(villageAndHallTargets("village", s.x, s.z)).toHaveLength(0);
  });
});

describe("the hall desk and the way out (Task 9A)", () => {
  it("where both are in reach the nearer one wins (E at the desk asks the desk, at the door it leaves)", () => {
    const pick = (x: number, z: number) =>
      pickInteraction({ seated: false, seat: null, npc: null, npcPanelOpen: false, targets: villageAndHallTargets("hall", x, z) });
    // the desk stands at (302.8, 3.0) (final fix: 1 m north of where it was, so the two reaches overlap less)
    const atDesk = pick(301.4, 3.8); // 1.61 m from the desk, 1.98 m from the pad's centre
    expect(atDesk).toMatchObject({ kind: "target", target: { id: "guide:hall_desk" } });
    const atDoor = pick(300.6, 4.6); // 0.85 m from the pad, 2.72 m from the desk (out of its reach)
    expect(atDoor).toMatchObject({ kind: "target", target: { id: MEMORIAL_DOOR_ID } });
    const between = pick(301.1, 4.2); // 1.49 m from the pad, 2.08 m from the desk: the door is nearer
    expect(between).toMatchObject({ kind: "target", target: { id: MEMORIAL_DOOR_ID } });
  });

  it("a guide and a cubby in reach: the nearer wins, the guide on a tie, whatever the door does (final fix)", () => {
    let both = 0;
    for (let x = 296; x <= 305; x += 0.1)
      for (let z = -6; z <= 6; z += 0.1) {
        const t = villageAndHallTargets("hall", x, z);
        const g = t.find((v) => v.id === "guide:hall_desk");
        const c = t.find((v) => v.id.startsWith("cubby:"));
        if (!g || !c) continue;
        both += 1;
        expect(g.priority ?? 0, `${x},${z}`).toBe(c.priority ?? 0);
        const pick = pickInteraction({ seated: false, seat: null, npc: null, npcPanelOpen: false, targets: t });
        const want = t.find((v) => (v.priority ?? 0) > (g.priority ?? 0)) ? null : c.dist < g.dist ? c.id : g.id;
        if (want) expect(pick, `${x},${z}`).toMatchObject({ target: { id: want } });
      }
    expect(both).toBeGreaterThan(0);
  });

  it("nothing is offered while the cubby card or a guide's questions are open (the action button hides)", () => {
    expect(villageAndHallTargets("hall", 301.4, 3.8).length).toBeGreaterThan(0);
    expect(villageAndHallTargets("hall", 301.4, 3.8, true)).toHaveLength(0);
    expect(villageAndHallTargets("village", 5, 13.5, true)).toHaveLength(0);
  });
});
