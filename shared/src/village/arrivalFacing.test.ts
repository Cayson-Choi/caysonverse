import { describe, expect, it } from "vitest";
import { VILLAGE_LAYOUT } from "./villageLayout";
import { LOT_ROOMS, lotDoorPoint, lotRoomDoor, useLotDoor } from "./villageLots";
import { PARK_ARRIVAL, PARK_EXIT_PAD, parkGateDoor, useParkDoor } from "./parkArea";
import { ENTRY_SPAWN, EXIT_PAD } from "./houseAreas";

/**
 * Whoever comes through a door arrives looking AWAY from it, into the place they came to (owner 2026-11-21, entering 케이슨랜드: "이쪽
 * 방향을 보고 있는데 반대방향을 보도록" - the park's arrival faced back at the gate). One rule for every door of the game: the facing
 * (yaw = atan2(dx, dz)) points from the door one came through toward where one stands, within 60 degrees.
 */
function looksAwayFrom(door: { x: number; z: number }, at: { x: number; z: number; yaw: number }): number {
  const dx = at.x - door.x;
  const dz = at.z - door.z;
  const d = Math.hypot(dx, dz);
  return (Math.sin(at.yaw) * dx + Math.cos(at.yaw) * dz) / d; // 1 = straight away from the door, -1 = straight back at it
}

describe("arriving through a door, one looks away from it", () => {
  it("케이슨랜드: in through the gate (looking into the park, not back at the arch), and out again (looking at the village)", () => {
    const gate = parkGateDoor();
    const inn = useParkDoor("village", gate.pad.x, gate.pad.z)!;
    expect(inn).toMatchObject({ area: "park", x: PARK_ARRIVAL.x, z: PARK_ARRIVAL.z });
    expect(looksAwayFrom(PARK_EXIT_PAD, inn)).toBeGreaterThan(0.95);
    // the park lies south (+z) of its gate: yaw 0
    expect(Math.cos(inn.yaw)).toBeGreaterThan(0.95);
    const out = useParkDoor("park", PARK_EXIT_PAD.x, PARK_EXIT_PAD.z)!;
    expect(out.area).toBe("village");
    expect(looksAwayFrom(gate.centre, out)).toBeGreaterThan(0.95);
  });

  it("every lot room (the school, the chapel, the library, the temple, the church, the café): in and out", () => {
    expect(LOT_ROOMS.length).toBeGreaterThanOrEqual(6);
    let entered = 0;
    for (const r of LOT_ROOMS) {
      const p = lotDoorPoint(r.lot, r.door);
      const inn = useLotDoor("village", p.pad.x, p.pad.z)!;
      // a room reached from another room (the café's upstairs, by its stair) has no door of its own on the street: its lot's door leads to the room below
      if (inn.area !== r.area) continue;
      entered++;
      const room = lotRoomDoor(r);
      expect(looksAwayFrom(room.exitPad, inn), `${r.area} in`).toBeGreaterThan(0.5);
      const out = useLotDoor(r.area, room.exitPad.x, room.exitPad.z)!;
      expect(out.area, r.area).toBe("village");
      expect(looksAwayFrom(p.centre, out), `${r.area} out`).toBeGreaterThan(0.5);
    }
    expect(entered).toBeGreaterThanOrEqual(6);
  });

  it("the memorial hall and the houses", () => {
    const m = VILLAGE_LAYOUT.memorial;
    expect(looksAwayFrom(m.interior.doorPad.centre, m.interior.spawn)).toBeGreaterThan(0.5);
    expect(looksAwayFrom(m.exterior.doorPad.centre, m.exterior.arrival)).toBeGreaterThan(0.5);
    // a house's floor 1 (its own frame): the arrival inside the front door looks away from the way out
    expect(looksAwayFrom(EXIT_PAD, ENTRY_SPAWN)).toBeGreaterThan(0.5);
  });
});
