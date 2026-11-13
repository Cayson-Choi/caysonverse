import { describe, it, expect } from "vitest";
import { SEAT_REACH, type Seat } from "@caysonverse/shared/worldMap";
import { VILLAGE_SEATS as SEATS } from "@caysonverse/shared/village/benchSeats";
import { validateSit as validateSitOn, SEAT_OCCUPIED } from "./seating";

/** The village's benches are the seat list unless a test passes its own. */
const validateSit = (
  player: { x: number; z: number; seatIndex: number },
  payload: unknown,
  occupancy: ReadonlyMap<number, string>,
  sessionId: string,
  seats: readonly Seat[] = SEATS,
) => validateSitOn(player, payload, occupancy, sessionId, seats);

// A player standing exactly on seat `i`'s dismount point (in reach, standing).
function atSeat(i: number, seatIndex = -1) {
  const s = SEATS[i];
  return { x: s.standX, z: s.standZ, seatIndex };
}

const empty: ReadonlyMap<number, string> = new Map();
const SELF = "self-session";

describe("validateSit — payload shape (silent drop = null)", () => {
  it("accepts an in-range integer seatIndex", () => {
    const result = validateSit(atSeat(3), { seatIndex: 3 }, empty, SELF);
    expect(result).toEqual({ seatIndex: 3 });
  });

  it("drops a non-object payload", () => {
    expect(validateSit(atSeat(0), null, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), 3, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), "3", empty, SELF)).toBeNull();
  });

  it("drops a non-integer / NaN seatIndex", () => {
    expect(validateSit(atSeat(0), { seatIndex: 1.5 }, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), { seatIndex: NaN }, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), { seatIndex: "0" }, empty, SELF)).toBeNull();
  });

  it("drops an out-of-range seatIndex (including -1)", () => {
    expect(validateSit(atSeat(0), { seatIndex: -1 }, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), { seatIndex: SEATS.length }, empty, SELF)).toBeNull();
    expect(validateSit(atSeat(0), { seatIndex: 9999 }, empty, SELF)).toBeNull();
  });
});

describe("validateSit — already seated (silent drop)", () => {
  it("drops a Sit from a player who is already seated", () => {
    // Even a well-formed, in-range, in-reach request is silently dropped.
    const player = { x: SEATS[2].standX, z: SEATS[2].standZ, seatIndex: 4 };
    expect(validateSit(player, { seatIndex: 2 }, empty, SELF)).toBeNull();
  });
});

describe("validateSit — distance gate (silent drop)", () => {
  it("drops a Sit when the player is beyond SEAT_REACH of the seat", () => {
    const s = SEATS[0];
    const player = { x: s.x - (SEAT_REACH + 0.5), z: s.z, seatIndex: -1 };
    expect(validateSit(player, { seatIndex: 0 }, empty, SELF)).toBeNull();
  });

  it("accepts a Sit exactly at SEAT_REACH (boundary is inclusive)", () => {
    const s = SEATS[0];
    const player = { x: s.x - SEAT_REACH, z: s.z, seatIndex: -1 };
    expect(validateSit(player, { seatIndex: 0 }, empty, SELF)).toEqual({ seatIndex: 0 });
  });
});

describe("validateSit — occupancy (personal rejection notice)", () => {
  it("rejects with the Korean notice when the seat is taken by someone else", () => {
    const occupancy = new Map<number, string>([[3, "other-session"]]);
    const result = validateSit(atSeat(3), { seatIndex: 3 }, occupancy, SELF);
    expect(result).toEqual({ reason: SEAT_OCCUPIED });
    expect(SEAT_OCCUPIED).toBe("이미 사용 중인 자리예요");
  });

  it("still accepts if the occupancy entry for that seat is the caller itself", () => {
    // Defensive: a stale self-entry must not block the caller (never happens in
    // practice — a seated caller is already dropped by the 'already seated' gate).
    const occupancy = new Map<number, string>([[3, SELF]]);
    expect(validateSit(atSeat(3), { seatIndex: 3 }, occupancy, SELF)).toEqual({ seatIndex: 3 });
  });
});

// The seat list is an argument, so a map without seats passes [] and every Sit is dropped.
describe("validateSit — seat list argument", () => {
  it("an empty seat list accepts no Sit", () =>
    expect(validateSit({ x: SEATS[0].x, z: SEATS[0].z, seatIndex: -1 }, { seatIndex: 0 }, new Map(), "a", [])).toBeNull());

  it("judges index range and reach against the given list, not SEATS", () => {
    const far: Seat = { x: 100, z: 100, yaw: 0, standX: 101, standZ: 100 };
    // At the custom chair: in reach of it → accepted, though nowhere near the village bench SEATS[0].
    expect(validateSit({ x: 101, z: 100, seatIndex: -1 }, { seatIndex: 0 }, empty, SELF, [far])).toEqual({
      seatIndex: 0,
    });
    // At SEATS[0] (accepted with the village list) → out of reach of the custom chair.
    expect(validateSit(atSeat(0), { seatIndex: 0 }, empty, SELF)).toEqual({ seatIndex: 0 });
    expect(validateSit(atSeat(0), { seatIndex: 0 }, empty, SELF, [far])).toBeNull();
    // Index 1 exists in SEATS but not in a one-chair list → dropped.
    expect(validateSit({ x: 101, z: 100, seatIndex: -1 }, { seatIndex: 1 }, empty, SELF, [far])).toBeNull();
  });
});

// 2026-11-13: backed seats from the front only, one place with two facings is one seat.
describe("validateSit — backed seats and two-sided benches (the rebuilt hall)", () => {
  const sofa = SEATS.findIndex((s) => s.id === "sofa_a1");
  const front = SEATS.findIndex((s) => s.id === "bench_w1_s0:front");
  const back = SEATS.findIndex((s) => s.id === "bench_w1_s0:back");

  it("a sofa seat is accepted from in front of it and silently dropped from behind its backrest, though within reach", () => {
    const s = SEATS[sofa]!;
    const f = { x: Math.sin(s.yaw), z: Math.cos(s.yaw) };
    expect(validateSit({ x: s.standX, z: s.standZ, seatIndex: -1 }, { seatIndex: sofa }, empty, SELF)).toEqual({ seatIndex: sofa });
    expect(validateSit({ x: s.x - f.x * 1.2, z: s.z - f.z * 1.2, seatIndex: -1 }, { seatIndex: sofa }, empty, SELF)).toBeNull();
  });

  it("the other facing of a taken bench seat is taken too (one place), the neighbouring place is free", () => {
    const s = SEATS[back]!;
    const p = { x: s.standX, z: s.standZ, seatIndex: -1 };
    expect(validateSit(p, { seatIndex: back }, new Map([[front, "someone"]]), SELF)).toEqual({ reason: SEAT_OCCUPIED });
    const neighbour = SEATS.findIndex((v) => v.id === "bench_w1_s1:back");
    expect(validateSit(p, { seatIndex: back }, new Map([[neighbour, "someone"]]), SELF)).toEqual({ seatIndex: back });
  });
});
