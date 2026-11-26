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

/** Showing the catch (landed): the camera swings round to the angler's front, a little to the side, so the fish held up is seen. */
export const CATCH_VIEW = { side: 0.55, pitch: 0.22, distance: 3.4 } as const;
/** The swings round the angler (to the side for the lift, to the front for the catch, back over the shoulder) glide at this yaw
 *  rate, not the default 10/s that whipped half a turn round in a third of a second (owner 2026-11-23). */
export const FISH_SWING_RATE = 1.4;

export function catchCamera(bodyYaw: number): void {
  if (viewState.mode !== "tp" || !saved) return;
  viewState.orbitGoal = { yaw: normalizeAngle(bodyYaw + CATCH_VIEW.side), pitch: CATCH_VIEW.pitch, distance: CATCH_VIEW.distance, yawRate: FISH_SWING_RATE };
}

/** Back over the shoulder after the catch (the view the player had before sitting stays saved). */
export function backToFishing(bodyYaw: number): void {
  if (viewState.mode !== "tp" || !saved) return;
  viewState.orbitGoal = { yaw: fishingYaw(bodyYaw), pitch: FISHING_VIEW.pitch, distance: FISHING_VIEW.distance, yawRate: FISH_SWING_RATE };
}

/**
 * Lake v2: the fish coming in (lifting, the fight): the camera glides round to the angler's side, a little behind and further
 * out, so the bent rod, the line and the fish breaking out of the water 3 m out in front are seen side on (from straight behind
 * the head hid them). The player's own drag cancels it as always.
 */
// hotfix 2026-11-17 (owner: "고기가 딸려 올라오는 장면이 없고"): from -2.3 / 0.1 / 7 the rod tip and the fish hanging from it were
// over the top of the view (the live frames): further round to the side, further out and level, so the tip stays in sight.
export const LIFT_VIEW = { side: -0.95, pitch: 0.06, distance: 7 } as const;

export function liftCamera(bodyYaw: number): void {
  if (viewState.mode !== "tp" || !saved) return;
  viewState.orbitGoal = { yaw: normalizeAngle(bodyYaw + LIFT_VIEW.side), pitch: LIFT_VIEW.pitch, distance: LIFT_VIEW.distance, yawRate: FISH_SWING_RATE };
}
