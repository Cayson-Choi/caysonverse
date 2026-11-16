import { BUS_SEATS, BUS_CEILING } from "@caysonverse/shared/village/busCabin";
import type { TransitPose } from "@caysonverse/shared/village/transit";

/**
 * The rider's camera inside the village bus (owner 2026-11-15: "버스 안에서 캐릭터는 창문의 왼쪽 오른쪽을 다 볼 수 있어야
 * 해"). The old fixed over-the-shoulder shot (one window side only) is gone: inside the bus the camera is the village's
 * third-person orbit, tied to the bus's frame — it turns with the bus, so "front" stays the front through the ring road's
 * curve. Drag (mouse / one finger) turns it round the rider, the wheel / pinch pulls it in (all the way in is first person),
 * and the panel's quick views (BUS_VIEW_YAW) ease it to the left windows, the front, the right windows or the back.
 *
 * Pure (unit-tested): `busRiderCamera` places the eye in the bus's own frame (ahead / right / up) and the spring arm keeps
 * it inside the cabin's shell (its walls and ceiling: owner 2026-11-16, only walls shorten the arm; the seats and poles do not, and
 * nothing is drawn see-through). Bus v3 (2026-11-16): no poles, rails or straps any more, so nothing in the cabin needs fading.
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
export const BUS_SHELL = { aheadMin: -3.95, aheadMax: 3.95, right: 0.945, top: BUS_CEILING - 0.25 } as const;

/** The third person's lens never looks at a wall nearer than this along its middle ray (m): a lens pressed to a door leaf or a window frame fills the screen with it (review 2026-11-16, round 4). */
export const TP_WALL_LOOK_M = 1.6;
/** The cabin's inner half width (m): the walls the third person's lens must not look into. */
const CABIN_HALF = 1.195;

type V3 = readonly [number, number, number];

/** The head's height over the floor the rider stands or sits on (m): the avatar's head centre (chibi, 2.18 m to the top). */
export const RIDER_HEAD_STANDING = 1.95;
export const RIDER_HEAD_SEATED = 1.62;

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
/** The share of the rider's own sideways offset the third person's lens keeps (0 = in the aisle's middle). */
export const TP_AISLE_KEEP = 0.2;

/**
 * The eye and the point it looks at, in the world. The wanted eye is the rider's head plus the arm in the camera's azimuth
 * and elevation; the arm is shortened only to stop inside the shell (the cabin's walls and ceiling).
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
    // bus v3: the seats are bigger, a lens nearer than the third person's least arm filled the screen with the seated rider
    const d = input.frame ? Math.max(input.dist, BUS_TP_MIN_ARM) : input.dist;
    // With a lens (frame) the camera stays on the AISLE line (in front of the rider or behind them, whichever the view yaw is nearer), raised
    // and as far as the cabin allows: the cabin is as narrow as an avatar is tall, so the old orbit round the rider pressed the lens against a
    // window and the rider's head filled the screen. The view yaw then only turns where the lens LOOKS (a side view looks at the windows, the
    // rider at the edge of the picture or out of it).
    const el = input.frame ? Math.max(TP_ELEVATION, Math.min(0.8, elevation)) : elevation;
    const posA = input.frame ? (dirA >= 0 ? 1 : -1) : dirA;
    const posR = input.frame ? 0 : dirR;
    const min: V3 = [BUS_SHELL.aheadMin, -BUS_SHELL.right, Math.max(floor + EYE_SHELL_MIN_H, 0.6)];
    const max: V3 = [BUS_SHELL.aheadMax, BUS_SHELL.right, BUS_SHELL.top];
    const inside = (p: V3) => p[0] >= min[0] && p[0] <= max[0] && p[1] >= min[1] && p[1] <= max[1] && p[2] >= min[2] && p[2] <= max[2];
    const eyeFor = (pa: number, pr: number): V3 => {
      // a standing head near the ceiling may reach the shell's top: the lens then starts from the top and looks down from there
      const o: V3 = [head[0], head[1], Math.min(head[2], max[2])];
      const elE = d > 1e-6 ? Math.min(el, Math.asin(Math.max(-1, Math.min(1, (max[2] - o[2]) / d)))) : el; // not above the ceiling
      // the lens drifts to the aisle's middle as it backs off (a rider at the wall would otherwise be looked at from a hand's breadth off the wall)
      const wantR = input.frame ? o[1] * TP_AISLE_KEEP : o[1] + pr * Math.cos(elE) * d;
      const want: V3 = [o[0] + pa * Math.cos(elE) * d, wantR, o[2] + Math.sin(elE) * d];
      // 1) the shell: inside its box; if the wanted eye is outside, stop where the arm leaves it
      let t = 1;
      if (inside(o)) {
        if (!inside(want)) t = Math.min(t, segmentBoxExit(o, want, min, max));
      } else {
        t = 0; // a head outside the shell (the stairs, a stale pose): no arm
      }
      // the seats are props: they never shorten the arm (owner 2026-11-16: only buildings and walls do)
      t = Math.max(0, Math.min(1, t));
      return [o[0] + (want[0] - o[0]) * t, o[1] + (want[1] - o[1]) * t, o[2] + (want[2] - o[2]) * t];
    };
    const armOf = (e: V3) => Math.hypot(e[0] - head[0], e[1] - head[1], e[2] - head[2]);
    eye = eyeFor(posA, posR);
    // bus v3: a side view (looking out of the windows, the yaw across the bus) has no "front" or "back" of its own: the lens takes
    // the side of the aisle with the longer arm (the bigger seats put a wall-seat rider too close on the shorter side)
    if (input.frame && Math.abs(dirA) < 0.5) {
      const other = eyeFor(-posA, 0);
      if (armOf(other) > armOf(eye) + 0.05) eye = other;
    } else if (input.frame && armOf(eye) < TP_FLIP_ARM) {
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
      let lookAz = azView - thetaX; // the lens turns left: the rider moves right on the screen
      {
        // a wall nearer than TP_WALL_LOOK_M along the middle ray: turn the look towards the aisle's axis until it is not
        const sv = Math.sin(lookAz);
        const wallDist = sv >= 0 ? CABIN_HALF - eye[1] : CABIN_HALF + eye[1];
        if (Math.abs(sv) > 1e-6 && wallDist / Math.abs(sv) < TP_WALL_LOOK_M) {
          const s2 = Math.min(1, Math.max(0.05, wallDist / TP_WALL_LOOK_M));
          lookAz = Math.atan2((sv >= 0 ? 1 : -1) * s2, (Math.cos(lookAz) >= 0 ? 1 : -1) * Math.sqrt(1 - s2 * s2));
        }
      }
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

/** The seat a rider sits on (index into BUS_SEATS) from `busSeat`, or -1 (a backed seat's own back is no wall for the camera). */
export function ownSeatIndex(busSeat: number): number {
  return busSeat >= 1 && busSeat <= BUS_SEATS.length ? busSeat - 1 : -1;
}
