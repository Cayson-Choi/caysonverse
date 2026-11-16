import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { houseFloorGeometry } from "@caysonverse/shared/village/housesGeometry";
import type { HouseFloor, HouseNumber } from "@caysonverse/shared/village/houseAreas";
import { HEAD_HEIGHT } from "../game/constants";
import { segmentHitFraction } from "../game/cameraCollision";
import { normalizeAngle } from "../game/yaw";

/**
 * The camera a house arrival gets (집 실내 G round 2): coming through the front door the wall is 3.1 m behind the avatar, so the follow
 * camera (cut short by the wall, lifted over the head) filled the lower half of the screen with the back of the avatar. On every arrival
 * (the door, the stair, a reconnect) the orbit glides to the direction, among 24, that leaves the longest clear arm up to the zoom, within
 * 110° of straight behind the avatar (so the room is still in front), at a tilt that reads the room (0.55 rad). Pure: boxes and spot in.
 */
export const ARRIVAL_PITCH = 0.55;
export const ARRIVAL_MAX_TURN = (110 * Math.PI) / 180;
export const ARRIVAL_STEPS = 24;

export interface ArrivalCamera {
  yaw: number;
  pitch: number;
  /** The clear arm (m) in that direction, up to `wanted`. */
  clear: number;
}

export function arrivalCamera(
  n: HouseNumber,
  floor: HouseFloor,
  x: number,
  z: number,
  bodyYaw: number,
  wanted: number,
  pad = 0.3,
): ArrivalCamera {
  const boxes = houseFloorGeometry(n, floor).cameraBoxes;
  const behind = normalizeAngle(bodyYaw + Math.PI); // the camera's yaw straight behind the body
  const y = HEAD_HEIGHT + wanted * Math.sin(ARRIVAL_PITCH);
  const h = wanted * Math.cos(ARRIVAL_PITCH);
  let best: ArrivalCamera = { yaw: behind, pitch: ARRIVAL_PITCH, clear: -1 };
  for (let k = 0; k < ARRIVAL_STEPS; k++) {
    const yaw = normalizeAngle(behind + ((k - ARRIVAL_STEPS / 2) * 2 * Math.PI) / ARRIVAL_STEPS);
    if (Math.abs(normalizeAngle(yaw - behind)) > ARRIVAL_MAX_TURN) continue;
    const t = segmentHitFraction(x, HEAD_HEIGHT, z, x + Math.sin(yaw) * h, y, z + Math.cos(yaw) * h, boxes, WALL_HEIGHT, pad);
    const clear = t * wanted;
    // longer wins; within 0.15 m the one nearer straight behind
    if (clear > best.clear + 0.15 || (Math.abs(clear - best.clear) <= 0.15 && Math.abs(normalizeAngle(yaw - behind)) < Math.abs(normalizeAngle(best.yaw - behind)))) best = { yaw, pitch: ARRIVAL_PITCH, clear };
  }
  return best;
}
