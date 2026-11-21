import { describe, expect, it } from "vitest";
import { CAFE_LOT, LOT_ROOMS, lotDoorPoint, lotRoomDoor, lotRoomOf } from "@caysonverse/shared/village/villageLots";
import { lotDoorTapTarget } from "./lotDoorTap";
import { LOT_ENTER_TARGET_PREFIX, LOT_EXIT_TARGET_PREFIX, lotDoorTarget, lotExitTarget } from "./lots/lotTargets";

describe("a tap on a lot building's door (the café's, owner 2026-11-20)", () => {
  const door = lotDoorPoint(CAFE_LOT, CAFE_LOT.doors[0]!);

  it("a tap on the café's door walks to its pad and uses it (the village's 카페 들어가기)", () => {
    const hit = lotDoorTapTarget("village", door.centre.x - 0.1, 1.3, door.centre.z);
    expect(hit).toEqual({ id: `${LOT_ENTER_TARGET_PREFIX}lot_cafe_main`, x: door.pad.x, z: door.pad.z });
    // the pad's own button is offered there: the armed use fires once the walk arrives
    const offered = lotDoorTarget(door.pad.x, door.pad.z);
    expect(offered?.id).toBe(hit!.id);
    expect(offered?.label).toBe("카페 들어가기");
  });

  it("only the door's own opening counts: the shop windows beside it, the sky over it and the lane are no door", () => {
    expect(lotDoorTapTarget("village", door.centre.x, 1.3, door.centre.z + 2.6)).toBeNull(); // the shop window
    expect(lotDoorTapTarget("village", door.centre.x, 5.0, door.centre.z)).toBeNull(); // the sign over it
    expect(lotDoorTapTarget("village", door.centre.x - 3.0, 0, door.centre.z)).toBeNull(); // the terrace
    expect(lotDoorTapTarget("village", Number.NaN, 1, 0)).toBeNull();
  });

  it("every other lot door answers a tap on it too, and none answers a tap elsewhere in the village", () => {
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      const hit = lotDoorTapTarget("village", p.centre.x, 1.2, p.centre.z);
      expect(hit?.id, r.door.id).toBe(`${LOT_ENTER_TARGET_PREFIX}${r.door.id}`);
      expect(lotDoorTarget(hit!.x, hit!.z)?.id, r.door.id).toBe(hit!.id);
    }
    expect(lotDoorTapTarget("village", 0, 1, 0)).toBeNull();
  });

  it("inside the café a tap on the door in the front wall walks to the exit pad (밖으로 나가기)", () => {
    const room = lotRoomOf("lot:lot_cafe_room")!;
    const exit = lotRoomDoor(room).exitPad;
    const hit = lotDoorTapTarget(room.area, exit.x, 1.3, room.origin.z - 0.12);
    expect(hit).toEqual({ id: `${LOT_EXIT_TARGET_PREFIX}lot_cafe_room`, x: exit.x, z: exit.z });
    expect(lotExitTarget(room.area, exit.x, exit.z)?.id).toBe(hit!.id);
    // the room's far wall, its windows and the floor are no door
    expect(lotDoorTapTarget(room.area, exit.x, 1.3, room.origin.z + 6)).toBeNull();
    expect(lotDoorTapTarget(room.area, room.origin.x + 1, 1.3, room.origin.z - 0.12)).toBeNull();
    expect(lotDoorTapTarget(room.area, exit.x, 4.2, room.origin.z - 0.12)).toBeNull();
  });

  it("a tap on the ground or floor by a door is a walk, never a use of it (owner 2026-11-21)", () => {
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      for (const o of [-0.5, 0, 0.2, 0.6]) {
        expect(lotDoorTapTarget("village", p.centre.x + Math.sin(p.yaw) * o, 0, p.centre.z + Math.cos(p.yaw) * o), r.door.id).toBeNull();
      }
    }
    const room = lotRoomOf("lot:lot_cafe_room")!;
    const exit = lotRoomDoor(room).exitPad;
    for (const dz of [-0.3, 0, 0.4, 0.8]) expect(lotDoorTapTarget(room.area, exit.x, 0, room.origin.z + dz)).toBeNull();
  });

  it("a tap that goes through an open / unpickable leaf onto the wall inside is the door; onto the floor beyond or past the opening it is not", () => {
    const ray = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => {
      const l = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      return { ray: { o: from, d: { x: (to.x - from.x) / l, y: (to.y - from.y) / l, z: (to.z - from.z) / l } }, distance: l };
    };
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      const at = (o: number, a: number, y: number) => ({
        x: p.centre.x + Math.sin(p.yaw) * o + Math.cos(p.yaw) * a,
        y,
        z: p.centre.z + Math.cos(p.yaw) * o - Math.sin(p.yaw) * a,
      });
      const eye = at(5, 0, 1.7);
      const wall = at(-2.5, 0, 1.0);
      const w = ray(eye, wall);
      expect(lotDoorTapTarget("village", wall.x, wall.y, wall.z, w.ray, w.distance)?.id, r.door.id).toBe(`${LOT_ENTER_TARGET_PREFIX}${r.door.id}`);
      const floor = at(-2.5, 0, 0);
      const f = ray(eye, floor);
      expect(lotDoorTapTarget("village", floor.x, floor.y, floor.z, f.ray, f.distance), `${r.door.id} floor beyond`).toBeNull();
      const side = at(-2.5, r.door.width / 2 + 2.5, 1.0);
      const sd = ray(eye, side);
      expect(lotDoorTapTarget("village", side.x, side.y, side.z, sd.ray, sd.distance), `${r.door.id} wall beside`).toBeNull();
    }
  });

  it("a flat thing by the door (a step, a threshold, a planter's top) is not the door; an upright face and a bar's top edge high up are", () => {
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      const at = { x: p.centre.x + Math.sin(p.yaw) * 0.1, z: p.centre.z + Math.cos(p.yaw) * 0.1 };
      expect(lotDoorTapTarget("village", at.x, 0.45, at.z, null, 0, 1), r.door.id).toBeNull();
      expect(lotDoorTapTarget("village", at.x, 0.9, at.z, null, 0, 0.9), r.door.id).toBeNull();
      expect(lotDoorTapTarget("village", at.x, 0.45, at.z, null, 0, 0)?.id, r.door.id).toBe(`${LOT_ENTER_TARGET_PREFIX}${r.door.id}`);
      expect(lotDoorTapTarget("village", at.x, 1.5, at.z, null, 0, 1)?.id, r.door.id).toBe(`${LOT_ENTER_TARGET_PREFIX}${r.door.id}`);
    }
  });

  it("a tap through a glass leaf that picks nothing at all is the door by its ray alone; from behind the door, or past its jamb, it is not", () => {
    const ray = (from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => {
      const l = Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z);
      return { o: from, d: { x: (to.x - from.x) / l, y: (to.y - from.y) / l, z: (to.z - from.z) / l } };
    };
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      const at = (o: number, a: number, y: number) => ({ x: p.centre.x + Math.sin(p.yaw) * o + Math.cos(p.yaw) * a, y, z: p.centre.z + Math.cos(p.yaw) * o - Math.sin(p.yaw) * a });
      const id = `${LOT_ENTER_TARGET_PREFIX}${r.door.id}`;
      expect(lotDoorTapTarget("village", NaN, NaN, NaN, ray(at(6, 0, 2.6), at(0, 0, 1.2)), 0)?.id, r.door.id).toBe(id);
      expect(lotDoorTapTarget("village", NaN, NaN, NaN, null, 0), r.door.id).toBeNull(); // the sky, no ray
      expect(lotDoorTapTarget("village", NaN, NaN, NaN, ray(at(6, 0, 2.6), at(0, r.door.width / 2 + 1.5, 1.2)), 0), `${r.door.id} beside`).toBeNull();
      expect(lotDoorTapTarget("village", NaN, NaN, NaN, ray(at(6, 0, 2.6), at(0, 0, 0.1)), 0), `${r.door.id} foot`).toBeNull();
      expect(lotDoorTapTarget("village", NaN, NaN, NaN, ray(at(-6, 0, 2.6), at(0, 0, 1.2)), 0), `${r.door.id} from behind`).toBeNull();
      // inside its room: the way out is the z = origin wall, the room on its +z side
      const room = lotRoomOf(r.area)!;
      const exit = lotRoomDoor(room).exitPad;
      const out = `${LOT_EXIT_TARGET_PREFIX}${room.unit.id}`;
      // (a room with no way out of its own, the café's upstairs: nothing there is a door)
      expect(lotDoorTapTarget(room.area, NaN, NaN, NaN, ray({ x: exit.x, y: 3, z: room.origin.z + 5 }, { x: exit.x, y: 1.2, z: room.origin.z }), 0)?.id, room.area).toBe(room.spec.noExit ? undefined : out);
      expect(lotDoorTapTarget(room.area, NaN, NaN, NaN, ray({ x: exit.x, y: 3, z: room.origin.z + 5 }, { x: exit.x, y: 0.05, z: room.origin.z }), 0), `${room.area} foot`).toBeNull();
      expect(lotDoorTapTarget(room.area, NaN, NaN, NaN, ray({ x: exit.x, y: 3, z: room.origin.z + 5 }, { x: exit.x + room.spec.doorWidth / 2 + 1.2, y: 1.2, z: room.origin.z }), 0), `${room.area} beside`).toBeNull();
    }
  });
});
