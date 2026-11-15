import { describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { SEAT_REACH, approachesSeat, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { furnitureClick } from "./furnitureClick";

const free = () => false;
const idOf = (i: number | null | undefined) => (i === null || i === undefined ? null : VILLAGE_SEATS[i]!.id);
const seat = (id: string) => VILLAGE_SEATS.find((s) => s.id === id)!;
const offeredAt = (x: number, z: number) =>
  idOf(nearestFreeSeat(x, z, (i) => VILLAGE_SEATS[i]!.area !== "hall", SEAT_REACH, VILLAGE_SEATS));

describe("a click on furniture (round 8 review: a tap on the sofa did nothing)", () => {
  it("a click on a seat's cushion or backrest walks to that seat's approach, where that very seat is offered", () => {
    for (const id of ["sofa_a0", "sofa_a1", "sofa_b0", "armchair_0", "armchair_1", "letter_n0", "letter_s1", "consult_0"]) {
      const s = seat(id);
      // the cushion's front, its middle, and the backrest (behind the cushion)
      for (const back of [0.05, 0.2, 0.45].map((b) => b + (s.frontEdge ?? 0))) {
        const pick = { x: s.x - Math.sin(s.yaw) * back, y: 0.6, z: s.z - Math.cos(s.yaw) * back };
        const fc = furnitureClick(pick, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)!;
        expect(idOf(fc.seatIndex), `${id} back ${back}`).toBe(id);
        expect(fc.surface).toEqual({ x: s.standX, y: 0, z: s.standZ, ny: 1 });
        expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
        expect(offeredAt(s.standX, s.standZ), id).toBe(id);
      }
    }
  });

  it("a backless bench is sat on from the side the player comes from", () => {
    const front = seat("bench_w1_s0:front");
    const back = seat("bench_w1_s0:back");
    const pick = { x: (front.x + back.x) / 2, y: 0.45, z: (front.z + back.z) / 2 };
    const fromFront = furnitureClick(pick, VILLAGE_SEATS, "hall", free, { x: front.standX, z: front.standZ + Math.sign(front.standZ - pick.z) * 2 }, 0, true)!;
    const fromBack = furnitureClick(pick, VILLAGE_SEATS, "hall", free, { x: back.standX, z: back.standZ + Math.sign(back.standZ - pick.z) * 2 }, 0, true)!;
    expect(idOf(fromFront.seatIndex)).toBe("bench_w1_s0:front");
    expect(idOf(fromBack.seatIndex)).toBe("bench_w1_s0:back");
  });

  it("a seat someone sits on, or another area's, is just furniture; other furniture walks next to it in the hall only", () => {
    const s = seat("sofa_a0");
    const i = VILLAGE_SEATS.indexOf(s);
    const pick = { x: s.x, y: 0.5, z: s.z };
    const taken = furnitureClick(pick, VILLAGE_SEATS, "hall", (k) => k === i, { x: 300, z: 0 }, 0, true)!;
    expect(taken.seatIndex === i).toBe(false);
    // the letter table's top: the floor under it (the plan moves it out of the table's box)
    const table = furnitureClick({ x: 294.4, y: 0.75, z: -2.95 }, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)!;
    expect(table.seatIndex).toBeNull();
    expect(table.surface).toEqual({ x: 294.4, y: 0, z: -2.95, ny: 1 });
    expect(furnitureClick({ x: 294.4, y: 0.75, z: -2.95 }, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, false)).toBeNull();
    // higher than furniture (a wall, the louvres): nothing
    expect(furnitureClick({ x: 294.4, y: 2.0, z: -2.95 }, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)).toBeNull();
  });
});
