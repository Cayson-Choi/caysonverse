import { describe, it, expect } from "vitest";
import { SEATS, SEAT_REACH } from "@caysonverse/shared/worldMap";
import { validateSit, SEAT_OCCUPIED } from "./seating";

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
