import { describe, expect, it } from "vitest";
import { VILLAGE_SEATS } from "@caysonverse/shared/village/benchSeats";
import { SEAT_REACH, approachesSeat, nearestFreeSeat } from "@caysonverse/shared/worldMap";
import { VILLAGE_FURNITURE } from "./activeMap";
import { furnitureClick, seatRayEntry, seatThroughFloor, type ClickRay } from "./furnitureClick";

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
describe("a click on furniture (round 8 review: a tap on the sofa did nothing; round 9: by the click's ray)", () => {
  it("a click on a seat's cushion or backrest walks to that seat's approach, where that very seat is offered", () => {
    for (const id of ["sofa_a0", "sofa_a1", "sofa_b0", "armchair_0", "armchair_1"]) {
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

// Hotfix 2026-11-16 ("광장에 있는 벤치에 앉기가 안되는데"): the plaza's 16 seats (0..15, backed benches facing the fountain).
describe("a click on a plaza bench, from any side (hotfix 2026-11-16)", () => {
  const PLAZA = VILLAGE_SEATS.slice(0, 16);
  /** parts_props.py `bench`: slats 0.2625 m either side of the middle; three backrest slats 0.30-0.324 m behind it, 0.56-0.885 m up. */
  const HALF_DEPTH = 0.2625;
  const BACKREST_BACK = 0.324;
  const middleOf = (s: (typeof PLAZA)[number]) => (s.frontEdge ?? 0) + HALF_DEPTH; // the bench's middle, behind the seat point
  const toward = (s: (typeof PLAZA)[number], back: number, y: number): V => ({ x: s.x - Math.sin(s.yaw) * back, y, z: s.z - Math.cos(s.yaw) * back });
  const behindCam = (s: (typeof PLAZA)[number], d: number, y: number): V => toward(s, middleOf(s) + d, y);
  const offeredInVillage = (x: number, z: number) =>
    idOf(nearestFreeSeat(x, z, (k) => VILLAGE_SEATS[k]!.area !== "village", SEAT_REACH, VILLAGE_SEATS));
  const sitOn = (pick: V & { distance: number }, r: ClickRay, from: V) =>
    furnitureClick(pick, r, VILLAGE_SEATS, "village", free, { x: from.x, z: from.z }, 0, false);

  it("the plaza's seats are backed benches sat upright (no lean): their backrest is part of the click", () => {
    expect(PLAZA.every((s) => s.bench.startsWith("plaza_") && s.kind === "backed" && s.lean === 0)).toBe(true);
  });

  it("a click on the backrest of a bench facing away, from near or far, low or high, walks to that seat to sit on it", () => {
    PLAZA.forEach((s, i) => {
      for (const [d, camY] of [[2.5, 1.9], [5.5, 2.6], [9, 3.4], [12, 4.5]] as const) {
        const cam = behindCam(s, d, camY);
        for (const y of [0.6, 0.72, 0.84]) {
          const target = toward(s, middleOf(s) + BACKREST_BACK, y); // the backrest's back face, where the ray meets it
          const r = rayTo(cam, target);
          const fc = sitOn(at(r, Math.hypot(target.x - cam.x, target.y - cam.y, target.z - cam.z)), r, cam);
          expect(fc?.seatIndex, `seat ${i} from ${d} m behind, backrest at ${y} m`).toBe(i);
          // ...its approach, in front of the bench, where that very seat is offered
          expect(approachesSeat(s, fc!.surface.x, fc!.surface.z)).toBe(true);
          expect(offeredInVillage(fc!.surface.x, fc!.surface.z)).toBe(s.id);
        }
      }
    });
  });

  it("a click on the board from in front or from beyond its end sits on that seat", () => {
    PLAZA.forEach((s, i) => {
      const board = toward(s, (s.frontEdge ?? 0) + 0.15, (s.seatY ?? 0.445) + 0.005);
      const front = { x: s.x + Math.sin(s.yaw) * 3, y: 2.2, z: s.z + Math.cos(s.yaw) * 3 };
      const mate = PLAZA.find((o) => o.bench === s.bench && o !== s)!;
      const end = { x: s.x + (s.x - mate.x) * 1.8, y: 2.0, z: s.z + (s.z - mate.z) * 1.8 };
      for (const cam of [front, end]) {
        const r = rayTo(cam, board);
        expect(sitOn(at(r, Math.hypot(board.x - cam.x, board.y - cam.y, board.z - cam.z)), r, cam)?.seatIndex, `seat ${i}`).toBe(i);
      }
    });
  });

  it("a click that goes between the slats to the floor under the bench is that seat; the floor beside the bench stays floor", () => {
    PLAZA.forEach((s, i) => {
      const cam = behindCam(s, 3, 4.0);
      // aimed between the board and the backrest: the ray goes on to the floor under the bench
      const aim = toward(s, middleOf(s) + 0.1, 0.5);
      const r = rayTo(cam, aim);
      const t = -cam.y / r.d.y;
      const floor = at(r, t);
      const fc = seatThroughFloor({ ...floor, y: 0 }, r, VILLAGE_SEATS, "village", free, { x: cam.x, z: cam.z }, VILLAGE_FURNITURE);
      expect(fc?.seatIndex, `seat ${i}`).toBe(i);
      // the floor a metre in front of the bench, seen over it: not under any furniture, so just floor
      const open = toward(s, -1.0, 0);
      const r2 = rayTo(cam, open);
      expect(seatThroughFloor({ ...open, distance: 1 }, r2, VILLAGE_SEATS, "village", free, { x: cam.x, z: cam.z }, VILLAGE_FURNITURE)).toBeNull();
    });
  });

  it("a click seen between the backrest's slats, from far behind, that meets the floor in front of the bench is that seat", () => {
    PLAZA.forEach((s, i) => {
      for (const [d, camY] of [[5.5, 2.6], [9, 3.4]] as const) {
        const cam = behindCam(s, d, camY);
        // the gap between the top two backrest slats (0.765-0.80 m), on the backrest's back face
        const gap = toward(s, middleOf(s) + BACKREST_BACK, 0.78);
        const r = rayTo(cam, gap);
        const floor = at(r, -cam.y / r.d.y);
        const fc = seatThroughFloor({ ...floor, y: 0 }, r, VILLAGE_SEATS, "village", free, { x: cam.x, z: cam.z }, VILLAGE_FURNITURE);
        expect(fc?.seatIndex, `seat ${i} from ${d} m behind`).toBe(i);
        expect(offeredInVillage(fc!.surface.x, fc!.surface.z)).toBe(s.id);
      }
    });
  });

  it("the floor seen beside a plaza bench, or over the board of the hall's backless bench (round 9), stays floor", () => {
    PLAZA.forEach((s) => {
      const mate = PLAZA.find((o) => o.bench === s.bench && o !== s)!;
      // 1.2 m beyond the bench's end, from behind and to the side
      const beside = { x: s.x + (s.x - mate.x) * 2.1, y: 0, z: s.z + (s.z - mate.z) * 2.1 };
      const cam = behindCam(s, 5, 2.6);
      const r = rayTo(cam, beside);
      expect(seatThroughFloor({ ...beside, distance: Math.hypot(beside.x - cam.x, beside.y - cam.y, beside.z - cam.z) }, r, VILLAGE_SEATS, "village", free, { x: cam.x, z: cam.z }, VILLAGE_FURNITURE)).toBeNull();
    });
    // the hall's backless benches have no backrest band: the floor past the board is floor (the round 9 leg case)
    const cam = { x: 302.0, y: 1.3, z: -4.6 };
    const leg = { x: 302.2, y: 0.15, z: -2.91 };
    const r = rayTo(cam, leg);
    const t = -cam.y / r.d.y;
    const floor = at(r, t);
    expect(seatThroughFloor({ ...floor, y: 0 }, r, VILLAGE_SEATS, "hall", free, { x: cam.x, z: cam.z }, [])).toBeNull();
  });

  it("someone already on the seat: a click on its backrest is no sit on it", () => {
    const s = PLAZA[6]!;
    const cam = behindCam(s, 5.5, 2.6);
    const target = toward(s, middleOf(s) + BACKREST_BACK, 0.72);
    const r = rayTo(cam, target);
    const fc = furnitureClick(at(r, Math.hypot(target.x - cam.x, target.y - cam.y, target.z - cam.z)), r, VILLAGE_SEATS, "village", (k) => k === 6, { x: cam.x, z: cam.z }, 0, false);
    expect(fc?.seatIndex ?? null).not.toBe(6);
  });
});
