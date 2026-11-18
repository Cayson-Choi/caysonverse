import { BUS_SEATS, BUS_CEILING } from "@caysonverse/shared/village/busCabin";
import type { TransitPose } from "@caysonverse/shared/village/transit";
import { selfGap, stepSelfGapHidden } from "../game/selfGap";

/**
 * The rider's camera inside the village bus (docs/designs/bus-controls.md, owner 2026-11-18: "카메라의 각도를 올리고 내리고 하는게
 * 잘 안돼 바닥을 더 보고 싶은데", "1인칭뷰가 아닐때 … 카메라 각도 바꾸고 이동하는 것도 어렵다").
 *
 * Inside the bus the camera is tied to the bus's frame (it turns with the bus, so "front" stays the front through the ring road's
 * curve) and both views AIM the same way: the yaw and the pitch the player drags, wheels or picks with the panel's quick views.
 *   - First person: the rider's own eye at the head (standing, or seated at window height), looking along the aim.
 *   - Third person: over the shoulder. The pivot is the head's centre lifted a little and moved to one shoulder; the lens stands
 *     back from it along the aim (the zoom's arm) and looks exactly along the aim — so the tilt is the player's (down to the floor,
 *     up to the ceiling) and W / the stick walks where the view looks. Only the cabin's shell (walls, ceiling, the two ends; never
 *     the seats: owner 2026-11-16) shortens the arm. A lens pushed nearer than BUS_TP.hideAt to the head hides the own body (the
 *     view is then a clean over-the-shoulder first-person look) — never a see-through head filling the screen.
 *
 * Pure (unit-tested): `busRiderCamera` works in the bus's own frame (ahead / right / up) and returns the world pose.
 */

export interface TransitCameraPose {
  x: number;
  y: number;
  z: number;
  targetX: number;
  targetY: number;
  targetZ: number;
  /** How far (m) the lens is from the rider's head's real centre (0 = first person). */
  arm: number;
  /** How far (m) the lens is from the rider's head and body (selfGap.ts: 0 inside); first person: 0. */
  gap: number;
  /** First person: the eye is the rider's own and the avatar is hidden. */
  firstPerson: boolean;
}

/** The rider's lens (vertical degrees): wider than the village's 55 in the small cabin, wider still on a portrait phone. */
export function riderFov(aspect: number): number {
  return aspect < 1 ? 78 : 68;
}

/** The distance (m, from the orbit's zoom) under which the camera is the rider's own eye. */
export const BUS_CAM = { firstPersonDist: 0.35 } as const;

/**
 * The cabin's shell as the camera's limit (bus-local m): the lens stays inside it so a wall (the windscreen's cowl, the back
 * wall, the roof) never hides the rider. The walls' inner face is 1.195 and the ceiling 3.15: the shell is 0.25 m inside both.
 */
export const BUS_SHELL = { aheadMin: -3.95, aheadMax: 3.95, right: 0.945, top: BUS_CEILING - 0.25 } as const;

/** The first person's eye over the floor the rider stands or sits on (m). */
export const RIDER_HEAD_STANDING = 1.95;
export const RIDER_HEAD_SEATED = 1.62;
/**
 * The head's real centre over the floor (m), for the third person: the chibi avatar's 1 m head runs from its head bone (1.22 m) to
 * its top (2.19 m) standing; seated on the cushion (0.45 m) it is a little higher over the floor.
 */
export const RIDER_HEAD_CENTRE_STANDING = 1.7;
export const RIDER_HEAD_CENTRE_SEATED = 1.75;

/** The third person in the bus (over the shoulder). */
export const BUS_TP = {
  /** the look's tilt range (rad, + = down): up to 43 deg up (the ceiling), down to 80 deg (the floor at the feet) */
  pitchMin: -0.75,
  pitchMax: 1.4,
  /** the arm (m) for the village zoom's least .. most (ZOOM 3.2 .. 10 m): even the least stands past hideAt, where there is room */
  armMin: 2.5,
  armMax: 3.5,
  zoomNear: 3.2,
  zoomFar: 10,
  /** the pivot: this far (m) to the shoulder's side of the head's centre, and this far up */
  shoulder: 0.55,
  lift: 0.35,
  /** the lens never goes lower than this over the floor (m): not behind a seat back's top */
  minOverFloor: 1.15,
  /** a portrait phone's arm is this much longer: a narrow screen shows a near body much bigger (the cabin is 8.6 m long) */
  portraitArm: 1.3,
  /** under the ceiling, a steep look down keeps the head within this angle (rad) above the look's middle (in the picture) */
  headInView: 0.45,
  /**
   * The own body is hidden while the lens is nearer than this (m) to the head's centre, shown again past showAt. The chibi head is
   * 1.1 m tall: from 1.6 m it fills half the picture (owner 2026-11-18: "the head fills half the screen"), from 2.3 m about a third of
   * a PC's height and less of a phone's. Nearer, the view is a clean look past the shoulder (first person in all but name). It also
   * keeps the lens well clear of the head and body (selfGap.ts's 0.6 m everywhere else).
   */
  hideAt: 2.3,
  showAt: 2.5,
  /** ... ×this on a portrait phone: its narrow screen shows a near body bigger (its arm is longer too: portraitArm) */
  portraitHide: 1.15,
} as const;

/** The third person's arm (m) for the village orbit's zoom distance (×1.3 on a portrait phone, as the village's portrait pull-back). */
export function busTpArm(orbitDistance: number, portrait = false): number {
  const k = Math.max(0, Math.min(1, (orbitDistance - BUS_TP.zoomNear) / (BUS_TP.zoomFar - BUS_TP.zoomNear)));
  return (BUS_TP.armMin + (BUS_TP.armMax - BUS_TP.armMin) * k) * (portrait ? BUS_TP.portraitArm : 1);
}

/** Clamp a bus third-person pitch into its range. */
export function clampBusPitch(pitch: number): number {
  return Math.max(BUS_TP.pitchMin, Math.min(BUS_TP.pitchMax, pitch));
}

type V3 = [number, number, number];

/** Where the segment leaves the box (fraction), for a start inside it: 1 when the whole segment is inside. */
function segmentBoxExit(p: V3, q: V3, min: V3, max: V3): number {
  let exit = 1;
  for (let k = 0; k < 3; k++) {
    const d = q[k]! - p[k]!;
    if (Math.abs(d) < 1e-9) continue;
    const t = d > 0 ? (max[k]! - p[k]!) / d : (min[k]! - p[k]!) / d;
    if (t < exit) exit = t;
  }
  return Math.max(0, Math.min(1, exit));
}

export interface BusCamInput {
  /** The bus's pose (world). */
  bus: Pick<TransitPose, "x" | "z" | "yaw">;
  /** The rider's point in the bus (m ahead of its middle, m towards its doors) and the floor under them. */
  ahead: number;
  right: number;
  floor: number;
  seated: boolean;
  /** The camera's azimuth relative to the bus's heading (the world orbit's convention: the view looks the opposite way). */
  yaw: number;
  /** The look's tilt (rad, + = looking down): the first person's fpPitch, the third person's orbit pitch. */
  elevation: number;
  /** The orbit's zoom distance (m); under BUS_CAM.firstPersonDist (the caller passes 0) the camera is the rider's eye. */
  dist: number;
  /** Which shoulder the third person stands over: +1 the right, -1 the left (eased by the caller; 0 = straight behind). Default +1. */
  shoulder?: number;
  /** A portrait phone: the arm is BUS_TP.portraitArm longer. */
  portrait?: boolean;
  /** Unused (kept for callers): the seat the rider sits on. */
  ownSeat?: number;
}

/** The aim in the bus's frame: the horizontal look direction (ahead, right) and the full look vector. */
function aimOf(yaw: number, pitch: number): { hA: number; hR: number; L: V3 } {
  // the orbit's azimuth puts the camera at (cos yaw, -sin yaw) from the rider: the view looks the other way
  const hA = -Math.cos(yaw);
  const hR = Math.sin(yaw);
  const c = Math.cos(pitch);
  return { hA, hR, L: [hA * c, hR * c, -Math.sin(pitch)] };
}

/** How much room (m) the shell leaves beside the head towards each shoulder (+1 right, -1 left) for a view along `yaw`. */
export function shoulderRoom(right: number, yaw: number, side: 1 | -1): number {
  const { hA } = aimOf(yaw, 0);
  // the right of the look (ahead, right) = (-hR, hA): its cabin-right component is hA
  const s = hA * side;
  if (Math.abs(s) < 1e-6) return Infinity;
  return s > 0 ? (BUS_SHELL.right - right) / s : (BUS_SHELL.right + right) / -s;
}

/**
 * The shoulder the third person should stand over: the `preferred` one (the right on a PC, the left on a portrait phone, where the
 * ride panel covers the left of the screen) while it has room beside the head, else the other if that has more. Once on the other
 * side it stays there until the preferred side has clearly room again (no flip-flop at the edge).
 */
export function busShoulderSide(right: number, yaw: number, current: 1 | -1, preferred: 1 | -1 = 1): 1 | -1 {
  const need = BUS_TP.shoulder * 0.6;
  const other: 1 | -1 = preferred === 1 ? -1 : 1;
  const pref = shoulderRoom(right, yaw, preferred);
  if (pref >= (current === preferred ? need : need * 1.5)) return preferred;
  return shoulderRoom(right, yaw, other) > pref ? other : preferred;
}

/** How far across the shoulder pivot goes on a screen of this shape (×BUS_TP.shoulder): less on a narrow portrait phone. */
export function busShoulderScale(aspect: number): number {
  return aspect < 1 ? 0.6 : 1;
}

/**
 * The eye and the point it looks at, in the world. First person: the rider's eye looking along the aim. Third person: over the
 * shoulder, the lens on the aim line behind the shoulder pivot, the arm shortened only by the cabin's shell.
 */
export function busRiderCamera(input: BusCamInput, out: TransitCameraPose = { x: 0, y: 0, z: 0, targetX: 0, targetY: 0, targetZ: 0, arm: 0, gap: 0, firstPerson: false }): TransitCameraPose {
  const { bus, ahead, right, floor, seated, yaw, elevation } = input;
  const headH = floor + (seated ? RIDER_HEAD_SEATED : RIDER_HEAD_STANDING);
  // the third person's measures are taken from the head's real centre
  const headC = floor + (seated ? RIDER_HEAD_CENTRE_SEATED : RIDER_HEAD_CENTRE_STANDING);
  const head: V3 = [ahead, right, headC];
  const firstPerson = input.dist < BUS_CAM.firstPersonDist;
  let eye: V3;
  let target: V3;
  if (firstPerson) {
    const { hA, hR, L } = aimOf(yaw, elevation);
    eye = [ahead + hA * 0.05, right + hR * 0.05, headH];
    target = [eye[0] + L[0] * 3, eye[1] + L[1] * 3, eye[2] + L[2] * 3];
  } else {
    const pitch = clampBusPitch(elevation);
    const { hA, hR, L } = aimOf(yaw, pitch);
    const min: V3 = [BUS_SHELL.aheadMin, -BUS_SHELL.right, Math.min(floor + BUS_TP.minOverFloor, BUS_SHELL.top)];
    const max: V3 = [BUS_SHELL.aheadMax, BUS_SHELL.right, BUS_SHELL.top];
    const clampIn = (v: number, k: number) => Math.max(min[k]!, Math.min(max[k]!, v));
    // the pivot: over the shoulder (the right of the look is (-hR, hA)), lifted a little, kept inside the shell
    const side = input.shoulder ?? 1;
    const pivot: V3 = [
      clampIn(head[0] - hR * BUS_TP.shoulder * side, 0),
      clampIn(head[1] + hA * BUS_TP.shoulder * side, 1),
      clampIn(head[2] + BUS_TP.lift, 2),
    ];
    const arm = busTpArm(input.dist, input.portrait);
    let want: V3 = [pivot[0] - L[0] * arm, pivot[1] - L[1] * arm, pivot[2] - L[2] * arm];
    const lid = pitch > 0 ? max[2] : min[2];
    if ((pitch > 1e-3 && want[2] > max[2]) || (pitch < -1e-3 && want[2] < min[2])) {
      // The ceiling is close over a standing head (0.6 m): a lens above the shoulder, cut short along its line, would sit at the head.
      // It slides back under the ceiling instead (the look stays the aim), as far as the arm — but not so far that a steep look
      // down leaves the rider above the picture (the head stays within BUS_TP.headInView of the look's middle). The same over the
      // lowest the lens may go, looking up.
      const p = Math.abs(pitch);
      const dzc = Math.abs(lid - pivot[2]);
      const hLine = dzc / Math.tan(p);
      const hFull = Math.sqrt(Math.max(0, arm * arm - dzc * dzc));
      const over = Math.abs(lid - headC);
      const hVis = p > BUS_TP.headInView ? over / Math.tan(p - BUS_TP.headInView) : Infinity;
      const hb = Math.max(hLine, Math.min(hFull, hVis));
      want = [pivot[0] - hA * hb, pivot[1] - hR * hb, lid];
    }
    const t = segmentBoxExit(pivot, want, min, max);
    eye = [pivot[0] + (want[0] - pivot[0]) * t, pivot[1] + (want[1] - pivot[1]) * t, pivot[2] + (want[2] - pivot[2]) * t];
    target = [eye[0] + L[0] * 3, eye[1] + L[1] * 3, eye[2] + L[2] * 3];
  }
  out.arm = firstPerson ? 0 : Math.hypot(eye[0] - head[0], eye[1] - head[1], eye[2] - head[2]);
  out.gap = firstPerson ? 0 : selfGap(eye[0], eye[2], eye[1], ahead, right, headC);
  out.firstPerson = firstPerson;
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

/**
 * Whether the own body is hidden this frame: first person, a third-person lens nearer than BUS_TP.hideAt to the head's centre
 * (kept hidden until showAt), or — whatever the distance — within 0.6 m of the head and body (selfGap.ts).
 */
export function busSelfHidden(wasHidden: boolean, pose: Pick<TransitCameraPose, "arm" | "gap" | "firstPerson">, portrait = false): boolean {
  if (pose.firstPerson) return true;
  const k = portrait ? BUS_TP.portraitHide : 1;
  const near = wasHidden ? pose.arm < BUS_TP.showAt * k : pose.arm < BUS_TP.hideAt * k;
  return near || stepSelfGapHidden(wasHidden, pose.gap);
}

/** The seat a rider sits on (index into BUS_SEATS) from `busSeat`, or -1. */
export function ownSeatIndex(busSeat: number): number {
  return busSeat >= 1 && busSeat <= BUS_SEATS.length ? busSeat - 1 : -1;
}
