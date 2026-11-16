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
 *   - the spring arm (cameraCollision.ts): a building or a wall between the head and the camera pulls it in at once, and
 *     lets it back out (SPRING.returnRate) as soon as the way is clear — props (lamps, posts, plants, trees, the shelter, the
 *     kiosk, furniture) never change the distance (owner 2026-11-16);
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
import { ARM_FREE, armBoxes, armHeightScaleAt, armLookLiftAt, cameraPad, indoorArmShape, segmentHitFraction, springArmDistance, stepArmLimit } from "./cameraCollision";
import { createShoulderPose, portraitWeight, shoulderPose, shoulderTarget, stepShoulder, stepShoulderSide } from "./cameraShoulder";
import { getActiveMap } from "./activeMap";
import { HUNG, cameraSolids } from "./cameraSolids";
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
  /** Over-the-shoulder blend against an indoor wall (cameraShoulder.ts), eased: 0 off .. 1 whole. */
  shoulder: number;
  /** The shoulder side in use (+1 right, −1 left), 0 while the shoulder view is off. */
  shoulderSide: number;
  /** The side drawn, eased toward `shoulderSide` (a switch swings over). */
  shoulderSideEase: number;
  /** The clear length of the line from the head through the place's solid model (cameraSolids.ts), eased like the arm (m). */
  solidLimit: number;
}

/** One frame's third-person camera spot. */
export interface FollowSpot {
  x: number;
  y: number;
  z: number;
  /** How far (m) the look target rises over the head this frame (only while an indoor wall shortens the arm). */
  lookLift: number;
  /** The look target's horizontal offset from the body (m): 0 but for the over-the-shoulder view, which looks ahead. */
  lookX: number;
  lookZ: number;
  /** Degrees added to the vertical field of view this frame (the over-the-shoulder view on a portrait phone). */
  fovAdd: number;
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
    shoulder: 0,
    shoulderSide: 0,
    shoulderSideEase: 0,
    solidLimit: ARM_FREE,
  };
}

/** A fresh spot to write into (CameraRig makes one per mount; nothing is allocated per frame). */
export function createFollowSpot(): FollowSpot {
  return { x: 0, y: 0, z: 0, lookLift: 0, lookX: 0, lookZ: 0, fovAdd: 0, distance: 0 };
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
  rig.shoulder = 0;
  rig.shoulderSide = 0;
  rig.shoulderSideEase = 0;
  rig.solidLimit = ARM_FREE;
  return true;
}

/** At most this much higher (×) a wall-shortened indoor arm keeps its camera on a portrait screen (cameraCollision indoorArmShape). */
export const PORTRAIT_INDOOR_LIFT_MAX = 1.45;
/**
 * …and at least this much higher on any screen. Round 7 review: on PC the arrival view (the door wall right behind) had the head
 * square over the "기억의 자리" across the hall; a little higher, the head sits under it and the niche shows whole.
 */
export const INDOOR_LIFT_MIN = 1.25;

/**
 * How much (degrees) a portrait phone's view widens at most when an indoor wall cuts the camera's arm short. Round 8 used the
 * over-the-shoulder view's 22 (`SHOULDER.portraitFovAdd`); round 9 review: arriving in the memorial hall (the door wall 3.1 m
 * behind) the own avatar still covered about a third of a phone's screen height over the niche and the benches.
 */
export const PORTRAIT_INDOOR_FOV_ADD = 32;
/** How much (m) a wall must cut an indoor arm short for a portrait phone's view to be widened whole (PORTRAIT_INDOOR_FOV_ADD). */
export const PORTRAIT_WIDEN_AT = 2.0;

/** Scratch points for the camera limit, made once and rewritten every frame — the clamp allocates nothing. */
const wantedSpot: Vec3 = { x: 0, y: 0, z: 0 };
const headSpot: Vec3 = { x: 0, y: 0, z: 0 };
const limitedSpot: Vec3 = { x: 0, y: 0, z: 0 };
const shoulderSpot = createShoulderPose();

/**
 * Advance the rig by `dt` and write the third-person camera spot for a player standing at (x, z) into `out`.
 *
 * `armActive` is false while the third-person pose is not drawn at all (full first person): the walls are then not
 * cast against, and the arm is reset so coming back out of first person starts with a free arm.
 */
/** How far (m) before a wall's box the in-wall guard leaves the lens, and the walls' height for its cast. */
const IN_WALL_BACKOFF = 0.06;
const WALL_HEIGHT_GUARD = 100;

/** Whether (x, y, z) lies inside a standing wall box (a wall, a partition: at least 1.6 m tall, from the floor; props never count). */
function insideTallBox(x: number, y: number, z: number): boolean {
  for (const b of armBoxes()) {
    if (b.height === undefined || b.height < 1.6 || b.minY !== undefined) continue;
    if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && y < b.height) return true;
  }
  return false;
}

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
  out.lookX = 0;
  out.lookZ = 0;
  out.fovAdd = 0;
  let shoulderWanted = 0;
  if (armActive) {
    const offX = tpX - x;
    const offY = tpY - HEAD_HEIGHT;
    const offZ = tpZ - z;
    const reach = Math.sqrt(offX * offX + offY * offY + offZ * offZ);
    if (reach > 1e-6) {
      const indoor = indoorArmAt(map, limitNow);
      // only buildings and walls shorten the arm (owner 2026-11-16): not the trees, not the props (cameraCollision.armBoxes)
      const clear = springArmDistance(x, HEAD_HEIGHT, z, tpX, tpY, tpZ, reach);
      rig.armLimit = stepArmLimit(rig.armLimit, clear, reach, dt);
      if (rig.armLimit < reach) {
        const k = rig.armLimit / reach;
        tpX = x + offX * k;
        tpZ = z + offZ * k;
        if (indoor) {
          // Shaped against the old 3.6 m reference, not the (now uncapped) wanted arm: see indoorArmShape.
          const shape = indoorArmShape(rig.armLimit, reach, offY, orbit.pitch, Math.max(INDOOR_LIFT_MIN, Math.min(PORTRAIT_INDOOR_LIFT_MAX, aspectDistanceScale(aspect))));
          tpY = HEAD_HEIGHT + shape.offY;
          out.lookLift = shape.lookLift;
          // A portrait phone's view widens as the wall cuts the arm short (round 8 review: on arrival, the door wall 3.1 m
          // behind, the own back covered half a phone's screen): whole once the arm is PORTRAIT_WIDEN_AT m short.
          out.fovAdd = PORTRAIT_INDOOR_FOV_ADD * portraitWeight(aspect) * Math.min(1, Math.max(0, (reach - rig.armLimit) / PORTRAIT_WIDEN_AT));
          // Pushed this close to the head by the wall behind: over the shoulder instead of over the head (cameraShoulder.ts).
          shoulderWanted = shoulderTarget(Math.hypot(tpX - x, tpZ - z));
        } else {
          tpY = HEAD_HEIGHT + offY * armHeightScaleAt(k, indoor);
          out.lookLift = armLookLiftAt(k, indoor);
        }
      }
    }
  } else {
    rig.armLimit = ARM_FREE;
  }
  rig.shoulder = stepShoulder(rig.shoulder, shoulderWanted, dt);
  if (rig.shoulder > 0) {
    const fresh = rig.shoulderSide === 0;
    const sh = shoulderPose(x, z, orbit.yaw, tpX, tpZ, aspect, rig.shoulderSide, armBoxes(), cameraPad(), shoulderSpot, fresh ? Number.NaN : rig.shoulderSideEase);
    rig.shoulderSideEase = fresh ? sh.side : stepShoulderSide(rig.shoulderSideEase, sh.side, dt);
    rig.shoulderSide = sh.side;
    const s = rig.shoulder;
    tpX += (sh.x - tpX) * s;
    tpY += (sh.y - tpY) * s;
    tpZ += (sh.z - tpZ) * s;
    out.lookX = sh.lookX * s;
    out.lookZ = sh.lookZ * s;
    out.lookLift += (sh.lookLift - out.lookLift) * s;
    out.fovAdd += (sh.fovAdd - out.fovAdd) * s;
  } else {
    rig.shoulderSide = 0;
    rig.shoulderSideEase = 0;
  }

  // Under what hangs from the hall's ceiling (the lounge's louvres, the soffit: round 8 review) the camera is held below it — a
  // ceiling, so it may (owner 2026-11-16). The hall's furniture (sofa backs, tables) no longer pulls the arm in: props never do.
  const solids = armActive ? cameraSolids() : null;
  if (solids) {
    const cap = solids.hungCap(tpX, tpZ, HUNG.from, HUNG.clear, HUNG.near, HUNG.slope);
    if (tpY > cap) tpY = Math.max(HEAD_HEIGHT, cap);
  }
  rig.solidLimit = ARM_FREE;

  // The last word: never inside a wall's own box. A thin partition's end beside a doorway (12 cm, 집 실내 G house 2 upstairs) could take
  // the shoulder's side leg past the padded corner and leave the lens in the board: pulled back along the head's line to just before it.
  if (insideTallBox(tpX, tpY, tpZ)) {
    const len = Math.hypot(tpX - x, tpY - HEAD_HEIGHT, tpZ - z);
    const t = segmentHitFraction(x, HEAD_HEIGHT, z, tpX, tpY, tpZ, armBoxes(), WALL_HEIGHT_GUARD, 0);
    const k = Math.max(0, t - IN_WALL_BACKOFF / Math.max(len, 1e-6));
    tpX = x + (tpX - x) * k;
    tpY = HEAD_HEIGHT + (tpY - HEAD_HEIGHT) * k;
    tpZ = z + (tpZ - z) * k;
  }

  // Never under the floor: a low pitch at a long zoom would otherwise look up at the ground's underside.
  out.x = tpX;
  out.y = aboveGroundY(tpY);
  out.z = tpZ;
  return out;
}
