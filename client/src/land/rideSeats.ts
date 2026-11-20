/**
 * Where a seated rider is, for any ride (the remote riders in RemotePlayer, the audio and the HUD): the pose of the avatar's root and its orientation,
 * on the shared wall clock. The first-person cameras are each ride's own (coasterRide.ts, carouselRide.ts).
 */
import { Euler, Quaternion, Vector3 } from "three";
import { SIT_POSE } from "@caysonverse/shared/sitPose";
import { RIDE } from "@caysonverse/shared/land/rides";
import { carouselSeatPose, type CarouselSeatPose } from "@caysonverse/shared/land/carousel";
import { wheelSeatPose, type WheelSeatPose } from "@caysonverse/shared/land/wheel";
import { moonSeatPose, type MoonSeatPose } from "@caysonverse/shared/land/moonBoat";
import { dropSeatPose, type DropSeatPose } from "@caysonverse/shared/land/dropTower";
import { rideMs } from "./rideClock";
import { carSeatPose, coasterNow } from "./coasterRide";

const cp: CarouselSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, pitch: 0, theta: 0, ring: 0 };
const eul = new Euler(0, 0, 0, "YXZ");

/** The carousel seat's avatar pose: the hips on the saddle (root 0.397 m ahead of them), the body facing the way it travels, tilting with the horse. */
export function carouselRiderPose(seat: number, nowMs: number, outPos: Vector3, outQuat: Quaternion): CarouselSeatPose {
  carouselSeatPose(seat, nowMs, cp);
  outPos.set(cp.x + cp.fx * SIT_POSE.hipsBehindRoot, cp.y - SIT_POSE.contactY, cp.z + cp.fz * SIT_POSE.hipsBehindRoot);
  eul.set(-cp.pitch, Math.atan2(cp.fx, cp.fz), 0, "YXZ");
  outQuat.setFromEuler(eul);
  return cp;
}

const wp: WheelSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, sway: 0, gondola: 0, pivotX: 0, pivotY: 0 };
const eulW = new Euler(0, 0, 0, "YXZ");
const qz = new Quaternion();
const axZ = new Vector3(0, 0, 1);

/** The wheel seat's avatar pose: seated on the cushion, facing east or west, tipping with the cabin's swing. */
export function wheelRiderPose(seat: number, nowMs: number, outPos: Vector3, outQuat: Quaternion): void {
  wheelSeatPose(seat, nowMs, wp);
  outPos.set(wp.x, wp.y - SIT_POSE.contactY, wp.z + wp.fz * SIT_POSE.hipsBehindRoot);
  eulW.set(0, Math.atan2(wp.fx, wp.fz), 0, "YXZ");
  outQuat.setFromEuler(eulW);
  qz.setFromAxisAngle(axZ, wp.sway);
  outQuat.premultiply(qz);
}

const mp: MoonSeatPose = { x: 0, y: 0, z: 0, fy: 0, fz: 1, uy: 1, uz: 0, angle: 0, gload: 1, face: 1 };
const axX = new Vector3(1, 0, 0);
const qFlip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

/** The moon boat seat's avatar pose: seated on the cushion facing the middle of the boat (toward the stern in the bow half), pitched with the hull (the boat swings along z: a turn about x). */
export function moonBoatRiderPose(seat: number, nowMs: number, outPos: Vector3, outQuat: Quaternion): void {
  moonSeatPose(seat, nowMs, mp);
  outPos.set(mp.x, mp.y - SIT_POSE.contactY * mp.uy + mp.fy * SIT_POSE.hipsBehindRoot, mp.z - SIT_POSE.contactY * mp.uz + mp.fz * SIT_POSE.hipsBehindRoot);
  outQuat.setFromAxisAngle(axX, -mp.angle);
  // the avatar faces +z (the bow) by default; the bow half sits facing the stern (toward the middle)
  if (mp.face < 0) outQuat.multiply(qFlip);
}

const dp: DropSeatPose = { x: 0, y: 0, z: 0, fx: 1, fz: 0, face: 0, vy: 0, gload: 1, stage: "idle" };

/** The drop tower seat's avatar pose: hips on the cushion (root 0.397 m ahead of them), facing out over the park, legs dangling. */
export function dropRiderPose(seat: number, nowMs: number, outPos: Vector3, outQuat: Quaternion): void {
  dropSeatPose(seat, nowMs, dp);
  outPos.set(dp.x + dp.fx * SIT_POSE.hipsBehindRoot, dp.y - SIT_POSE.contactY, dp.z + dp.fz * SIT_POSE.hipsBehindRoot);
  eul.set(0, Math.atan2(dp.fx, dp.fz), 0, "YXZ");
  outQuat.setFromEuler(eul);
}

/** The seat pose of `seat` on ride `rideId` now (the coaster's when `rideId` is 0: an older server). */
export function rideSeatPose(rideId: number, seat: number, outPos: Vector3, outQuat: Quaternion): void {
  if (rideId === RIDE.carousel) carouselRiderPose(seat, rideMs(), outPos, outQuat);
  else if (rideId === RIDE.wheel) wheelRiderPose(seat, rideMs(), outPos, outQuat);
  else if (rideId === RIDE.moonboat) moonBoatRiderPose(seat, rideMs(), outPos, outQuat);
  else if (rideId === RIDE.droptower) dropRiderPose(seat, rideMs(), outPos, outQuat);
  else carSeatPose(coasterNow().s, seat, outPos, outQuat);
}
