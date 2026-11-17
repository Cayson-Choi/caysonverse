import { describe, expect, it } from "vitest";
import { VILLAGE_SEATS, standsClear, type VillageSeat } from "./benchSeats";
import { VILLAGE_LAYOUT } from "./villageLayout";
import { houseFloorBounds, parseHouseFloorArea } from "./houseAreas";
import { BUS_SEATS, BUS_STAND_BEHIND_MAX, cabinBlocked, facingVector, seatStandUpSpot } from "./busCabin";
import { BODY_APART, FRONT_MIN, pickStandSpot, seatAhead, standCandidates, standSide } from "./standSpot";
import type { Bounds } from "../school/geometry";

/**
 * Owner 2026-11-17: "식탁이나 의자가 너무 붙어서 앉고 일어날 의자 뒤로 갑자기 일어서고 이런 건 없어야 해 실제처럼 의자 앞에 가서 앉고
 * 일어서면 의자 앞에 서고 이래야 돼 등받이 있는 의자의 경우에는" — the sweep over every backed seat of the game.
 */

const backed = (s: VillageSeat) => s.kind === "backed" || (s.lean ?? 0) > 0;
const BACKED = VILLAGE_SEATS.filter(backed);
const boundsOf = (s: VillageSeat): Bounds => {
  const h = parseHouseFloorArea(s.area);
  return h ? houseFloorBounds(h.n, h.floor) : VILLAGE_LAYOUT.areas[s.area as "village" | "hall"];
};

/**
 * Backed seats whose FRONT the layout itself blocks, stood up from BESIDE them instead (never behind): the chair's table or desk, the
 * chairs next to it, or (a fishing chair) the water. Exact, so a layout change that frees a front — or blocks one — shows here.
 * Owners: the hall's chairs (memorial), the terrace (village), the houses (house interiors), the fishing chairs (lake).
 */
const BESIDE_ONLY: Record<string, readonly string[]> = {
  hall: ["consult_0", "letter_n0", "letter_n1", "letter_s0", "letter_s1"],
  cafe: ["cafe_terrace_1", "cafe_terrace_2", "cafe_terrace_3", "cafe_terrace_4", "cafe_terrace_5", "cafe_terrace_6", "cafe_terrace_7", "cafe_terrace_8"],
  houses: [
    "h1_1_4", "h1_1_5", "h1_1_6", "h1_1_7", "h1_2_3", "h2_2_1", "h3_1_0", "h3_1_2", "h3_1_3", "h3_1_5", "h4_1_0", "h4_1_1",
    "h5_1_4", "h5_1_5", "h5_1_6", "h5_1_7", "h6_1_4", "h7_1_5", "h9_1_3", "h9_1_4", "h9_1_5", "h9_1_8", "h9_1_9",
  ],
  lake: [
    "P01", "P02", "P03", "P04", "P05", "P06", "P07", "P08", "P09", "P10", "P11", "P12", "P13", "P14", "P15", "P16",
    "A1", "A2", "A3", "A4", "B1", "B2", "B3", "B4", "N1", "N2", "N3", "S1", "S2", "S3",
  ].map((k) => `lake:chair_${k}`),
};

/**
 * Backed seats walled in front AND at both sides by the layout, whose only stand spot is still BEHIND the backrest — what the owner
 * forbids. Not fixable in the seat code: the furniture must move (reported to their owners). This list may only shrink.
 */
const BEHIND_LAYOUT_BLOCKED = ["consult_1", "h2_1_3", "h2_2_2", "h3_1_1", "h3_1_4"];

describe("standSide / standCandidates: in front, beside, never behind the backrest", () => {
  const plaza = VILLAGE_SEATS[0]!;
  it("ahead of the seat point is front; past the backrest within the seat's width is behind; the rest beside", () => {
    const f = { x: Math.sin(plaza.yaw), z: Math.cos(plaza.yaw) };
    expect(standSide(plaza, plaza.x + f.x * 0.6, plaza.z + f.z * 0.6)).toBe("front");
    expect(standSide(plaza, plaza.x - f.x * 1.2, plaza.z - f.z * 1.2)).toBe("behind");
    // to the side, a body clear of the seat: beside
    expect(standSide(plaza, plaza.x + f.z * 1.0, plaza.z - f.x * 1.0)).toBe("beside");
  });

  it("every candidate of every backed seat: never behind its backrest, never more behind than its own stand point; the stand point first", () => {
    for (const s of BACKED) {
      const c = standCandidates(s);
      expect(c[0]).toEqual({ x: s.standX, z: s.standZ });
      const base = seatAhead(s, s.standX, s.standZ);
      for (const p of c.slice(1)) {
        expect(standSide(s, p.x, p.z), `${s.id} ${p.x},${p.z}`).not.toBe("behind");
        expect(seatAhead(s, p.x, p.z), s.id).toBeGreaterThanOrEqual(Math.min(base, FRONT_MIN) - 1e-6);
      }
      // a seat stood up from in front keeps every alternative in front too (front-left / front-right, further forward)
      if (standSide(s, s.standX, s.standZ) === "front") for (const p of c) expect(standSide(s, p.x, p.z), s.id).toBe("front");
    }
  });
});

describe("the sweep: every backed seat of the game is stood up from in front of it (owner 2026-11-17)", () => {
  it(`covers them all: ${BACKED.length} backed seats — plaza, shelter, café, porches, houses, the hall, the lake`, () => {
    const areas = new Set(BACKED.map((s) => (parseHouseFloorArea(s.area) ? "house" : s.area)));
    expect([...areas].sort()).toEqual(["hall", "house", "village"]);
    expect(BACKED.length).toBeGreaterThan(130);
  });

  it("every stand point is clear of the furniture (and inside its room)", () => {
    for (const s of BACKED) expect(standsClear(s.standX, s.standZ, boundsOf(s)), s.id).toBe(true);
  });

  it("in front of the seat — except the listed seats whose front the layout blocks (beside them instead), and none behind but the known few", () => {
    const beside: string[] = [];
    const behind: string[] = [];
    for (const s of BACKED) {
      const side = standSide(s, s.standX, s.standZ);
      if (side === "beside") beside.push(s.id);
      if (side === "behind") behind.push(s.id);
    }
    expect(beside.sort()).toEqual(Object.values(BESIDE_ONLY).flat().sort());
    expect(behind.sort()).toEqual([...BEHIND_LAYOUT_BLOCKED].sort());
  });

  it("standing up lands on the stand point when it is free — the same spot the server picks", () => {
    for (const s of BACKED) expect(pickStandSpot(s, (x, z) => standsClear(x, z, boundsOf(s))), s.id).toEqual({ x: s.standX, z: s.standZ });
  });

  it("someone standing on the stand point: the next free spot in front (front-left / front-right / further), clear of them — or none (stay seated)", () => {
    const stuck: string[] = [];
    for (const s of BACKED) {
      const other = { x: s.standX, z: s.standZ };
      const spot = pickStandSpot(s, (x, z) => standsClear(x, z, boundsOf(s)) && Math.hypot(x - other.x, z - other.z) >= BODY_APART);
      if (!spot) {
        stuck.push(s.id);
        continue;
      }
      expect(standsClear(spot.x, spot.z, boundsOf(s)), s.id).toBe(true);
      expect(Math.hypot(spot.x - other.x, spot.z - other.z), s.id).toBeGreaterThanOrEqual(BODY_APART);
      expect(standSide(s, spot.x, spot.z), s.id).not.toBe("behind");
      if (standSide(s, s.standX, s.standZ) === "front") expect(standSide(s, spot.x, spot.z), s.id).toBe("front");
    }
    // the plaza's and the shelter's benches always have room for a second body in front
    expect(stuck.filter((id) => id.startsWith("plaza_") || id.startsWith("shelter"))).toEqual([]);
  });

  it("the bus: every seat stands up in front of it or into the aisle beside it, never behind its back; a full aisle keeps the rider seated", () => {
    for (const s of BUS_SEATS) {
      const spot = seatStandUpSpot(s);
      expect(spot, s.id).not.toBeNull();
      const f = facingVector(s.yaw);
      const along = (spot!.ahead - s.ahead) * f.ahead + (spot!.right - s.right) * f.right;
      if (s.backed) expect(along, s.id).toBeGreaterThanOrEqual(-BUS_STAND_BEHIND_MAX);
      expect(cabinBlocked(spot!.ahead, spot!.right), s.id).toBe(false);
    }
    // riders on every spot in front of and beside a seat: no spot behind it is taken instead — the rider stays seated
    const seat = BUS_SEATS.find((x) => x.id === "R2")!;
    const crowd: { ahead: number; right: number }[] = [];
    for (let a = -1.6; a <= 1.6 + 1e-9; a += 0.1) for (let r = -1.2; r <= 1.2 + 1e-9; r += 0.1) crowd.push({ ahead: seat.ahead + a, right: r });
    expect(seatStandUpSpot(seat, crowd)).toBeNull();
  });
});
