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

describe("validateSit — a bench with a back is sat on from the front only", () => {
  const SHELTER = SEATS.findIndex((s) => s.bench === "shelter");
  const PLAZA = 0;
  const behind = (i: number, d: number) => {
    const s = SEATS[i];
    return { x: s.x - Math.sin(s.yaw) * d, z: s.z - Math.cos(s.yaw) * d, seatIndex: -1 };
  };

  it("accepts from in front of the shelter's bench, drops from behind its glass back, even within reach", () => {
    expect(SHELTER).toBeGreaterThanOrEqual(0);
    expect(validateSit(atSeat(SHELTER), { seatIndex: SHELTER }, empty, SELF)).toEqual({ seatIndex: SHELTER });
    expect(validateSit(behind(SHELTER, 1.2), { seatIndex: SHELTER }, empty, SELF)).toBeNull();
  });

  it("the plaza benches too; a seat without a front edge (a chair) keeps any side", () => {
    expect(validateSit(behind(PLAZA, 1.2), { seatIndex: PLAZA }, empty, SELF)).toBeNull();
    const chair: Seat = { x: 0, z: 0, yaw: 0, standX: 0, standZ: 1 };
    expect(validateSit({ x: 0, z: -1, seatIndex: -1 }, { seatIndex: 0 }, empty, SELF, [chair])).toEqual({ seatIndex: 0 });
  });
});
