import { describe, expect, it } from "vitest";
import { COUNSEL_GEOMETRY, COUNSEL_SPAWN, COUNSEL_SPAWN_JITTER } from "@caysonverse/shared/school/counselMap";
import { CAMERA, HEAD_HEIGHT } from "../game/constants";
import { aspectDistanceScale } from "../game/aspectFraming";
import { springArmDistance } from "../game/cameraCollision";
import { ROOM_START_ORBIT } from "./roomCamera";

/** The share of the wanted arm the spring arm leaves (1 = the camera stands where the orbit wants it), from a point. */
function armShare(x: number, z: number, aspect: number, boxes = COUNSEL_GEOMETRY.cameraBoxes): number {
  const yaw = ROOM_START_ORBIT.yaw ?? CAMERA.yaw;
  const pitch = ROOM_START_ORBIT.pitch ?? CAMERA.pitch;
  const distance = (ROOM_START_ORBIT.distance ?? CAMERA.distance) * aspectDistanceScale(aspect);
  const tx = x + distance * Math.cos(pitch) * Math.sin(yaw);
  const ty = HEAD_HEIGHT + distance * Math.sin(pitch);
  const tz = z + distance * Math.cos(pitch) * Math.cos(yaw);
  const reach = Math.hypot(tx - x, ty - HEAD_HEIGHT, tz - z);
  return springArmDistance(x, HEAD_HEIGHT, z, tx, ty, tz, reach, boxes) / reach;
}

/** Points over the spawn disk (centre, then rings out to the jitter radius). */
function spawnPoints(cx: number, cz: number): Array<[number, number]> {
  const pts: Array<[number, number]> = [[cx, cz]];
  for (const r of [0.5, 1.0]) {
    for (let k = 0; k < 12; k++) {
      const a = (k / 12) * Math.PI * 2;
      pts.push([cx + r * COUNSEL_SPAWN_JITTER * Math.cos(a), cz + r * COUNSEL_SPAWN_JITTER * Math.sin(a)]);
    }
  }
  return pts;
}

describe("the classroom's first camera", () => {
  it("starts a little higher than the world's camera, at the world's yaw and distance", () => {
    expect(ROOM_START_ORBIT.pitch).toBeGreaterThan(CAMERA.pitch);
    expect(ROOM_START_ORBIT.yaw).toBeUndefined();
    expect(ROOM_START_ORBIT.distance).toBeUndefined();
  });

  it("from anywhere on the spawn disk (desktop) the camera keeps its whole arm (95 %+): the first picture is the room", () => {
    for (const [x, z] of spawnPoints(COUNSEL_SPAWN.x, COUNSEL_SPAWN.z)) {
      expect(armShare(x, z, 1.6), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("on a phone held upright (the portrait pull-back, 9.6 m) it keeps its arm too: no more 1.6 m squeeze", () => {
    for (const [x, z] of spawnPoints(COUNSEL_SPAWN.x, COUNSEL_SPAWN.z)) {
      expect(armShare(x, z, 375 / 812), `(${x.toFixed(2)}, ${z.toFixed(2)})`).toBeGreaterThanOrEqual(0.95);
    }
  });

  it("(the reason for the move) the old spawn, 2.2 m from the south wall, left the desktop camera under a third of its arm", () => {
    expect(armShare(0, 2.8, 1.6)).toBeLessThan(0.3);
  });
});
