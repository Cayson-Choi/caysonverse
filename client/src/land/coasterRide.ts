/**
 * The own rider of the 별똥별 급행: the shared ride state (module state, read per frame without React) and the first-person camera.
 *
 * What makes it feel like a real ride (design docs/designs/caysonland/DESIGN.md §6):
 *  - the camera is the head: the eye sits where a rider's eyes are over the seat, and the frame is the CAR's frame (so the track
 *    ahead, the lap bar and the car's nose are in front of you, and the horizon tilts and pitches with the track);
 *  - the head lags: the car's orientation reaches the camera through a damped spring (~60 ms), and the head is pushed by the G
 *    forces (pulled down in the pull-out and loop, up in the airtime, swung outward in a banked turn), a few centimetres and a few
 *    degrees, through its own spring;
 *  - the lens opens with speed and with the drop (FOV kick), and a fine rumble that grows with speed rides on the rails;
 *  - looking round is free (drag / the touch look): the head turns on the neck, up to 110 degrees each way.
 * A comfort setting scales every one of those effects (off / gentle / full); the car's own tilt (the horizon) is kept at "gentle".
 */
import { Matrix4, PerspectiveCamera, Quaternion, Vector3 } from "three";
import { SIT_POSE } from "@caysonverse/shared/sitPose";
import {
  EYE_ABOVE_SEAT,
  SEAT_HALF_GAP,
  SEAT_TOP,
  COASTER_DWELL_MS,
  carArc,
  coasterAt,
  coasterTrack,
  emptyFrame,
  frameAt,
  rideGForce,
  seatCar,
  speedAt,
  type CarFrame,
  type CoasterState,
} from "@caysonverse/shared/land/coaster";
import { villageClock } from "../village/villageClock";
import { COASTER_SITE } from "./site";

/** My standing place (the scene copies the live pose here every frame: the HUD column has no pose of its own). */
export const landPose = { x: 0, z: 0 };

/** Which seat I sit in (the server's `Player.rideSeat` for me), -1 = not riding. */
export const selfRide = { slot: -1, ride: 0 };

/** Why the last boarding was refused, and when (for the HUD). */
export const rideNotice: { reason: "closed" | "full" | "busy" | "aloft" | "reserved" | "far" | null; at: number } = { reason: null, at: 0 };

/** The ride I reserved a seat in (pressed "board" outside its window: the server seats me when it next loads), and when. */
export const rideReserved: { key: "coaster" | "carousel" | "wheel" | "moonboat" | null; at: number } = { key: null, at: 0 };

export type RideComfort = 0 | 1 | 2; // 0 = off (steady camera), 1 = gentle, 2 = full
const COMFORT_KEY = "cv.rideComfort";
let comfort: RideComfort = 2;
try {
  const v = typeof window !== "undefined" ? window.localStorage.getItem(COMFORT_KEY) : null;
  if (v === "0" || v === "1" || v === "2") comfort = Number(v) as RideComfort;
} catch {
  /* private window: the default */
}
const comfortListeners = new Set<() => void>();
export function rideComfort(): RideComfort {
  return comfort;
}
export function setRideComfort(next: RideComfort): void {
  comfort = next;
  try {
    window.localStorage.setItem(COMFORT_KEY, String(next));
  } catch {
    /* ignore */
  }
  for (const l of [...comfortListeners]) l();
}
export function subscribeRideComfort(l: () => void): () => void {
  comfortListeners.add(l);
  return () => comfortListeners.delete(l);
}

/** The train's state now, on the village clock (the clock the server sends; the same one everyone's train runs on). */
const stateNow: CoasterState = { cycle: 0, phase: 0, status: "boarding", s: 0, departsInMs: 0 };
export function coasterNow(): CoasterState {
  return coasterAt(villageClock.liveMs(), stateNow);
}

/** What the camera did last frame (read by the HUD, the audio and the e2e). */
export const rideProbe = {
  active: false,
  s: 0,
  speed: 0,
  lat: 0,
  vert: 1,
  long: 0,
  fovAdd: 0,
  roll: 0,
  pitch: 0,
  eye: [0, 0, 0] as [number, number, number],
  /** the car's own tilt (rad) from level, for the e2e */
  carPitch: 0,
  carRoll: 0,
  status: "boarding" as string,
  /** seconds into the ride (0 while loading) */
  rideT: 0,
};

const track = coasterTrack();
const F = emptyFrame();
const g = { lat: 0, vert: 1, long: 0 };
const mBasis = new Matrix4();
const qCar = new Quaternion();
const qSmooth = new Quaternion();
const qLook = new Quaternion();
const qTmp = new Quaternion();
const vYaw = new Vector3(0, 1, 0);
const vRight = new Vector3(1, 0, 0);
const vFwd = new Vector3(0, 0, 1);
const vEye = new Vector3();
const vR = new Vector3();
const vU = new Vector3();
const vT = new Vector3();

/** Head spring state in the car's frame (m): x right, y up, z forward. */
const head = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, pitch: 0, vpitch: 0, roll: 0, vroll: 0 };
const smooth = { init: false, fov: 0, shakeT: 0 };

/** Seats: which side (-1 left, +1 right). */
export function seatSide(seat: number): number {
  return seatCar(seat).side === 0 ? -1 : 1;
}

/** The world position of the rider's eye, un-smoothed, and the car frame it hangs on (the remote riders and the camera). */
export function carEyeWorld(headS: number, seat: number, outEye: { x: number; y: number; z: number }, outFrame: CarFrame = F): CarFrame {
  const { car } = seatCar(seat);
  const f = frameAt(track, carArc(headS, car), outFrame);
  const side = seatSide(seat);
  const up = SEAT_TOP + EYE_ABOVE_SEAT;
  const lat = side * SEAT_HALF_GAP;
  outEye.x = f.x + f.ux * up + f.rx * lat + f.tx * 0.02 + COASTER_SITE.x;
  outEye.y = f.y + f.uy * up + f.ry * lat + f.ty * 0.02;
  outEye.z = f.z + f.uz * up + f.rz * lat + f.tz * 0.02 + COASTER_SITE.z;
  return outFrame;
}

/** Reset the springs (boarding / leaving). */
export function resetRideCamera(): void {
  smooth.init = false;
  head.x = head.y = head.z = head.vx = head.vy = head.vz = 0;
  head.pitch = head.vpitch = head.roll = head.vroll = 0;
  smooth.fov = 0;
  rideProbe.active = false;
}

function spring(x: number, v: number, target: number, dt: number, omega: number, zeta: number): [number, number] {
  // A 100 ms frame destabilizes the head spring. Use smaller integration steps on slow frames.
  const steps = Math.max(1, Math.ceil(dt * 30));
  const h = dt / steps;
  for (let i = 0; i < steps; i++) {
    v += (-2 * zeta * omega * v - omega * omega * (x - target)) * h;
    x += v * h;
  }
  return [x, v];
}

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
};

/**
 * Put `camera` at my seat's eye for this frame (call it from the camera rig after everything else, while `selfRide.slot >= 0`).
 * `lookYaw` is the free look to the LEFT (rad, 0 = straight ahead), `lookPitch` the look DOWN.
 */
export function stepRideCamera(camera: PerspectiveCamera, dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const now = coasterNow();
  const k = comfort === 0 ? 0 : comfort === 1 ? 0.5 : 1;
  const seat = Math.max(0, selfRide.slot);
  const { car } = seatCar(seat);
  const headS = now.s;
  const sCar = carArc(headS, car);
  const v = now.status === "riding" ? speedAt(track, headS) : 0;
  const riding = now.status === "riding";
  if (riding) rideGForce(track, sCar, g);
  else {
    g.lat = 0;
    g.vert = 1;
    g.long = 0;
  }
  const f = frameAt(track, sCar, F);
  vR.set(f.rx, f.ry, f.rz);
  vU.set(f.ux, f.uy, f.uz);
  vT.set(f.tx, f.ty, f.tz);
  // the camera's basis: x right, y up, z backward (= -T)
  mBasis.makeBasis(vR, vU, vT.clone().negate());
  qCar.setFromRotationMatrix(mBasis);
  if (!smooth.init) {
    qSmooth.copy(qCar);
    smooth.init = true;
  } else {
    // the head follows the car's rotation through a short lag (~60 ms): a fast change of the car's tilt reaches the view a little late
    const lag = k === 0 ? 1 : 1 - Math.exp(-dt * (comfort === 1 ? 22 : 15));
    qSmooth.slerp(qCar, lag);
  }

  // the head's spring: pushed by the G forces (clamped), in the car frame
  const gv = Math.max(-1.2, Math.min(4.5, g.vert)) - 1; // 0 at rest
  const tx = -g.lat * 0.045 * k;
  const ty = -gv * 0.03 * k;
  const tz = -g.long * 0.05 * k;
  [head.x, head.vx] = spring(head.x, head.vx, tx, dt, 14, 0.55);
  [head.y, head.vy] = spring(head.y, head.vy, ty, dt, 14, 0.55);
  [head.z, head.vz] = spring(head.z, head.vz, tz, dt, 14, 0.55);
  // and tilts: the head leans into the turn's force, drops its chin in a pull-out, tips back in a launch
  const tRoll = -g.lat * 0.06 * k;
  const tPitch = -gv * 0.012 * k + g.long * 0.03 * k;
  [head.roll, head.vroll] = spring(head.roll, head.vroll, tRoll, dt, 12, 0.6);
  [head.pitch, head.vpitch] = spring(head.pitch, head.vpitch, tPitch, dt, 12, 0.6);

  // rumble: a fine, speed-scaled shake that is the track's joints (no shake standing in the station)
  smooth.shakeT += dt * (6 + v * 1.1);
  const sh = riding ? Math.min(1, v / 20) * k : 0;
  const shx = (hash(Math.floor(smooth.shakeT) + 1) - 0.5) * 0.006 * sh;
  const shy = (hash(Math.floor(smooth.shakeT) + 7.3) - 0.5) * 0.008 * sh;
  const shr = (hash(Math.floor(smooth.shakeT) + 3.1) - 0.5) * 0.0035 * sh;

  // the eye (world): the seat's eye over the car's frame + the head's sway
  const side = seatSide(seat);
  const upH = SEAT_TOP + EYE_ABOVE_SEAT;
  const lat = side * SEAT_HALF_GAP + head.x + shx;
  const upv = upH + head.y + shy;
  const fw = 0.02 + head.z;
  vEye.set(f.x + f.ux * upv + f.rx * lat + f.tx * fw + COASTER_SITE.x, f.y + f.uy * upv + f.ry * lat + f.ty * fw, f.z + f.uz * upv + f.rz * lat + f.tz * fw + COASTER_SITE.z);
  camera.position.copy(vEye);

  // orientation: the lagged car frame x the neck's look x the head's lean
  qLook.copy(qSmooth);
  qTmp.setFromAxisAngle(vYaw, Math.max(-1.9, Math.min(1.9, lookYaw)));
  qLook.multiply(qTmp);
  qTmp.setFromAxisAngle(vRight, -Math.max(-1.2, Math.min(1.2, lookPitch)) - head.pitch);
  qLook.multiply(qTmp);
  qTmp.setFromAxisAngle(vFwd, head.roll + shr);
  qLook.multiply(qTmp);
  camera.quaternion.copy(qLook);
  camera.up.set(0, 1, 0);

  // the lens: opens with the speed and the steepness of the way down
  const downhill = Math.max(0, -f.ty);
  const fovTarget = (Math.min(1, v / 26) * 5 + downhill * 5) * k;
  smooth.fov += (fovTarget - smooth.fov) * (1 - Math.exp(-dt * 3.2));
  const wantFov = baseFov + smooth.fov;
  if (Math.abs(camera.fov - wantFov) > 1e-3) {
    camera.fov = wantFov;
    camera.updateProjectionMatrix();
  }

  rideProbe.active = true;
  rideProbe.s = headS;
  rideProbe.speed = v;
  rideProbe.lat = g.lat;
  rideProbe.vert = g.vert;
  rideProbe.long = g.long;
  rideProbe.fovAdd = smooth.fov;
  rideProbe.roll = head.roll;
  rideProbe.pitch = head.pitch;
  rideProbe.eye[0] = vEye.x;
  rideProbe.eye[1] = vEye.y;
  rideProbe.eye[2] = vEye.z;
  rideProbe.carPitch = Math.asin(Math.max(-1, Math.min(1, f.ty)));
  rideProbe.carRoll = Math.atan2(f.ry, f.uy);
  rideProbe.status = now.status;
  rideProbe.rideT = riding ? (now.phase - COASTER_DWELL_MS) / 1000 : 0;
}

const mSeat = new Matrix4();
const vSeatL = new Vector3();
const vSeatU = new Vector3();
const vSeatT = new Vector3();

/**
 * Where a SEATED avatar's root goes for seat `seat` with the train's head at `headS`, in world metres, and how it is turned (a remote
 * rider; the Sit_Chair_Idle pose): the hips on the cushion, the body tilting with the car.
 */
export function carSeatPose(headS: number, seat: number, outPos: Vector3, outQuat: Quaternion): void {
  const { car } = seatCar(seat);
  const f = frameAt(track, carArc(headS, car), F);
  const side = seatSide(seat);
  // the cushion's middle is 0.2 m behind the car's centre; the root is 0.397 m ahead of the hips
  const fwd = -0.2 + SIT_POSE.hipsBehindRoot;
  const up = SEAT_TOP - SIT_POSE.contactY;
  const lat = side * SEAT_HALF_GAP;
  outPos.set(f.x + f.ux * up + f.rx * lat + f.tx * fwd + COASTER_SITE.x, f.y + f.uy * up + f.ry * lat + f.ty * fwd, f.z + f.uz * up + f.rz * lat + f.tz * fwd + COASTER_SITE.z);
  vSeatL.set(-f.rx, -f.ry, -f.rz);
  vSeatU.set(f.ux, f.uy, f.uz);
  vSeatT.set(f.tx, f.ty, f.tz);
  mSeat.makeBasis(vSeatL, vSeatU, vSeatT);
  outQuat.setFromRotationMatrix(mSeat);
}
