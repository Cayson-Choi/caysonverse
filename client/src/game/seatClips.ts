/**
 * Which sit clips a seat plays. Seats are data (`Seat.pose`, sitPose.ts `SeatPoseKind`): a `floor` seat — a floor cushion, a
 * 보료, a floor sofa — sits the avatar cross-legged (`Sit_Floor_*`); every other seat keeps the chair pose (`Sit_Chair_*`).
 * Both avatars (LocalPlayer, RemotePlayer) resolve their sit clips through here, so a new seat kind is one line.
 */

import type { Seat } from "@caysonverse/shared/worldMap";
import { CLIP, FLOOR_CLIP } from "./constants";

/** Whether `seat` is sat on cross-legged on the floor. An unknown seat (not on this map) is a chair. */
export function isFloorSeat(seat: Seat | undefined): boolean {
  return seat?.pose === "floor";
}

/** The clip that plays the sit role `base` (a `CLIP.sitDown | sitIdle | sitStand`) on a floor seat (`floor`) or a chair. */
export function seatClipBase(base: string, floor: boolean): string {
  if (!floor) return base;
  switch (base) {
    case CLIP.sitDown:
      return FLOOR_CLIP.sitDown;
    case CLIP.sitIdle:
      return FLOOR_CLIP.sitIdle;
    case CLIP.sitStand:
      return FLOOR_CLIP.sitStand;
    default:
      return base;
  }
}
