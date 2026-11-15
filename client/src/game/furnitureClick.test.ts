import { describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { SEAT_REACH, approachesSeat, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { furnitureClick, seatRayEntry, type ClickRay } from "./furnitureClick";

const free = () => false;
const idOf = (i: number | null | undefined) => (i === null || i === undefined ? null : VILLAGE_SEATS[i]!.id);
const seat = (id: string) => VILLAGE_SEATS.find((s) => s.id === id)!;
const offeredAt = (x: number, z: number) =>
  idOf(nearestFreeSeat(x, z, (i) => VILLAGE_SEATS[i]!.area !== "hall", SEAT_REACH, VILLAGE_SEATS));

type V = { x: number; y: number; z: number };
/** The ray from the camera `o` through `p`. */
const rayTo = (o: V, p: V): ClickRay => {
  const d = { x: p.x - o.x, y: p.y - o.y, z: p.z - o.z };
  const l = Math.hypot(d.x, d.y, d.z);
  return { o, d: { x: d.x / l, y: d.y / l, z: d.z / l } };
};
const at = (r: ClickRay, t: number) => ({ x: r.o.x + r.d.x * t, y: r.o.y + r.d.y * t, z: r.o.z + r.d.z * t, distance: t });
/** A seat's cushion centre, `up` above its surface, `back` m behind its front edge. */
const cushion = (id: string, up = 0.05, back = 0.2): V => {
  const s = seat(id);
  const b = (s.frontEdge ?? 0) + back;
  return { x: s.x - Math.sin(s.yaw) * b, y: (s.seatY ?? 0.45) + up, z: s.z - Math.cos(s.yaw) * b };
};
/** The letter table's top (y 0.76): where `r` meets it, if it does. */
const LETTER_TABLE = { minX: 293.4, maxX: 295.4, minZ: -3.35, maxZ: -2.55, top: 0.76 };
const tableTopHit = (r: ClickRay) => {
  const t = (LETTER_TABLE.top - r.o.y) / r.d.y;
  const p = at(r, t);
  return t > 0 && p.x > LETTER_TABLE.minX && p.x < LETTER_TABLE.maxX && p.z > LETTER_TABLE.minZ && p.z < LETTER_TABLE.maxZ ? p : null;
};

describe("a click on furniture (round 8 review: a tap on the sofa did nothing; round 9: by the click's ray)", () => {
  it("a click on a seat's cushion or backrest walks to that seat's approach, where that very seat is offered", () => {
    for (const id of ["sofa_a0", "sofa_a1", "sofa_b0", "armchair_0", "armchair_1", "letter_n0", "letter_s1", "consult_0"]) {
      const s = seat(id);
      // a camera 2.5 m in front of the seat and 1.6 m up, looking at the cushion's front, its middle, and the backrest
      const cam = { x: s.x + Math.sin(s.yaw) * 2.5, y: 1.9, z: s.z + Math.cos(s.yaw) * 2.5 };
      for (const p of [cushion(id, 0.02, 0.05), cushion(id, 0.02, 0.2), cushion(id, 0.35, 0.5)]) {
        const r = rayTo(cam, p);
        const pick = at(r, Math.hypot(p.x - cam.x, p.y - cam.y, p.z - cam.z));
        const fc = furnitureClick(pick, r, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)!;
        expect(idOf(fc.seatIndex), `${id} ${JSON.stringify(p)}`).toBe(id);
        expect(fc.surface).toEqual({ x: s.standX, y: 0, z: s.standZ, ny: 1 });
        expect(approachesSeat(s, s.standX, s.standZ)).toBe(true);
        expect(offeredAt(s.standX, s.standZ), id).toBe(id);
      }
    }
  });

  it("a letter chair half hidden behind the table, tapped from the aisle, is that chair (round 9: the tap hit the table top)", () => {
    let hidden = 0;
    for (const id of ["letter_n0", "letter_n1", "letter_s0", "letter_s1"]) {
      // the aisle and the hall's middle, a third-person camera's height (PC 1.9-2.4 m, phone 2.6 m)
      for (const cam of [
        { x: 299.0, y: 1.9, z: -0.5 },
        { x: 300.0, y: 2.4, z: 1.5 },
        { x: 298.0, y: 2.6, z: -4.6 },
        { x: 297.5, y: 2.1, z: 0.8 },
      ]) {
        const target = cushion(id, 0.1);
        const r = rayTo(cam, target);
        // another chair in front of this one on the screen is what the tap is on (its volume is entered first)
        const first = VILLAGE_SEATS.map((_, i) => i).filter((i) => VILLAGE_SEATS[i]!.area === "hall").sort((a, b) => seatRayEntry(r, VILLAGE_SEATS, a) - seatRayEntry(r, VILLAGE_SEATS, b))[0]!;
        if (idOf(first) !== id) continue;
        const top = tableTopHit(r);
        const pick = top ?? at(r, Math.hypot(target.x - cam.x, target.y - cam.y, target.z - cam.z));
        if (top) hidden++;
        const fc = furnitureClick(pick, r, VILLAGE_SEATS, "hall", free, { x: cam.x, z: cam.z }, 0, true)!;
        expect(idOf(fc.seatIndex), `${id} from ${JSON.stringify(cam)} ${top ? "(table top first)" : ""}`).toBe(id);
      }
    }
    expect(hidden).toBeGreaterThanOrEqual(4); // the reviewer's case (the table top met first) is in the sweep
  });

  it("a backless bench is sat on from the side the player comes from", () => {
    const front = seat("bench_w1_s0:front");
    const back = seat("bench_w1_s0:back");
    const mid = { x: (front.x + back.x) / 2, y: 0.46, z: (front.z + back.z) / 2 };
    for (const [side, want] of [
      [front, "bench_w1_s0:front"],
      [back, "bench_w1_s0:back"],
    ] as const) {
      const away = Math.sign(side.standZ - mid.z);
      const cam = { x: side.standX, y: 1.9, z: side.standZ + away * 2 };
      const r = rayTo(cam, mid);
      const fc = furnitureClick(at(r, Math.hypot(mid.x - cam.x, mid.y - cam.y, mid.z - cam.z)), r, VILLAGE_SEATS, "hall", free, { x: cam.x, z: cam.z }, 0, true)!;
      expect(idOf(fc.seatIndex)).toBe(want);
    }
  });

  it("a click meeting a bench's leg below its board is no click on the bench: the floor the ray goes on to (round 9)", () => {
    // seen from the north strip, low on the front bench's north face (its leg, y 0.15): no sitting
    const cam = { x: 302.0, y: 1.3, z: -4.6 };
    const leg = { x: 302.2, y: 0.15, z: -2.91 };
    const r = rayTo(cam, leg);
    const hit = at(r, Math.hypot(leg.x - cam.x, leg.y - cam.y, leg.z - cam.z));
    const fc = furnitureClick(hit, r, VILLAGE_SEATS, "hall", free, { x: cam.x, z: cam.z }, 0, true)!;
    expect(fc.seatIndex).toBeNull();
    const t = -cam.y / r.d.y;
    expect(fc.surface.x).toBeCloseTo(cam.x + r.d.x * t, 6);
    expect(fc.surface.z).toBeCloseTo(cam.z + r.d.z * t, 6);
    expect(fc.surface.y).toBe(0);
    // ...while its board's top is still the bench (sat from the player's side: the front facing, north)
    const top = { x: 302.2, y: 0.455, z: -2.8 };
    const r2 = rayTo(cam, top);
    const sat = furnitureClick(at(r2, Math.hypot(top.x - cam.x, top.y - cam.y, top.z - cam.z)), r2, VILLAGE_SEATS, "hall", free, { x: cam.x, z: cam.z }, 0, true)!;
    expect(idOf(sat.seatIndex)).toBe("bench_e1_s1:front");
  });

  it("a seat someone sits on, or another area's, is just furniture; other furniture walks next to it in the hall only", () => {
    const s = seat("sofa_a0");
    const i = VILLAGE_SEATS.indexOf(s);
    const cam = { x: s.x, y: 1.9, z: s.z - 2.5 };
    const c = cushion("sofa_a0");
    const r = rayTo(cam, c);
    const pick = at(r, Math.hypot(c.x - cam.x, c.y - cam.y, c.z - cam.z));
    const taken = furnitureClick(pick, r, VILLAGE_SEATS, "hall", (k) => k === i, { x: 300, z: 0 }, 0, true)!;
    expect(taken.seatIndex === i).toBe(false);
    // the letter table's middle seen steeply from above: the floor under it (the plan moves it out of the table's box)
    const tableCam = { x: 294.4, y: 3.0, z: -1.2 };
    const mid = { x: 294.4, y: 0.76, z: -2.95 };
    const rt = rayTo(tableCam, mid);
    const table = furnitureClick(at(rt, Math.hypot(mid.x - tableCam.x, mid.y - tableCam.y, mid.z - tableCam.z)), rt, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)!;
    expect(table.seatIndex).toBeNull();
    expect(table.surface.y).toBe(0);
    expect(Math.hypot(table.surface.x - 294.4, table.surface.z - -2.95)).toBeLessThan(0.7);
    expect(furnitureClick({ ...mid, distance: 2 }, rt, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, false)).toBeNull();
    // higher than furniture (a wall, the louvres): nothing
    expect(furnitureClick({ x: 294.4, y: 2.0, z: -2.95 }, rt, VILLAGE_SEATS, "hall", free, { x: 300, z: 0 }, 0, true)).toBeNull();
  });

  it("a ray that misses every seat's volume enters none of them", () => {
    const r = rayTo({ x: 300, y: 2, z: 0 }, { x: 300, y: 0, z: 0.5 });
    for (let i = 0; i < VILLAGE_SEATS.length; i++) expect(seatRayEntry(r, VILLAGE_SEATS, i)).toBe(Infinity);
  });
});
