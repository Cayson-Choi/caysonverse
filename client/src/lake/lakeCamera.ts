// The fishing camera (design 4.4): sitting at a fishing chair glides the camera over the angler's shoulder, lower and closer, so the
// float lies in the upper third of the screen; getting up glides it back to where the player had it. It is the player-asked kind
// of move the rig already supports (`viewState.orbitGoal`: a drag, the wheel, a pinch, Z / C or entering first person cancels
// it, and a double tap swings the camera behind the body as always). Only in third person: first person already looks where the
// body does.

import { viewState } from "../game/viewState";
import { normalizeAngle } from "../game/yaw";
import type { Orbit } from "../game/types";

/** Over the shoulder: behind the body, a little to one side (rad), low, close (m). */
export const FISHING_VIEW = { shoulder: 0.32, pitch: 0.26, distance: 4.6 } as const;

let saved: Orbit | null = null;

export function fishingYaw(bodyYaw: number): number {
  return normalizeAngle(bodyYaw + Math.PI + FISHING_VIEW.shoulder);
}

export function fishingCamera(bodyYaw: number, orbit: Orbit): void {
  if (viewState.mode !== "tp") return;
  saved = { yaw: orbit.yaw, pitch: orbit.pitch, distance: orbit.distance };
  viewState.orbitGoal = { yaw: fishingYaw(bodyYaw), pitch: FISHING_VIEW.pitch, distance: FISHING_VIEW.distance };
}

export function restoreCamera(): void {
  if (!saved) return;
  if (viewState.mode === "tp") viewState.orbitGoal = { yaw: saved.yaw, pitch: saved.pitch, distance: saved.distance };
  saved = null;
}
