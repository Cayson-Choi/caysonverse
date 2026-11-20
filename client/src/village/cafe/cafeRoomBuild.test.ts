import { describe, expect, it } from "vitest";
import { Box3, Vector3 } from "three";
import { CAFE_ALL_TABLES, CAFE_IN, CAFE_STOOLS, cafeTableChairs } from "@caysonverse/shared/village/cafeRoom";
import { LOT_ROOMS, lotRoomOf } from "@caysonverse/shared/village/villageLots";
import { buildCafe, localToRoom } from "./cafeBuild";
import { buildCafeShell } from "./cafeShell";

const room = lotRoomOf("lot:lot_cafe_room")!;
const matrix = localToRoom(room.origin);

describe("the café room's geometry (walk-in room, owner 2026-11-20)", () => {
  const parts = buildCafe({ room: { matrix } });
  const shell = buildCafeShell(matrix);

  it("one instance per chair, table and stool the spec seats, tables and stools use", () => {
    expect(parts.chairMatrices).toHaveLength(CAFE_ALL_TABLES.flatMap((t) => cafeTableChairs(t)).length);
    expect(parts.tableMatrices).toHaveLength(CAFE_ALL_TABLES.length);
    expect(parts.stoolMatrices).toHaveLength(CAFE_STOOLS.length);
    expect(CAFE_IN.seats.filter((s) => s.id.startsWith("lot_cafe_chair_"))).toHaveLength(parts.chairMatrices.length);
  });

  it("every chair stands where its seat is (the room's frame, the half turn)", () => {
    const seats = CAFE_IN.seats.filter((s) => s.id.startsWith("lot_cafe_chair_"));
    const p = new Vector3();
    parts.chairMatrices.forEach((m, i) => {
      p.setFromMatrixPosition(m);
      const s = seats[i]!;
      expect(p.x, s.id).toBeCloseTo(room.origin.x + s.x, 3);
      expect(p.z, s.id).toBeCloseTo(room.origin.z + s.z, 3);
    });
  });

  it("everything of the room is inside its walls (the glass and the reveals reach 0.35 m out of them) and under the ceiling", () => {
    const b = room.bounds;
    const slack = 0.35;
    const box = new Box3();
    for (const [name, g] of Object.entries({ fixed: parts.fixed, art: parts.art, floor: shell.floor, plaster: shell.plaster, oak: shell.oak, trim: shell.trim, glass: shell.glass })) {
      g.computeBoundingBox();
      box.copy(g.boundingBox!);
      expect(box.min.x, `${name} min x`).toBeGreaterThanOrEqual(b.minX - slack);
      expect(box.max.x, `${name} max x`).toBeLessThanOrEqual(b.maxX + slack);
      expect(box.min.z, `${name} min z`).toBeGreaterThanOrEqual(b.minZ - slack);
      expect(box.max.z, `${name} max z`).toBeLessThanOrEqual(b.maxZ + slack);
      expect(box.min.y, `${name} min y`).toBeGreaterThanOrEqual(-0.01);
      expect(box.max.y, `${name} max y`).toBeLessThanOrEqual(room.ceiling + 0.01);
    }
  });

  it("the budget: draws and triangles of the room (PC and phone read the same file) stay near the other rooms'", () => {
    const tris = parts.triangles + shell.triangles;
    expect(tris).toBeLessThan(CAFE_IN.budget.pc.triangles);
    // 5 shell meshes + fixed, art, chairs, tables, stools, shadows, pools
    expect(5 + 7).toBeLessThanOrEqual(CAFE_IN.budget.pc.draws);
    expect(LOT_ROOMS[LOT_ROOMS.length - 1]!.spec).toBe(CAFE_IN);
  });

  it("the shell keeps the door and the windows open: nothing solid in the doorway", () => {
    const door = new Box3(new Vector3(room.origin.x + 5.7, 0.05, room.origin.z - 0.2), new Vector3(room.origin.x + 7.9, 2.9, room.origin.z + 0.05));
    // plaster and floor have no triangle through the door's opening (the frame, leaves and glass are trim and glass)
    const pos = shell.plaster.getAttribute("position");
    let through = 0;
    const v = new Vector3();
    for (let i = 0; i < pos.count; i += 3) {
      const c = new Vector3();
      for (let k = 0; k < 3; k++) c.add(v.fromBufferAttribute(pos, i + k));
      c.multiplyScalar(1 / 3);
      if (door.containsPoint(c)) through++;
    }
    expect(through).toBe(0);
  });
});
