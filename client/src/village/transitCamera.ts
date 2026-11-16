import { BUS_POLES, BUS_SEAT_BACKS, BUS_SEATS, BUS_STRAPS, BUS_CEILING } from "@caysonverse/shared/village/busCabin";
import type { TransitPose } from "@caysonverse/shared/village/transit";

/**
 * The rider's camera inside the village bus (owner 2026-11-15: "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을 다 볼 수 있어야
 * 해"). The old fixed over-the-shoulder shot (one window side only) is gone: inside the bus the camera is the village's
 * third-person orbit, tied to the bus's frame — it turns with the bus, so "front" stays the front through the ring road's
 * curve. Drag (mouse / one finger) turns it round the rider, the wheel / pinch pulls it in (all the way in is first person),
 * and the panel's quick views (BUS_VIEW_YAW) ease it to the left windows, the front, the right windows or the back.
 *
 * Pure (unit-tested): `busRiderCamera` places the eye in the bus's own frame (ahead / right / up) and the spring arm keeps
 * it inside the cabin's shell and in front of the seat backs; `fadingFixtures` names the poles, strap groups and rails that
 * stand between the lens and the rider (or right at the lens), which the scene draws see-through.
 */

export interface TransitCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  /** How far (m) the eye is from the rider's head after the arm was shortened by the cabin (0 = first person). */
  arm: number;
  /** First person: the eye is the rider's own and the avatar is hidden. */
  firstPerson: boolean;
}

/** The rider's lens (vertical degrees): wider than the village's 55 in the small cabin, wider still on a portrait phone. */
export function riderFov(aspect: number): number {
  return aspect < 1 ? 78 : 68;
}

/** The longest arm (m) in the bus, and the distance under which the camera is the rider's own eye. */
export const BUS_CAM = { maxDist: 2.6, firstPersonDist: 0.35, portraitMaxDist: 2.9, pad: 0.12 } as const;

/**
 * The cabin's shell as the camera's limit (bus-local m): the eye stays inside it so a wall (the windscreen's cowl, the back
 * wall, the roof) never hides the rider. The side windows are glass: the walls' inner face is 1.195, a little inside it.
 */
export const BUS_SHELL = { aheadMin: -4.1, aheadMax: 4.0, right: 1.12, top: BUS_CEILING - 0.1 } as const;

type V3 = readonly [number, number, number];

/** The head's height over the floor the rider stands or sits on (m): the avatar's head centre (chibi, 2.18 m to the top). */
export const RIDER_HEAD_STANDING = 1.95;
export const RIDER_HEAD_SEATED = 1.62;

/** Where the segment from `p` towards `q` first meets a box (fraction 0..1), or 1: the slab test. */
function segmentBoxFraction(p: V3, q: V3, min: V3, max: V3): number {
  let enter = 0;
  let exit = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k]! - p[k]!;
    if (Math.abs(d) < 1e-9) {
      if (p[k]! < min[k]! || p[k]! > max[k]!) return 1;
      continue;
    }
    let t1 = (min[k]! - p[k]!) / d;
    let t2 = (max[k]! - p[k]!) / d;
    if (t1 > t2) [t1, t2] = [t2, t1];
    if (t1 > enter) enter = t1;
    if (t2 < exit) exit = t2;
    if (enter > exit) return 1;
  }
  return enter;
}

/** Where the segment leaves the box (fraction), for a start inside it: 1 when the whole segment is inside. */
function segmentBoxExit(p: V3, q: V3, min: V3, max: V3): number {
  let exit = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k]! - p[k]!;
    if (Math.abs(d) < 1e-9) continue;
    const t = d > 0 ? (max[k]! - p[k]!) / d : (min[k]! - p[k]!) / d;
    if (t < exit) exit = t;
  }
  return Math.max(0, exit);
}

export interface BusCamInput {
  /** The bus's pose (world). */
  bus: Pick<TransitPose, "x" | "z" | "yaw">;
  /** The rider's point in the bus (m ahead of its middle, m towards its doors) and the floor under them. */
  ahead: number;
  right: number;
  floor: number;
  seated: boolean;
  /** The camera's azimuth relative to the bus's heading (the world orbit's convention: 0 = in front of the rider looking back) */
  yaw: number;
  /** The camera's elevation over the head (rad, + = above looking down). */
  elevation: number;
  /** The wanted arm (m): 0 .. BUS_CAM.maxDist. Under firstPersonDist the camera is the rider's eye. */
  dist: number;
  /** The seat the rider sits on (its backrest is not a wall for them), or -1. */
  ownSeat?: number;
  /** The lens (vertical fov in radians, width / height): with it the third person is framed over the shoulder (the avatar low in a lower corner, not the screen middle). */
  frame?: { vfov: number; aspect: number };
}

const EYE_SHELL_MIN_H = 0.3;

/** Where the avatar's middle sits on the third-person screen (fractions of the half width / half height from the centre: right, down). */
export const TP_FRAME = { x: 1.0, y: -0.8 } as const;
/** The third person's arm (m) in the bus: the zoom may shorten it, but never into the avatar's lap (a chibi head is 1 m wide). */
export const BUS_TP_MIN_ARM = 2.6;
/** The least elevation (rad) of the third person's lens over the rider's head line: it looks down on the rider from above. */
export const TP_ELEVATION = 0.3;
/** Under this arm (m) the third person's lens tries the other side of the rider. */
export const TP_FLIP_ARM = 2.2;

/**
 * The eye and the point it looks at, in the world. The wanted eye is the rider's head plus the arm in the camera's azimuth
 * and elevation; the arm is shortened to stop inside the shell and `BUS_CAM.pad` short of the first seat back.
 */
export function busRiderCamera(input: BusCamInput, out: TransitCameraPose = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, arm: 0, firstPerson: false }): TransitCameraPose {
  const { bus, ahead, right, floor, seated, yaw, elevation } = input;
  const headH = floor + (seated ? RIDER_HEAD_SEATED : RIDER_HEAD_STANDING);
  const head: V3 = [ahead, right, headH + 0.1];
  const dirA = Math.cos(yaw);
  const dirR = -Math.sin(yaw);
  const firstPerson = input.dist < BUS_CAM.firstPersonDist;
  let eye: V3;
  let target: V3;
  if (firstPerson) {
    // the rider's own eye: looking the way the camera's azimuth faces AWAY from the rider (the opposite of the orbit's offset)
    const ce = Math.cos(elevation);
    eye = [ahead - dirA * 0.05, right - dirR * 0.05, headH];
    target = [eye[0] - dirA * ce * 3, eye[1] - dirR * ce * 3, eye[2] - Math.sin(elevation) * 3];
  } else {
    const d = input.dist;
    // With a lens (frame) the camera stays on the AISLE line (in front of the rider or behind them, whichever the view yaw is nearer), raised
    // and as far as the cabin allows: the cabin is as narrow as an avatar is tall, so the old orbit round the rider pressed the lens against a
    // window and the rider's head filled the screen. The view yaw then only turns where the lens LOOKS (a side view looks at the windows, the
    // rider at the edge of the picture or out of it).
    const el = input.frame ? Math.max(TP_ELEVATION, Math.min(0.8, elevation)) : elevation;
    const ce = Math.cos(el);
    const posA = input.frame ? (dirA >= 0 ? 1 : -1) : dirA;
    const posR = input.frame ? 0 : dirR;
    const min: V3 = [BUS_SHELL.aheadMin, -BUS_SHELL.right, Math.max(floor + EYE_SHELL_MIN_H, 0.6)];
    const max: V3 = [BUS_SHELL.aheadMax, BUS_SHELL.right, BUS_SHELL.top];
    const inside = (p: V3) => p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
    const eyeFor = (pa: number, pr: number): V3 => {
      const want: V3 = [head[0] + pa * ce * d, head[1] + pr * ce * d, head[2] + Math.sin(el) * d];
      // 1) the shell: inside its box; if the wanted eye is outside, stop where the arm leaves it
      let t = 1;
      if (inside(head)) {
        if (!inside(want)) t = Math.min(t, segmentBoxExit(head, want, min, max));
      } else {
        t = 0; // a head outside the shell (the stairs, a stale pose): no arm
      }
      // 2) the seat backs (the rider's own is no wall for them)
      BUS_SEAT_BACKS.forEach((b, i) => {
        if (i === input.ownSeat) return;
        // grown by the pad in plan; the eye must stay clear of the back's face
        const bmin: V3 = [b.min[0] - BUS_CAM.pad, b.min[1] - BUS_CAM.pad, b.min[2]];
        const bmax: V3 = [b.max[0] + BUS_CAM.pad, b.max[1] + BUS_CAM.pad, b.max[2]];
        const f = segmentBoxFraction(head, want, bmin, bmax);
        if (f < t) t = f;
      });
      t = Math.max(0, Math.min(1, t));
      return [head[0] + (want[0] - head[0]) * t, head[1] + (want[1] - head[1]) * t, head[2] + (want[2] - head[2]) * t];
    };
    const armOf = (e: V3) => Math.hypot(e[0] - head[0], e[1] - head[1], e[2] - head[2]);
    eye = eyeFor(posA, posR);
    if (input.frame && armOf(eye) < TP_FLIP_ARM) {
      // the aisle is short on this side (the cabin's end or a seat back close by): the lens goes to the other side if that gives a longer arm
      const other = eyeFor(-posA, 0);
      if (armOf(other) > armOf(eye)) eye = other;
    }
    target = head;
    if (input.frame) {
      const arm0 = Math.hypot(eye[0] - head[0], eye[1] - head[1], eye[2] - head[2]);
      const centre: V3 = [head[0], head[1], head[2] - 0.85];
      const toA = centre[0] - eye[0];
      const toR = centre[1] - eye[1];
      const horiz = Math.max(Math.hypot(toA, toR), 0.2);
      const azAvatar = Math.atan2(toR, toA);
      // the look direction: the view yaw's (the camera's azimuth is yaw, it looks back along it)
      const azView = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
      const delta = Math.atan2(Math.sin(azView - azAvatar), Math.cos(azView - azAvatar));
      const weight = Math.max(0, 1 - Math.abs(delta) / 0.9); // 1 when the lens looks at the rider: then the rider is put in a lower corner
      const th = Math.tan(input.frame.vfov / 2);
      const thetaX = Math.atan(TP_FRAME.x * th * input.frame.aspect) * weight;
      const lookAz = azView - thetaX; // the lens turns left: the rider moves right on the screen
      const down0 = Math.atan2(eye[2] - centre[2], horiz); // looking down at the rider's middle
      const down = (down0 + Math.atan(TP_FRAME.y * th) * weight) * weight + 0.12 * (1 - weight); // up a little: the rider sits low
      void arm0;
      target = [eye[0] + Math.cos(lookAz) * Math.cos(down) * 3, eye[1] + Math.sin(lookAz) * Math.cos(down) * 3, eye[2] - Math.sin(down) * 3];
    }
  }
  const arm = Math.hypot(eye[0] - head[0], eye[1] - head[1], eye[2] - head[2]);
  out.arm = firstPerson ? 0 : arm;
  out.firstPerson = firstPerson || arm < BUS_CAM.firstPersonDist;
  // to the world: the bus frame's ahead is its heading (sin yaw, cos yaw), its right is (-cos yaw, sin yaw)
  const fx = Math.sin(bus.yaw);
  const fz = Math.cos(bus.yaw);
  const rx = -fz;
  const rz = fx;
  out.x = bus.x + fx * eye[0] + rx * eye[1];
  out.y = eye[2];
  out.z = bus.z + fz * eye[0] + rz * eye[1];
  out.targetX = bus.x + fx * target[0] + rx * target[1];
  out.targetY = target[2];
  out.targetZ = bus.z + fz * target[0] + rz * target[1];
  return out;
}

/** The shortest distance between two segments (bus-local points), for the fixtures' fade test. */
export function segmentDistance(p1: V3, q1: V3, p2: V3, q2: V3): number {
  const d1: V3 = [q1[0] - p1[0], q1[1] - p1[1], q1[2] - p1[2]];
  const d2: V3 = [q2[0] - p2[0], q2[1] - p2[1], q2[2] - p2[2]];
  const r: V3 = [p1[0] - p2[0], p1[1] - p2[1], p1[2] - p2[2]];
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const a = dot(d1, d1);
  const e = dot(d2, d2);
  const f = dot(d2, r);
  let s: number;
  let t: number;
  if (a <= 1e-12 && e <= 1e-12) return Math.hypot(r[0], r[1], r[2]);
  if (a <= 1e-12) {
    s = 0;
    t = Math.min(1, Math.max(0, f / e));
  } else {
    const c = dot(d1, r);
    if (e <= 1e-12) {
      t = 0;
      s = Math.min(1, Math.max(0, -c / a));
    } else {
      const b = dot(d1, d2);
      const denom = a * e - b * b;
      s = denom > 1e-12 ? Math.min(1, Math.max(0, (b * f - c * e) / denom)) : 0;
      t = (b * s + f) / e;
      if (t < 0) {
        t = 0;
        s = Math.min(1, Math.max(0, -c / a));
      } else if (t > 1) {
        t = 1;
        s = Math.min(1, Math.max(0, (b - c) / a));
      }
    }
  }
  const c1: V3 = [p1[0] + d1[0] * s, p1[1] + d1[1] * s, p1[2] + d1[2] * s];
  const c2: V3 = [p2[0] + d2[0] * t, p2[1] + d2[1] * t, p2[2] + d2[2] * t];
  return Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]);
}

/** The two ceiling rails (build_bus.py): along the cabin at right ±0.60, 2.85 m up, from xf 1.62 to 8.0. */
const RAIL_AHEAD: readonly [number, number] = [4.5 - 1.62, 4.5 - 8.0];
const RAIL_H = 2.85;

/** Strap groups: four straps 0.5 m apart, centred at the generated point. */
const STRAP_HALF_SPAN = 0.75;

/** How close (m) a thin thing may come to the lens, and to the line from the lens to the rider's head and chest, before it fades. */
export const FADE_NEAR_LENS = 0.6;
export const FADE_NEAR_SIGHT = 0.2;
/** In third person, a fixture this close (m) to the rider's body axis is not drawn (it would run across the avatar). */
export const FADE_NEAR_BODY = 0.45;

/**
 * Names of the cabin fixtures (poles, strap groups, rails) the camera sees through: within `FADE_NEAR_LENS` of the eye, or
 * within `FADE_NEAR_SIGHT` of the line from the eye to the rider's head or chest. Bus-local eye / head / chest points.
 * Written into `out` (cleared first); returns it.
 */
export function fadingFixtures(eye: V3, head: V3, chest: V3, out: Set<string> = new Set()): Set<string> {
  out.clear();
  const eyeToHead = segmentLen(eye, head);
  // Third person (review r1: poles, bells and straps ran across the sitting avatar's shoulders, arm and head): everything
  // within the body's reach of the avatar's axis (feet to a hat's height) is not drawn either, whichever way the lens looks.
  const body = eyeToHead > 0.05;
  const bodyA: V3 = [head[0], head[1], chest[2] - 1.1];
  const bodyB: V3 = [head[0], head[1], head[2] + 0.8];
  for (const p of BUS_POLES) {
    const a: V3 = [p.ahead, p.right, p.z0];
    const b: V3 = [p.ahead, p.right, p.z1];
    if (body && segmentDistance(bodyA, bodyB, a, b) < FADE_NEAR_BODY) {
      out.add(p.name);
      continue;
    }
    if (segmentDistance(eye, eye, a, b) < FADE_NEAR_LENS || (eyeToHead > 0.05 && (segmentDistance(eye, head, a, b) < FADE_NEAR_SIGHT || segmentDistance(eye, chest, a, b) < FADE_NEAR_SIGHT))) out.add(p.name);
  }
  for (const s of BUS_STRAPS) {
    const a: V3 = [s.ahead - STRAP_HALF_SPAN, s.right, s.z0];
    const b: V3 = [s.ahead + STRAP_HALF_SPAN, s.right, s.z1];
    if (body && segmentDistance(bodyA, bodyB, a, b) < FADE_NEAR_BODY) out.add(s.name);
    else if (segmentDistance(eye, eye, a, b) < FADE_NEAR_LENS || segmentDistance(eye, head, a, b) < FADE_NEAR_SIGHT || segmentDistance(eye, chest, a, b) < FADE_NEAR_SIGHT) out.add(s.name);
  }
  for (const [side, name] of [[1, "rail_r"], [-1, "rail_l"]] as const) {
    const a: V3 = [RAIL_AHEAD[0], side * 0.6, RAIL_H];
    const b: V3 = [RAIL_AHEAD[1], side * 0.6, RAIL_H];
    if (segmentDistance(eye, eye, a, b) < FADE_NEAR_LENS || segmentDistance(eye, head, a, b) < FADE_NEAR_SIGHT || segmentDistance(eye, chest, a, b) < FADE_NEAR_SIGHT) out.add(name);
  }
  return out;
}

function segmentLen(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** The seat a rider sits on (index into BUS_SEATS) from `busSeat`, or -1 (a backed seat's own back is no wall for the camera). */
export function ownSeatIndex(busSeat: number): number {
  return busSeat >= 1 && busSeat <= BUS_SEATS.length ? busSeat - 1 : -1;
}
