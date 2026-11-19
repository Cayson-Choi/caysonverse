/**
 * Over-the-shoulder camera against a wall, indoors (review 2026-11-15 round 6).
 *
 * Inside the memorial hall the player keeps walking up to a cubby bank, the "기억의 자리" niche or the letter table and
 * then turning round to face the room. The spring arm (cameraCollision.ts) then pulls the camera in to just in front of
 * the wall behind, and the indoor arm shape keeps its height — so it ended up right over the head (2.9 m, 1.8 m from it)
 * looking down, and the back of the head filled 50 % of a PC screen and 70-80 % of a phone. Good third-person games
 * slide the camera to an over-the-shoulder offset at that point, look level, and let the body fade a little.
 *
 * Here: while the spring-armed spot is nearer than `SHOULDER.engageBelow` to the head (across the floor), the camera blends (eased,
 * never a hard pop) toward a spot to the side of the body. Round 7 review: the round-6 shoulder spot (0.55 m aside, 0.95 m up) made
 * the own avatar a see-through brown dome over the bottom third of a PC screen and a brown edge on a phone. Now the camera stands
 * well to the side (2.8 m on PC, 2.0 m on a portrait phone, as the walls allow), a little over the head and as far back as the
 * wall allows, and the view is turned so the head and shoulders sit whole in the lower corner away from the camera (on a phone
 * lower in the middle, its view widened by `portraitFovAdd`), the rest of the screen the room, looked at nearly level. The side is
 * the one with more room and is kept while engaged unless the other has much more (a corner), when it swings over, eased. A
 * wall at the side shortens the offset like the arm. Like every arm change it shapes one frame and never writes the player's
 * orbit: the wall clear again, the camera is exactly back where the player put it. The body stays solid (LocalPlayer fades it
 * only when a camera is really close: SELF_COVER_FADE_*).
 */

import type { CameraBox } from "@caysonverse/shared/collision";
import { WALL_HEIGHT } from "@caysonverse/shared/worldMap";
import { HEAD_HEIGHT } from "./constants";
import { CAMERA_LOOK_LIFT } from "./cameraControls";
import { segmentHitFraction } from "./cameraCollision";

export const SHOULDER = {
  /**
   * The shoulder view starts once the wall has pulled the camera nearer than this to the head, measured across the floor (m):
   * however high the tilt holds it, a camera nearly over the head looks down on it. Arrival is 3.1 m out; a seat's first
   * framing 2.9 m+ (3.35 m at a tilt of at most 0.5).
   */
  engageBelow: 2.4,
  /** …and is whole at or under this (m). */
  fullBelow: 1.7,
  /**
   * Side offset (m) on a wide screen, and on a tall portrait one. Round 7 review: at 0.55 m the lens sat right over the head and
   * the head was a see-through dome over the bottom third of the screen; a metre to the side the head and shoulders fit whole.
   */
  side: 2.8,
  sidePortrait: 2.0,
  /** How far behind the head (m) the camera may go when the wall leaves room (the arm's own spot is never passed). */
  maxBack: 1.4,
  /** …and at least this far back (m) when the wall is that close (the side offset then carries the distance). */
  minBack: 0.25,
  /** Height of the shoulder camera over the head (m), on a wide screen and on a tall portrait one. */
  lift: 1.1,
  liftPortrait: 1.4,
  /**
   * Where the head's centre lands on screen (normalised, ±1 at the edges): `u` toward the side away from the camera (the head
   * sits in a lower corner, the room fills the rest), `v` below the middle. Portrait screens are narrow: the head stays nearer
   * the middle there.
   */
  headU: 0.45,
  headUPortrait: 0.1,
  headV: -0.35,
  headVPortrait: -0.4,
  /** Height of the head's centre (m) the framing places. */
  headY: HEAD_HEIGHT + 0.05,
  /** The vertical field of view grows by this much (deg) on a tall portrait screen while the shoulder view is whole. */
  portraitFovAdd: 22,
  /**
   * The look's tilt below the horizon is kept within this (deg): the room stays in view. Where both sides are cramped (a corner)
   * the camera rises instead of moving out (`minHeadDist`), and the look may tilt down up to `maxLookDownCramped`.
   */
  maxLookDown: 16,
  maxLookDownCramped: 32,
  /** The other side takes over once it has this much more room (m). */
  switchMargin: 0.9,
  /** Easing time constant (s) of a side switch. */
  sideTau: 0.3,
  /** Easing time constant (s) of the blend in and out. */
  tau: 0.14,
  /** Never closer to the head than this (m): the lift grows to keep it (and the look tilts down further, see above). */
  minHeadDist: 2.1,
} as const;

/**
 * The centred view (owner 2026-11-19, in the 대웅전: "머리 정 가운데 뒤쪽에서 불상을 바라보고 싶은데 무조건 왼쪽이나 오른쪽으로
 * 이동한 카메라만 가능"). The side offset was made for a wall right behind the head (the cubby banks, 0.7 m). Where the wall leaves
 * the arm `from` m or more behind the head (a hall's cushion row, a pew, 1.5-2 m from the wall) the camera stays on the player's own
 * view axis — right behind the head, a little over it, the look level so what the player faces (the Buddha) sits in the middle of the
 * screen and the head is a small dome at the bottom edge. Between `from` and `full` the two views blend, eased like every shoulder
 * change; against a close wall (arm under `from`) the over-the-shoulder view above is unchanged.
 */
export const CENTER = {
  /** The arm's length behind the head (m) where the centred view starts… */
  from: -1,
  /** …and is whole from here on. */
  full: 0,
  /** How far behind the head (m) the centred camera stands at most (the arm's own spot is never passed). */
  maxBack: 2.2,
  /** Height over the head (m), wide screen and portrait. */
  lift: 1.05,
  liftPortrait: 1.7,
  /** Never closer to the head than this (m). */
  minHeadDist: 2.3,
  /** Where the head's centre lands on screen vertically (NDC): low, so it is a small dome at the bottom and the middle is the room. */
  headV: -0.95,
  headVPortrait: -0.9,
  /** Easing time constant (s) of the blend between the centred and the side view. */
  tau: 0.3,
} as const;

/**
 * How much of the centred view the last follow-camera frame drew (0 .. 1; written by followRig). LocalPlayer reads it to fade the
 * own body while the lens sits right behind the head, so the head does not stand in front of what the player faces.
 */
export const centerLive = { weight: 0 };

/** The centred blend wanted for an arm `armBack` m long behind the head: 0 (side view) .. 1 (centred), smooth in between. */
export function centerWeight(armBack: number): number {
  const c = Math.min(1, Math.max(0, (armBack - CENTER.from) / (CENTER.full - CENTER.from)));
  return c * c * (3 - 2 * c);
}

/** The vertical field of view the game's camera is drawn with (deg, PlayShell's `fov`). */
export const BASE_FOV = 55;

/** The shoulder blend wanted for a spring-armed spot `dist` m from the head across the floor: 0 (off) .. 1 (whole), smooth in between. */
export function shoulderTarget(dist: number): number {
  const u = (SHOULDER.engageBelow - dist) / (SHOULDER.engageBelow - SHOULDER.fullBelow);
  const c = u <= 0 ? 0 : u >= 1 ? 1 : u;
  return c * c * (3 - 2 * c);
}

/** One frame of the eased side (−1 .. 1) toward `side` (`dt` s). */
export function stepShoulderSide(current: number, side: number, dt: number): number {
  const next = side + (current - side) * Math.exp(-Math.min(Math.max(dt, 0), 0.1) / SHOULDER.sideTau);
  return Math.abs(next - side) < 1e-3 ? side : next;
}

/** One frame of the eased centred-view weight (`dt` s): slower than the shoulder blend — it swings the lens across the room. */
export function stepShoulderCenter(current: number, target: number, dt: number): number {
  const next = target + (current - target) * Math.exp(-Math.min(Math.max(dt, 0), 0.1) / CENTER.tau);
  return Math.abs(next - target) < 1e-3 ? target : next;
}

/** One frame of the eased shoulder blend (`dt` s). */
export function stepShoulder(current: number, target: number, dt: number): number {
  const next = target + (current - target) * Math.exp(-Math.min(Math.max(dt, 0), 0.1) / SHOULDER.tau);
  return Math.abs(next - target) < 1e-3 ? target : next;
}

/** The shoulder spot and look, relative to the body at (x, z): written into a caller-owned object (no allocation). */
export interface ShoulderPose {
  x: number;
  y: number;
  z: number;
  /** Look target's horizontal offset from the body (m). */
  lookX: number;
  lookZ: number;
  /** Look target height over HEAD_HEIGHT + CAMERA_LOOK_LIFT (m): what FollowSpot.lookLift carries. */
  lookLift: number;
  /** The centred-view weight wanted (0 side .. 1 centred): the caller eases it and passes it back as `centerEase`. */
  center: number;
  /** The side chosen: +1 = the view's right, −1 = its left. */
  side: number;
  /** Degrees added to the vertical field of view (portrait screens only). */
  fovAdd: number;
}

export function createShoulderPose(): ShoulderPose {
  return { x: 0, y: 0, z: 0, lookX: 0, lookZ: 0, lookLift: 0, center: 0, side: 1, fovAdd: 0 };
}

/** 0 on a wide screen (aspect ≥ 1), 1 on a tall portrait one (aspect ≤ 0.5), linear between. */
export function portraitWeight(aspect: number): number {
  return Math.min(1, Math.max(0, (1 - aspect) / 0.5));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** How much nearer the head (m) the side leg may start than the back leg's end (see shoulderPose). */
const SIDE_PULLS = [0.03, 0.3, 0.6] as const; // never 0: a leg starting on the pad's face counts as clear

/**
 * The over-the-shoulder spot for a body at (x, z), an orbit yaw `yaw`, the spring-armed spot (`armX`, `armZ`) whose
 * horizontal distance behind the head is how far back the wall allows. `keepSide` is the side already in use (0 = pick
 * now: the one with more room, the right on a tie). `boxes` / `pad`: the walls and the pad the arm casts against.
 *
 * Round 7: the camera stands a metre to the side, a little over the head and as far back as the wall allows; the view is then
 * turned so the head and shoulders sit whole in the lower corner away from the camera (the middle, lower, on a portrait phone,
 * whose view also widens) and the rest of the screen is the room, looked at nearly level.
 */
export function shoulderPose(
  x: number,
  z: number,
  yaw: number,
  armX: number,
  armZ: number,
  aspect: number,
  keepSide: number,
  boxes: readonly CameraBox[],
  pad: number,
  out: ShoulderPose,
  /** The eased side actually drawn (−1 .. 1; NaN = `out.side` at once): a side switch swings over, never pops. */
  sideEase = Number.NaN,
  /** The eased centred-view weight actually drawn (NaN = the wanted one at once). */
  centerEase = Number.NaN,
): ShoulderPose {
  const pw = portraitWeight(aspect);
  const bx = Math.sin(yaw);
  const bz = Math.cos(yaw);
  const rx = Math.cos(yaw);
  const rz = -Math.sin(yaw);
  const armBack = Math.max(0, (armX - x) * bx + (armZ - z) * bz);
  const back = Math.min(SHOULDER.maxBack, Math.max(SHOULDER.minBack, armBack));
  const sideW = lerp(SHOULDER.side, SHOULDER.sidePortrait, pw);
  const baseLift = lerp(SHOULDER.lift, SHOULDER.liftPortrait, pw);
  const y = HEAD_HEIGHT + baseLift;
  // The back part first (the arm's own line, clear but for the wall's pad), then the side part from there; the side with more
  // room wins (the right on a tie) and is kept while engaged — unless walking along a bank into a corner leaves it much
  // less room than the other (round 7: the E bank's north end), when the camera swings over (eased by the caller).
  const backT = segmentHitFraction(x, HEAD_HEIGHT, z, x + bx * back, y, z + bz * back, boxes, WALL_HEIGHT, pad);
  const backFull = back * backT;
  // The side leg starts at the back leg's end — or a little nearer the head, where that leaves it longer: the orbit's yaw is
  // seldom square to the wall, and a leg along it from right at the wall's pad would run into the pad within a metre.
  let rightB = backFull;
  let leftB = backFull;
  let right = -1;
  let left = -1;
  for (const pull of SIDE_PULLS) {
    const b = Math.max(0, backFull - pull);
    const px = x + bx * b;
    const pz = z + bz * b;
    const r = segmentHitFraction(px, y, pz, px + rx * sideW, y, pz + rz * sideW, boxes, WALL_HEIGHT, pad) * sideW;
    const l = segmentHitFraction(px, y, pz, px - rx * sideW, y, pz - rz * sideW, boxes, WALL_HEIGHT, pad) * sideW;
    if (Math.hypot(b, r) > Math.hypot(rightB, right) + 1e-3 || right < 0) {
      right = r;
      rightB = b;
    }
    if (Math.hypot(b, l) > Math.hypot(leftB, left) + 1e-3 || left < 0) {
      left = l;
      leftB = b;
    }
  }
  let side = keepSide;
  if (side === 0) side = left > right + 1e-3 ? -1 : 1;
  else if ((side === 1 ? left - right : right - left) > SHOULDER.switchMargin) side = -side;
  const ease = Number.isNaN(sideEase) ? side : Math.max(-1, Math.min(1, sideEase));
  const lateral = ease >= 0 ? right * ease : left * ease;
  const backUsed = ease >= 0 ? lerp(backFull, rightB, ease) : lerp(backFull, leftB, -ease);
  let offX = bx * backUsed + rx * lateral;
  let offZ = bz * backUsed + rz * lateral;
  let horiz = Math.hypot(offX, offZ);
  let lift = Math.max(baseLift, Math.sqrt(Math.max(0, SHOULDER.minHeadDist ** 2 - horiz * horiz)));
  // The centred view where the wall leaves room: on the view axis, the side offset fading out with it (see CENTER).
  const cwWanted = centerWeight(armBack);
  const cw = Number.isNaN(centerEase) ? cwWanted : Math.min(1, Math.max(0, centerEase));
  if (cw > 0) {
    const cb = Math.min(CENTER.maxBack, armBack);
    const cLift = Math.max(lerp(CENTER.lift, CENTER.liftPortrait, pw), Math.sqrt(Math.max(0, CENTER.minHeadDist ** 2 - cb * cb)));
    offX = lerp(offX, bx * cb, cw);
    offZ = lerp(offZ, bz * cb, cw);
    horiz = Math.hypot(offX, offZ);
    lift = lerp(lift, cLift, cw);
  }
  // the whole line from the head must be clear too (the two legs were): a slanted wall or a corner pulls it in
  const whole = segmentHitFraction(x, HEAD_HEIGHT, z, x + offX, HEAD_HEIGHT + lift, z + offZ, boxes, WALL_HEIGHT, pad);
  out.x = x + offX * whole;
  out.y = HEAD_HEIGHT + lift * whole;
  out.z = z + offZ * whole;

  // The view: from the lens toward the head's centre, then turned so the head lands at (u, v) on screen.
  const fovAdd = SHOULDER.portraitFovAdd * pw;
  const tanV = Math.tan(((BASE_FOV + fovAdd) * Math.PI) / 360);
  const tanH = tanV * Math.max(0.1, aspect);
  const u = lerp(SHOULDER.headU, SHOULDER.headUPortrait, pw) * (1 - cw);
  const v = lerp(lerp(SHOULDER.headV, SHOULDER.headVPortrait, pw), lerp(CENTER.headV, CENTER.headVPortrait, pw), cw);
  const hx = x - out.x;
  const hz = z - out.z;
  const hy = SHOULDER.headY - out.y;
  const hHoriz = Math.max(1e-6, Math.hypot(hx, hz));
  // horizontal: the head on the side away from the lens (lens on the right → head on the left), so the view turns away from it
  const turn = Math.atan(u * tanH) * ease;
  const fx = hx / hHoriz;
  const fz = hz / hHoriz;
  // the right of the direction f (y up) is (−fz, fx)
  const vx = fx * Math.cos(turn) - fz * Math.sin(turn);
  const vz = fz * Math.cos(turn) + fx * Math.sin(turn);
  // vertical: the head below the middle by v
  const elevHead = Math.atan2(hy, hHoriz);
  let elev = elevHead + Math.atan(-v * tanV);
  const cramped = Math.min(1, Math.max(0, (SHOULDER.minHeadDist - horiz) / 1.2)) * (1 - cw);
  const maxDown = (lerp(SHOULDER.maxLookDown, SHOULDER.maxLookDownCramped, cramped) * Math.PI) / 180;
  if (elev < -maxDown) elev = -maxDown;
  // never looking up (the side view); the centred view tilts down a little more (about 6 deg) so a low ceiling above stays a small strip
  const maxUp = -0.1 * cw;
  if (elev > maxUp) elev = maxUp;
  const ahead = 6;
  const tx = out.x + vx * ahead * Math.cos(elev);
  const tz = out.z + vz * ahead * Math.cos(elev);
  const ty = out.y + ahead * Math.sin(elev);
  out.lookX = tx - x;
  out.lookZ = tz - z;
  out.lookLift = ty - HEAD_HEIGHT - CAMERA_LOOK_LIFT;
  out.side = side;
  out.center = cwWanted;
  out.fovAdd = fovAdd;
  return out;
}
