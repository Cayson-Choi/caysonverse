import { describe, expect, it } from "vitest";
import { Vector3 } from "three";
import { LOT_ROOMS, lotDoorPoint, lotFootprint } from "@caysonverse/shared/village/villageLots";
import { HOUSE_NUMBERS } from "@caysonverse/shared/village/houseAreas";
import { houseLocalToWorld, HOUSE_BODY_FRONT } from "@caysonverse/shared/village/houseExterior";
import { LOT_ROOM_PLACE, PORTAL_LOT_UNITS, a8House, housePortalRoom, lotPortalRoom, memorialPortalRoom, toRoom, toVillage } from "./portalRooms";
import { frameToVillage } from "./RoomShowcase";

const room = (u: string) => LOT_ROOMS.find((r) => r.unit.id === u)!;

describe("portal rooms: the real rooms placed in their buildings (clear glass, 2026-11-21)", () => {
  it("a lot's room has its door on the building's door, its floor on the measured sill, and stays inside the footprint", () => {
    for (const u of PORTAL_LOT_UNITS) {
      const r = room(u);
      const pr = lotPortalRoom(r);
      const place = LOT_ROOM_PLACE[u]!;
      // the room's door (the middle of its door wall) → the village: on the door's line, `wallIn` behind the body's front
      const door = toVillage(pr.frame, r.origin.x + r.spec.doorX, 0, r.origin.z);
      const pad = lotDoorPoint(r.lot, r.door).pad;
      expect(door[1], u).toBeCloseTo(place.lift, 6);
      const f = lotFootprint(r.lot);
      for (const [X, Z] of [[pr.min[0], pr.min[2]], [pr.max[0], pr.max[2]], [pr.min[0], pr.max[2]], [pr.max[0], pr.min[2]]] as const) {
        const v = toVillage(pr.frame, X, 0, Z);
        expect(v[0] >= f.minX - 1e-6 && v[0] <= f.maxX + 1e-6 && v[2] >= f.minZ - 1e-6 && v[2] <= f.maxZ + 1e-6, `${u} corner inside`).toBe(true);
      }
      // the door is between the pad and the building (the pad stands outside, in front of it)
      expect(Math.hypot(door[0] - pad.x, door[2] - pad.z), u).toBeLessThan(4);
    }
  });

  it("the frame's two ways agree, and the matrix the showcase uses is the same map (the depth squeeze too)", () => {
    for (const pr of [...PORTAL_LOT_UNITS.map((u) => lotPortalRoom(room(u))), memorialPortalRoom(), housePortalRoom(3, 2)]) {
      const m = frameToVillage(pr.frame);
      for (const p of [pr.min, pr.max, pr.eye]) {
        const v = toVillage(pr.frame, p[0], p[1], p[2]);
        const back = toRoom(pr.frame, v[0], v[1], v[2]);
        back.forEach((x, i) => expect(x, pr.id).toBeCloseTo(p[i]!, 6));
        const w = new Vector3(...p).applyMatrix4(m);
        expect(w.x, pr.id).toBeCloseTo(v[0], 6);
        expect(w.y, pr.id).toBeCloseTo(v[1], 6);
        expect(w.z, pr.id).toBeCloseTo(v[2], 6);
      }
    }
  });

  it("a room deeper than its building is squeezed to the building's inside (the chapel's nave, the temple's hall)", () => {
    expect(lotPortalRoom(room("lot_chapel_nave")).frame.k).toBeLessThan(0.8);
    expect(lotPortalRoom(room("lot_temple_hall")).frame.k).toBeLessThan(0.9);
    expect(lotPortalRoom(room("lot_church_nave")).frame.k ?? 1).toBe(1);
  });

  it("a house's floor: its front door (interior x 5.3 on the z 0 wall) lands on the house's front door, one storey up for floor 2", () => {
    for (const n of HOUSE_NUMBERS) {
      for (const floor of [1, 2] as const) {
        const pr = housePortalRoom(n, floor);
        const v = toVillage(pr.frame, pr.min[0] + 5.3, 0, pr.max[2]);
        const want = houseLocalToWorld(a8House(n), 0, HOUSE_BODY_FRONT - 0.3);
        expect(v[0], `house ${n}`).toBeCloseTo(want.x, 1);
        expect(v[2], `house ${n}`).toBeCloseTo(want.z, 1);
        expect(v[1]).toBeCloseTo(floor === 1 ? 0.3 : 4.3, 6);
      }
    }
  });

  it("the memorial hall stands behind the porch's back wall, inside the building", () => {
    const pr = memorialPortalRoom();
    const front = toVillage(pr.frame, 300, 0, pr.max[2]);
    expect(front[2]).toBeLessThan(-53.68);
    expect(toVillage(pr.frame, 300, 0, pr.min[2])[2]).toBeGreaterThan(-68);
  });
});
