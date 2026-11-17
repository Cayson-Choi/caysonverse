import { describe, expect, it } from "vitest";
import {
  LOT_INTERIORS,
  LOT_INTERIOR_FRONT_CLEAR,
  LOT_INTERIOR_SEAT_ORDER,
  VILLAGE_LOTS,
  lotInteriorDoor,
  lotInteriorSeatBoxes,
  type LotRect,
} from "./villageLots";

const ov = (a: LotRect, b: LotRect, eps = 1e-6) => a.x0 < b.x1 - eps && a.x1 > b.x0 + eps && a.z0 < b.z1 - eps && a.z1 > b.z0 + eps;
const inRoom = (r: LotRect, size: { x: number; z: number }, eps = 1e-6) => r.x0 >= -eps && r.z0 >= -eps && r.x1 <= size.x + eps && r.z1 <= size.z + eps;
const unitOf = (id: string) => VILLAGE_LOTS.flatMap((l) => l.units).find((u) => u.id === id)!;

describe("v2 walk-in interiors (owner 2026-11-17: every building enterable, sit on every seat inside)", () => {
  it("one interior per lot building, phase 1, each on its unit's room", () => {
    expect(LOT_INTERIORS.map((i) => i.lot)).toEqual(["lot_school", "lot_library", "lot_chapel", "lot_church", "lot_temple"]);
    for (const i of LOT_INTERIORS) {
      const u = unitOf(i.unit);
      expect(u.interior.phase, i.unit).toBe(1);
      expect(u.interior.area).toBe(`lot:${i.unit}`);
      const lot = VILLAGE_LOTS.find((l) => l.id === i.lot)!;
      for (const d of lot.doors) expect(d.phase, d.id).toBe(1);
      expect(i.doorX - i.doorWidth / 2).toBeGreaterThan(0);
      expect(i.doorX + i.doorWidth / 2).toBeLessThan(u.interior.size.x);
    }
  });

  it("interior seat ids are unique and in their fixed, append-only order", () => {
    expect(new Set(LOT_INTERIOR_SEAT_ORDER).size).toBe(LOT_INTERIOR_SEAT_ORDER.length);
    expect(LOT_INTERIOR_SEAT_ORDER.length).toBe(52);
    expect(LOT_INTERIOR_SEAT_ORDER.slice(0, 3)).toEqual(["lot_school_chair_1", "lot_school_chair_2", "lot_school_chair_3"]);
    expect(LOT_INTERIOR_SEAT_ORDER.slice(-2)).toEqual(["lot_temple_cushion_11", "lot_temple_cushion_12"]);
    const groups = LOT_INTERIORS.map((i) => [i.unit, i.seats.length]);
    expect(groups).toEqual([["lot_school_class", 12], ["lot_library_reading", 10], ["lot_chapel_nave", 10], ["lot_church_nave", 8], ["lot_temple_hall", 12]]);
  });

  it("every seat and solid is inside its room; seats never overlap a solid or each other", () => {
    for (const i of LOT_INTERIORS) {
      const size = unitOf(i.unit).interior.size;
      for (const s of i.solids) expect(inRoom(s.rect, size), `${i.unit} ${s.name}`).toBe(true);
      const boxes = i.seats.map((s) => ({ id: s.id, ...lotInteriorSeatBoxes(s) }));
      for (const b of boxes) {
        expect(inRoom(b.seat, size), b.id).toBe(true);
        for (const o of boxes) if (o !== b) expect(ov(b.seat, o.seat), `${b.id} / ${o.id}`).toBe(false);
      }
    }
  });

  it(`sit and stand from the front: ${LOT_INTERIOR_FRONT_CLEAR} m clear in front of every chair, pew and nook (floor cushions excepted)`, () => {
    for (const i of LOT_INTERIORS) {
      const size = unitOf(i.unit).interior.size;
      const others = i.seats.map((s) => ({ id: s.id, box: lotInteriorSeatBoxes(s).seat }));
      for (const s of i.seats) {
        if (s.kind === "floor") continue; // 방석 on the floor: stepped over, no frame
        const front = lotInteriorSeatBoxes(s).front;
        expect(inRoom(front, size), `${s.id} front in the room`).toBe(true);
        // a pew's own frame (its backrest box) is in the solids under the same row; the front strip must miss every OTHER solid
        for (const so of i.solids) {
          const own = so.name.startsWith("pew_") && ov(so.rect, lotInteriorSeatBoxes(s).seat);
          if (!own) expect(ov(front, so.rect), `${s.id} front / ${so.name}`).toBe(false);
        }
        for (const o of others) if (o.id !== s.id) expect(ov(front, o.box), `${s.id} front / ${o.id}`).toBe(false);
      }
    }
  });

  it("the door: exit pad and arrival are clear of every solid and seat", () => {
    for (const i of LOT_INTERIORS) {
      const d = lotInteriorDoor(i);
      for (const p of [d.exitPad, d.arrival]) {
        const r = { x0: p.x - 0.4, x1: p.x + 0.4, z0: p.z - 0.4, z1: p.z + 0.4 };
        for (const so of i.solids) expect(ov(r, so.rect), `${i.unit} door / ${so.name}`).toBe(false);
        for (const s of i.seats) expect(ov(r, lotInteriorSeatBoxes(s).seat), `${i.unit} door / ${s.id}`).toBe(false);
      }
      expect(d.node).toBe(`door__${i.unit}_exit`);
    }
  });

  it("budgets: the phone tier is a real cut, the religious rooms get the most (photo-real statues and glass)", () => {
    for (const i of LOT_INTERIORS) {
      expect(i.budget.phone.triangles).toBeLessThanOrEqual(i.budget.pc.triangles * 0.45);
      expect(i.budget.phone.textureMB).toBeLessThanOrEqual(i.budget.pc.textureMB / 2);
      expect(i.budget.pc.triangles).toBeLessThanOrEqual(140_000);
      expect(i.program.length).toBeGreaterThanOrEqual(8);
    }
    const by = Object.fromEntries(LOT_INTERIORS.map((i) => [i.lot, i.budget.pc.triangles]));
    expect(by.lot_chapel).toBeGreaterThanOrEqual(by.lot_school);
    expect(by.lot_temple).toBeGreaterThanOrEqual(by.lot_library);
  });
});
