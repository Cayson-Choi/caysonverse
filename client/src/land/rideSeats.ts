/**
 * Where a seated rider is, for any ride (the remote riders in RemotePlayer, the audio and the HUD): the pose of the avatar's root and its orientation,
 * on the shared wall clock. The first-person cameras are each ride's own (coasterRide.ts, carouselRide.ts).
 */
import { Euler, Quaternion, Vector3 } from "three";
import { SIT_POSE } from "@caysonverse/shared/sitPose";
import { RIDE } from "@caysonverse/shared/land/rides";
import { carouselSeatPose, type CarouselSeatPose } from "@caysonverse/shared/land/carousel";
import { villageClock } from "../village/villageClock";
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

/** The seat pose of `seat` on ride `rideId` now (the coaster's when `rideId` is 0: an older server). */
export function rideSeatPose(rideId: number, seat: number, outPos: Vector3, outQuat: Quaternion): void {
  if (rideId === RIDE.carousel) carouselRiderPose(seat, villageClock.liveMs(), outPos, outQuat);
  else carSeatPose(coasterNow().s, seat, outPos, outQuat);
}
