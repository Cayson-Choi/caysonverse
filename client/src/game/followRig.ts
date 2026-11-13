/**
 * The third-person follow camera, one frame at a time (pure maths over the active map — no three.js, no React): where
 * the camera sits behind the player for the player's own orbit, after the place's ceiling, the walls and the floor
 * have had their say. CameraRig blends the result with first person and the overview and puts it on the camera.
 *
 * The orbit — the player's yaw, pitch and zoom — is only READ here, never written (owner 2026-11-10: "캐릭터를 비추는
 * 카메라의 위치가 자동으로 바뀌지 않게"). Every adjustment below shapes one frame's camera spot, so the moment its reason
 * is gone the camera is exactly where the player put it:
 *   - the zoom glide: after a wheel notch or a pinch the distance eases to the new value, then holds it exactly;
 *   - the portrait pull-back (aspectFraming.ts): a narrow screen draws the same zoom a little farther — it depends on
 *     the screen's shape only, never on where the player is or what they do;
 *   - the place's camera limit (indoorCamera.ts): under the memorial hall's ceiling the camera is held below the roof;
 *   - the spring arm (cameraCollision.ts): a wall between the head and the camera pulls it in at once, and lets it back
 *     out (SPRING.returnRate) as soon as the way is clear;
 *   - the floor stop (`aboveGroundY`): never under the ground.
 * Nothing here knows about seats, NPCs, dialogs, cards or experiences: sitting down, standing up, an interaction or a
 * door changes no input but the player's position and the map, so none of them can move the zoom or the angle.
 *
 * The follow point is the body itself — no trailing — so the camera-to-avatar distance is the zoom while walking,
 * running, stopping and turning alike, and a teleport (a door, a respawn, a reconnect) keeps it too.
 */

import { HEAD_HEIGHT } from "./constants";
import { aboveGroundY, smoothToward } from "./cameraControls";
import { aspectDistanceScale } from "./aspectFraming";
import {
  HALL_CAMERA_LIMIT,
  cameraLimitAt,
  indoorArmAt,
  indoorCameraClamp,
  limitedDistance,
  limitsDiffer,
  stepCapEngage,
  type CameraLimit,
  type Vec3,
} from "./indoorCamera";
import { ARM_FREE, armHeightScaleAt, armLookLiftAt, indoorArmShape, keepOutArmDistance, springArmDistance, stepArmLimit } from "./cameraCollision";
import { getActiveMap } from "./activeMap";
import type { Orbit } from "./types";

/** What the follow camera carries from one frame to the next. Mutated in place; never React state. */
export interface FollowRig {
  /** The follow distance the zoom glide has reached (m): eases to `orbit.distance`, then equals it. */
  renderDist: number;
  /** The spring arm's eased limit (m): snaps in at a wall, eases back out, ARM_FREE in the open. */
  armLimit: number;
  /** Camera-limit engagement, 0 (off) .. 1 (fully limited): eased in the open, at once for a building. */
  capEngage: number;
  /** The limit `capEngage` blends — kept after the player leaves a building, so the cap eases out with its own numbers. */
  limit: CameraLimit;
  /** The map's camera limit as of the last frame: a different one is a door into or out of a building. */
  lastAreaLimit: CameraLimit | undefined;
}

/** One frame's third-person camera spot. */
export interface FollowSpot {
  x: number;
  y: number;
  z: number;
  /** How far (m) the look target rises over the head this frame (only while an indoor wall shortens the arm). */
  lookLift: number;
  /** The follow distance after the zoom glide, the portrait pull-back and the place's limit (the dev probe's). */
  distance: number;
}

/** A follow rig for a scene that starts now with `orbit` on the active map (a scene inside a building starts engaged). */
export function createFollowRig(orbit: Readonly<Orbit>): FollowRig {
  const areaLimit = getActiveMap().cameraLimit;
  return {
    renderDist: orbit.distance,
    armLimit: ARM_FREE,
    capEngage: areaLimit ? 1 : 0,
    limit: areaLimit ?? HALL_CAMERA_LIMIT, // at engage 0 the limit is not applied: a placeholder until a building sets one
    lastAreaLimit: areaLimit,
  };
}

/** A fresh spot to write into (CameraRig makes one per mount; nothing is allocated per frame). */
export function createFollowSpot(): FollowSpot {
  return { x: 0, y: 0, z: 0, lookLift: 0, distance: 0 };
}

/**
 * Note the active map's camera limit for this frame. A different one than last frame is a door into or out of a
 * building (케이슨 마을): the player was just put somewhere else, so the rig's own easing starts fresh there — the zoom
 * glide is finished (it lands on the player's zoom), the spring arm is free again, and the building's limit is fully
 * engaged (or released) — the door's curtain covers the cut. The orbit is not touched: the yaw, the pitch and the
 * zoom the player chose come through the door unchanged. Returns true on such a crossing.
 */
export function noteAreaLimit(rig: FollowRig, orbit: Readonly<Orbit>, areaLimit: CameraLimit | undefined): boolean {
  if (!limitsDiffer(rig.lastAreaLimit, areaLimit)) return false;
  rig.lastAreaLimit = areaLimit;
  rig.renderDist = orbit.distance;
  rig.armLimit = ARM_FREE;
  rig.capEngage = areaLimit ? 1 : 0;
  if (areaLimit) rig.limit = areaLimit;
  return true;
}

/** Scratch points for the camera limit, made once and rewritten every frame — the clamp allocates nothing. */
const wantedSpot: Vec3 = { x: 0, y: 0, z: 0 };
const headSpot: Vec3 = { x: 0, y: 0, z: 0 };
const limitedSpot: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Advance the rig by `dt` and write the third-person camera spot for a player standing at (x, z) into `out`.
 *
 * `armActive` is false while the third-person pose is not drawn at all (full first person): the walls are then not
 * cast against, and the arm is reset so coming back out of first person starts with a free arm.
 */
export function stepFollowRig(
  rig: FollowRig,
  orbit: Readonly<Orbit>,
  x: number,
  z: number,
  aspect: number,
  dt: number,
  armActive: boolean,
  out: FollowSpot,
): FollowSpot {
  // The zoom glide: a wheel notch or a pinch eases in, and the distance then holds the player's value exactly.
  rig.renderDist = smoothToward(rig.renderDist, orbit.distance, dt);

  // The place's camera limit: a building's ceiling (the active map's). Eased toward 1 inside, then the spot's height
  // (and distance, where the limit names one) are clamped.
  const map = getActiveMap();
  const limitNow = cameraLimitAt(map);
  if (limitNow) rig.limit = limitNow;
  const engage = stepCapEngage(rig.capEngage, limitNow !== undefined, dt);
  rig.capEngage = engage;
  const wantedDistance = rig.renderDist * aspectDistanceScale(aspect);
  out.distance = limitedDistance(wantedDistance, rig.limit, engage);
  const wantedHoriz = wantedDistance * Math.cos(orbit.pitch);
  let tpX = x + wantedHoriz * Math.sin(orbit.yaw);
  let tpY = HEAD_HEIGHT + wantedDistance * Math.sin(orbit.pitch);
  let tpZ = z + wantedHoriz * Math.cos(orbit.yaw);
  if (engage > 0) {
    wantedSpot.x = tpX;
    wantedSpot.y = tpY;
    wantedSpot.z = tpZ;
    headSpot.x = x;
    headSpot.y = HEAD_HEIGHT;
    headSpot.z = z;
    indoorCameraClamp(wantedSpot, headSpot, rig.limit, engage, limitedSpot);
    tpX = limitedSpot.x;
    tpY = limitedSpot.y;
    tpZ = limitedSpot.z;
  }

  // Spring arm: cast head → wanted spot against the walls and, while one is in the way, shorten the arm to just in
  // front of it — outdoors along the camera's own line (the angle is kept), indoors keeping the height and lifting the
  // look over the head (cameraCollision.ts). Clear again, the arm grows back to exactly the wanted spot.
  out.lookLift = 0;
  if (armActive) {
    const offX = tpX - x;
    const offY = tpY - HEAD_HEIGHT;
    const offZ = tpZ - z;
    const reach = Math.sqrt(offX * offX + offY * offY + offZ * offZ);
    if (reach > 1e-6) {
      const indoor = indoorArmAt(map, limitNow);
      // outdoors the camera also keeps out of the trees' trunks and limbs (cameraCollision.setCameraKeepOut)
      const walls = springArmDistance(x, HEAD_HEIGHT, z, tpX, tpY, tpZ, reach);
      const clear = indoor ? walls : Math.min(walls, keepOutArmDistance(x, HEAD_HEIGHT, z, tpX, tpY, tpZ, reach));
      rig.armLimit = stepArmLimit(rig.armLimit, clear, reach, dt);
      // the arm growing back out stops in front of a limb it would run into (it takes it in at once, as a wall)
      if (!indoor && rig.armLimit < reach) rig.armLimit = Math.min(rig.armLimit, keepOutArmDistance(x, HEAD_HEIGHT, z, tpX, tpY, tpZ, reach, undefined, rig.armLimit));
      if (rig.armLimit < reach) {
        const k = rig.armLimit / reach;
        tpX = x + offX * k;
        tpZ = z + offZ * k;
        if (indoor) {
          // Shaped against the old 3.6 m reference, not the (now uncapped) wanted arm: see indoorArmShape.
          const shape = indoorArmShape(rig.armLimit, reach, offY, orbit.pitch);
          tpY = HEAD_HEIGHT + shape.offY;
          out.lookLift = shape.lookLift;
        } else {
          tpY = HEAD_HEIGHT + offY * armHeightScaleAt(k, indoor);
          out.lookLift = armLookLiftAt(k, indoor);
        }
      }
    }
  } else {
    rig.armLimit = ARM_FREE;
  }

  // Never under the floor: a low pitch at a long zoom would otherwise look up at the ground's underside.
  out.x = tpX;
  out.y = aboveGroundY(tpY);
  out.z = tpZ;
  return out;
}
