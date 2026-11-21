import { describe, expect, it } from "vitest";
import { CAFE_LOT, LOT_ROOMS, lotDoorPoint, lotRoomDoor, lotRoomOf } from "@caysonverse/shared/village/villageLots";
import { lotDoorTapTarget } from "./lotDoorTap";
import { LOT_ENTER_TARGET_PREFIX, LOT_EXIT_TARGET_PREFIX, lotDoorTarget, lotExitTarget, lotWalkInTarget } from "./lots/lotTargets";
import { isBlocked } from "@caysonverse/shared/collision";
import { villageGeometry } from "@caysonverse/shared/village/villageLayout";
import { PLAYER_RADIUS } from "@caysonverse/shared/worldMap";

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

  it("walking into the café's door never goes in (owner 2026-11-21: the button, E or a tap on the door only); the button is offered there", () => {
    // the closed door's wall stops a body 0.4 m short of it: that spot is the doorstep
    const step = { x: door.centre.x + Math.sin(door.yaw) * (PLAYER_RADIUS + 0.05), z: door.centre.z + Math.cos(door.yaw) * (PLAYER_RADIUS + 0.05) };
    expect(isBlocked(step.x, step.z, PLAYER_RADIUS, villageGeometry.obstacles, 0)).toBe(false);
    expect(lotWalkInTarget(step.x, step.z)).toBeNull();
    expect(lotWalkInTarget(door.pad.x, door.pad.z)).toBeNull(); // the pad (0.65 m out): the button
    expect(lotWalkInTarget(door.arrival.x, door.arrival.z)).toBeNull();
    expect(lotWalkInTarget(step.x, step.z + 2.5)).toBeNull(); // along the façade, beside the door
    expect(lotWalkInTarget(step.x - 3, step.z)).toBeNull();
    expect(lotWalkInTarget(Number.NaN, 0)).toBeNull();
    // the button is offered at the doorstep too: the use is valid there
    expect(lotDoorTarget(step.x, step.z)?.id).toBe(`${LOT_ENTER_TARGET_PREFIX}lot_cafe_main`);
  });
});
