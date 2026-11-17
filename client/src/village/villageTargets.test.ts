import { describe, expect, it } from "vitest";
import { pickInteraction } from "../game/interact";
import { HALL_ACTIVE_MAP } from "../game/activeMap";
import { readFileSync } from "node:fs";
import { VILLAGE_LAYOUT, type AreaId } from "@caysonverse/shared/village/villageLayout";
import { CANDLE_REACH_M } from "@caysonverse/shared/village/messages";
import { keypadEntries } from "@caysonverse/shared/village/buildingAccess";
import {
  CUBBY_LABEL,
  CUBBY_REACH_M,
  CUBBY_SHORT,
  DOOR_LABEL,
  DOOR_OFFER_REACH_M,
  DOOR_INSIDE_OFFER_HALF_WIDTH_M,
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
  it("offers the nearest house keypad only on the village side", () => {
    const entry = keypadEntries()[0]!;
    expect(villageTargets("village", entry.pad.x, entry.pad.z)).toMatchObject([
      { kind: "object", id: `keypad:${entry.buildingId}`, label: "번호키 입력" },
    ]);
    expect(villageTargets("hall", entry.pad.x, entry.pad.z)).toHaveLength(0);
  });
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
    // straight in front of the door (inside: north of it, into the room)
    const into = area === "village" ? 1 : -1;
    expect(villageTargets(area, pad.centre.x, pad.centre.z + into * (edge - 0.001))).toHaveLength(1);
    expect(villageTargets(area, pad.centre.x, pad.centre.z + into * (edge + 0.001))).toHaveLength(0);
    if (area === "village") {
      expect(villageTargets(area, pad.centre.x + edge - 0.001, pad.centre.z)).toHaveLength(1);
      expect(villageTargets(area, pad.centre.x + edge + 0.001, pad.centre.z)).toHaveLength(0);
    }
  });

  it("inside, past the pad's edge the way out is offered only straight in front of the door (round 6: not at the lounge entrance)", () => {
    const pad = doorPadFor("hall");
    expect(villageTargets("hall", 298.8, 3.15)).toHaveLength(0); // the lounge entrance, 2.37 m from the pad's centre
    expect(villageTargets("hall", pad.centre.x + DOOR_INSIDE_OFFER_HALF_WIDTH_M - 0.001, pad.centre.z - 2.2)).toHaveLength(1);
    expect(villageTargets("hall", pad.centre.x + DOOR_INSIDE_OFFER_HALF_WIDTH_M + 0.001, pad.centre.z - 2.2)).toHaveLength(0);
    // on the pad itself, anywhere
    expect(villageTargets("hall", pad.centre.x + pad.radius - 0.01, pad.centre.z)).toHaveLength(1);
    // the arrival spot
    expect(villageTargets("hall", inside.spawn.x, inside.spawn.z)).toHaveLength(1);
    // round 7: past the pad's edge only on the room's side of the door (as the server)
    expect(villageTargets("hall", pad.centre.x, pad.centre.z + 2.0)).toHaveLength(0);
    expect(villageTargets("hall", pad.centre.x, pad.centre.z - 2.0)).toHaveLength(1);
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
    expect(villageTargets("hall", sp.x, sp.z)).toHaveLength(1); // the way in lands 2.6 m from the way out's centre (round 5)
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

  it("52 columns (A 14, C 6 and B 14 on the back wall, E 18 on the east), each with its 8 rows bottom first", () => {
    expect(cols).toHaveLength(52);
    for (const c of cols) {
      expect(c.rows.map((r) => r.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
      expect(cubbyColumn(`cubby:${c.key}`)).toBe(cubbyColumn(c.key));
    }
    expect(cubbyColumn("A_99")).toBeNull();
  });

  it("in front of a column: the close-up of that column, labelled 가까이 보기", () => {
    const p = front("A_10", 0.7);
    const t = villageAndHallTargets("hall", p.x, p.z);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ kind: "object", id: "cubby:A_10", label: CUBBY_LABEL, short: CUBBY_SHORT });
    expect(t[0]!.dist).toBeCloseTo(0.7, 6);
    expect(CUBBY_LABEL).toBe("가까이 보기");
  });

  it("offered within 1.2 m, not past it; never outside the hall", () => {
    expect(CUBBY_REACH_M).toBe(1.2);
    const near = front("E_4", CUBBY_REACH_M - 0.01);
    const far = front("E_4", CUBBY_REACH_M + 0.01);
    expect(villageAndHallTargets("hall", near.x, near.z)).toHaveLength(1);
    expect(villageAndHallTargets("hall", far.x, far.z)).toHaveLength(0);
    expect(villageAndHallTargets("village", near.x, near.z)).toHaveLength(0);
  });

  it("the nearest column wins (columns are 0.425 m apart)", () => {
    const a = cubbyColumn("A_10")!;
    const b = cubbyColumn("A_11")!;
    const mid = (a.x + b.x) / 2;
    expect(nearestCubbyColumn(mid - 0.05, a.z + 0.6)!.column.key).toBe("A_10");
    expect(nearestCubbyColumn(mid + 0.05, a.z + 0.6)!.column.key).toBe("A_11");
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

  it("no 문의하기 anywhere in the hall (the desk guide was removed, owner 2026-11-17); the way out still works", () => {
    for (const [x, z] of [[305.2, 4.4], [303.0, 4.0], [inside.spawn.x, inside.spawn.z]] as const) {
      expect(villageAndHallTargets("hall", x, z).some((t) => t.id.startsWith("guide:"))).toBe(false);
    }
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
      pickInteraction({ seated: false, seat: null, targets: villageAndHallTargets("hall", x, z) });
    // the B desk stands at (306.4, 4.6), beside the widened east wall
    const atDesk = pick(305.0, 4.6); // by the desk: nobody to ask there any more
    expect(atDesk?.kind === "target" && atDesk.target.id.startsWith("guide:")).toBe(false);
    const atDoor = pick(300.6, 4.6); // 0.85 m from the pad, out of the desk's reach
    expect(atDoor).toMatchObject({ kind: "target", target: { id: MEMORIAL_DOOR_ID } });
    const between = pick(301.2, 5.2); // on the door pad and outside the desk reach
    expect(between).toMatchObject({ kind: "target", target: { id: MEMORIAL_DOOR_ID } });
  });


  it("nothing is offered while the cubby card or a guide's questions are open (the action button hides)", () => {
    // in front of a cubby column (the desk guide is gone, 2026-11-17)
    const col = cubbyColumn("A_10")!;
    const a0 = col.rows[0]!;
    const p = { x: a0.x + Math.sin(a0.yaw) * 0.7, z: a0.z + Math.cos(a0.yaw) * 0.7 };
    expect(villageAndHallTargets("hall", p.x, p.z).length).toBeGreaterThan(0);
    expect(villageAndHallTargets("hall", p.x, p.z, true)).toHaveLength(0);
    expect(villageAndHallTargets("village", 5, 13.5, true)).toHaveLength(0);
  });
});

describe("villageBusTarget — the board button under the shelter (review r2)", () => {
  it("is offered anywhere under the shelter and on the pad, and not across the road", async () => {
    const { villageBusTarget } = await import("./villageTargets");
    const s = VILLAGE_LAYOUT.busStop.shelter;
    for (const dz of [-1.6, -0.8, 0, 0.8, 1.6]) {
      for (const dx of [-0.5, 0, 0.5]) expect(villageBusTarget("village", s.centre.x + dx, s.centre.z + dz, false), `${dx},${dz}`).not.toBeNull();
    }
    expect(villageBusTarget("village", 38.5, -6.5, false)).not.toBeNull(); // the pad, by the doors
    expect(villageBusTarget("village", 30, -6.5, false)).toBeNull(); // the plaza's side of the road
    expect(villageBusTarget("village", 40, 3, false)).toBeNull(); // past the crosswalk
  });

  it("a rider is offered '버스에서 내리기' only while the bus stands at the stop, never out on the lap (checker r2)", async () => {
    const { villageBusTarget, BUS_RIDE_TARGET_LEAVE } = await import("./villageTargets");
    expect(villageBusTarget("village", 38.5, -6.5, true, true, 60_000, false)?.id).toBe(BUS_RIDE_TARGET_LEAVE);
    expect(villageBusTarget("village", 38.5, -6.5, true, false, 400_000, true)).toBeNull();
    // not boarded: no action while the bus is away or its doors are shut (2026-11-15 check: the confusing "E 버스 타기 · 10분 뒤 출발")
    expect(villageBusTarget("village", 38.5, -6.5, false, false, 400_000, true)).toBeNull();
    expect(villageBusTarget("village", 38.5, -6.5, false, false, 400_000, false)).toBeNull();
    expect(villageBusTarget("village", 38.5, -6.5, false, true, 100_000, true)).toBeNull();
  });

  it("always yields to a seat in reach (the café's north-west chairs, the shelter's bench), boarding or not (owner 2026-11-15)", async () => {
    const { villageBusTarget } = await import("./villageTargets");
    expect(villageBusTarget("village", 41.88, -10.7, false)?.yieldsToSeat).toBe(true); // chair 97 (cafe_terrace_5), 0.23 m off the area
    const s = VILLAGE_LAYOUT.busStop.shelter;
    expect(villageBusTarget("village", s.centre.x, s.centre.z, false)?.yieldsToSeat).toBe(true);
    expect(villageBusTarget("village", s.centre.x, s.centre.z, false, true, 100_000)?.yieldsToSeat).toBe(true);
  });

  it("by the bus's doors no seat is in reach, so while boarding is open E there boards the bus", async () => {
    const { villageBusTarget } = await import("./villageTargets");
    const { pickInteraction } = await import("../game/interact");
    const { nearestFreeSeat, SEAT_REACH } = await import("@caysonverse/shared/worldMap");
    const { VILLAGE_SEATS: seats } = await import("@caysonverse/shared/village/benchSeats");
    const b = VILLAGE_LAYOUT.busStop.bus;
    // the kerb strip along the bus's door side and the pad's road half, the whole length of the bus (it stands turned
    // along the kerb, 0.35 m off it: out to about x 38.9 as before; nearer the shelter its bench is in reach)
    const f = { x: Math.sin(b.yaw), z: Math.cos(b.yaw) };
    for (let dx = 0.3; dx <= 2.3; dx += 0.4) {
      for (let dz = -4; dz <= 4; dz += 0.5) {
        const x = b.centre.x - f.z * (b.size.x / 2 + dx) + f.x * dz;
        const z = b.centre.z + f.x * (b.size.x / 2 + dx) + f.z * dz;
        const index = nearestFreeSeat(x, z, () => false, SEAT_REACH, seats);
        const t = villageBusTarget("village", x, z, false, true, 100_000);
        if (!t) continue;
        const seat = index === null ? null : { index, dist: Math.hypot(x - seats[index]!.x, z - seats[index]!.z) };
        const pick = pickInteraction({ seated: false, seat, targets: [t] });
        expect(pick?.kind, `at (${x.toFixed(2)}, ${z.toFixed(2)})`).toBe("target");
      }
    }
  });

  it("outside the boarding window there is no board action (the key-less chip says when: busStopHint.ts); the countdown words stay for it (review 2026-11-15)", async () => {
    const { villageBusTarget, busCountdownWords } = await import("./villageTargets");
    const s = VILLAGE_LAYOUT.busStop.shelter;
    expect(villageBusTarget("village", s.centre.x, s.centre.z, false, false, 200_000)).toBeNull();
    expect(villageBusTarget("village", s.centre.x, s.centre.z, false, true, 20_000)).toMatchObject({ label: "버스 타기", short: "탑승" });
    expect(villageBusTarget("village", s.centre.x, s.centre.z, true, false)?.id).toBe("village_bus_leave");
    expect(busCountdownWords(45_200)).toEqual({ long: "46초", short: "46초 뒤" });
    expect(busCountdownWords(120_000)).toEqual({ long: "2분", short: "2분 뒤" });
    // within the 3 boarding minutes: minutes and seconds (review 2026-11-15: 2:01 rounded up to "3분" read as just opened)
    expect(busCountdownWords(60_001)).toEqual({ long: "1분 1초", short: "1분 1초 뒤" });
    expect(busCountdownWords(179_000)).toEqual({ long: "2분 59초", short: "2분 59초 뒤" });
    expect(busCountdownWords(180_000)).toEqual({ long: "3분", short: "3분 뒤" });
    // before boarding opens: whole minutes rounded up, so never under "4분"
    expect(busCountdownWords(180_001)).toEqual({ long: "4분", short: "4분 뒤" });
    expect(busCountdownWords(400_000)).toEqual({ long: "7분", short: "7분 뒤" });
  });
});

describe("villageBusTarget — the board button gives the shelter's bench the key (owner, 2026-11-13)", () => {
  it("yields to a free seat in reach, also while the bus is taking riders; \"leave\" never yields", async () => {
    const { villageBusTarget } = await import("./villageTargets");
    const { pickInteraction } = await import("../game/interact");
    const s = VILLAGE_LAYOUT.busStop.shelter;
    const x = s.centre.x - 0.4;
    const z = s.centre.z + 0.77;
    expect(villageBusTarget("village", x, z, false, false)).toBeNull(); // not boarding: nothing offered, the bench keeps the key
    const boarding = villageBusTarget("village", x, z, false, true)!;
    expect(boarding.yieldsToSeat).toBe(true);
    expect(villageBusTarget("village", x, z, true, true)!.yieldsToSeat).toBeUndefined();
    const seat = { index: 20, dist: 0.5 };
    // boarding (3 min, owner 2026-11-15): the bench still sits; with no seat in reach the button boards
    expect(pickInteraction({ seated: false, seat, targets: [boarding] })).toEqual({ kind: "sit", seatIndex: 20 });
    expect(pickInteraction({ seated: false, seat: null, targets: [boarding] })?.kind).toBe("target");
  });
});

describe("where the hall desk stood (removed with its chairs, owner 2026-11-17: \"안내데스크도 다 없애고 심플하게\")", () => {
  it("open floor: no seat, no guide, no desk to ask", () => {
    for (const [x, z] of [[303.0, 4.0], [304.15, 2.5], [305.0, 4.6]] as const) {
      const t = villageAndHallTargets("hall", x, z);
      expect(t.some((v) => v.id.startsWith("guide:"))).toBe(false);
      expect(((HALL_ACTIVE_MAP.seats ?? []) as readonly { id?: string }[]).some((st) => /^consult_/.test(st.id ?? ""))).toBe(false);
    }
  });
});

describe("villageBusCabinTargets: sit, get up and get off inside the bus (owner 2026-11-15; bus v3 2026-11-16: no grab handles)", () => {
  it("free in the aisle by a seat: 앉기 for the free seat, named as a rider would say it; a taken seat is skipped; never a hold", async () => {
    const { villageBusCabinTargets, parseBusSitTarget } = await import("./villageTargets");
    const { BUS_SEATS, seatApproachPoint, busSeatNumber, BUS_STANDING_SPOTS } = await import("@caysonverse/shared/village/busCabin");
    const i = BUS_SEATS.findIndex((s) => s.id === "L2");
    const front = seatApproachPoint(BUS_SEATS[i]!);
    const t = villageBusCabinTargets(0, front.ahead, front.right, new Set(), true);
    const sit = t.find((x) => x.id.startsWith("bus_sit:seat:"));
    expect(sit).toBeDefined();
    expect(sit!.label).toMatch(/^앉기 \(.+\)$/);
    expect(sit!.label).not.toMatch(/[A-Z]\d/); // not the model's ids (L2, RR1 ...)
    expect(parseBusSitTarget(sit!.id)).toEqual({ kind: "seat", index: expect.any(Number) });
    const taken = new Set<number>([busSeatNumber(i)]);
    const t2 = villageBusCabinTargets(0, front.ahead, front.right, taken, true);
    expect(t2.some((x) => x.id === `bus_sit:seat:${i}`)).toBe(false);
    for (const p of BUS_STANDING_SPOTS) {
      const all = villageBusCabinTargets(0, p.ahead, p.right, new Set(), true);
      expect(all.some((x) => x.id.startsWith("bus_sit:hold:") || x.label.includes("손잡이"))).toBe(false);
    }
  });

  it("seated: 일어나기 only; in front of the middle door while the bus stands: 내리기 first, never on the lap", async () => {
    const { villageBusCabinTargets, BUS_STAND_TARGET_ID, BUS_RIDE_TARGET_LEAVE } = await import("./villageTargets");
    const seated = villageBusCabinTargets(3, 0, 0, new Set(), true);
    expect(seated.map((x) => x.id)).toEqual([BUS_STAND_TARGET_ID]);
    const door = villageBusCabinTargets(0, -0.75, 0.81, new Set(), false);
    expect(door[0]!.id).toBe(BUS_RIDE_TARGET_LEAVE);
    const lap = villageBusCabinTargets(0, -0.75, 0.81, new Set(), true);
    expect(lap.some((x) => x.id === BUS_RIDE_TARGET_LEAVE)).toBe(false);
  });

  it("owner 2026-11-17 (no auto-sit on tap): the seat a tap walked the rider to is the one offered while it is in reach", async () => {
    const { villageBusCabinTargets } = await import("./villageTargets");
    const { BUS_SEATS, seatApproachPoint, busSeatNumber } = await import("@caysonverse/shared/village/busCabin");
    const l2 = BUS_SEATS.findIndex((s) => s.id === "L2");
    const r2 = BUS_SEATS.findIndex((s) => s.id === "R2");
    const ap = seatApproachPoint(BUS_SEATS[r2]!);
    // at R2's approach point, preferring L2 (across the aisle, in reach): L2 is offered
    const t = villageBusCabinTargets(0, ap.ahead, ap.right, new Set(), true, undefined, 0, l2);
    expect(t.find((x) => x.id.startsWith("bus_sit:"))?.id).toBe(`bus_sit:seat:${l2}`);
    // taken meanwhile: the nearest free one instead
    const t2 = villageBusCabinTargets(0, ap.ahead, ap.right, new Set([busSeatNumber(l2)]), true, undefined, 0, l2);
    expect(t2.find((x) => x.id.startsWith("bus_sit:"))?.id).not.toBe(`bus_sit:seat:${l2}`);
  });

  it("parseBusSitTarget refuses anything else", async () => {
    const { parseBusSitTarget } = await import("./villageTargets");
    expect(parseBusSitTarget("village_bus_leave")).toBeNull();
    expect(parseBusSitTarget("bus_sit:seat:x")).toBeNull();
    expect(parseBusSitTarget("bus_sit:hold:2")).toBeNull(); // the old poles are gone
    expect(parseBusSitTarget("bus_sit:seat:2")).toEqual({ kind: "seat", index: 2 });
  });
});
