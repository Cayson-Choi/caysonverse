/**
 * The own rider of the 달빛 회전목마: first-person camera on the horse's saddle. The eye sits ~0.86 m over the saddle; the body faces the
 * direction of travel (clockwise tangent) so the world slowly wheels past on the left-hand side; the horse's bob lifts and lowers the eye
 * and tips it a little (its nose pitch). Free look is the first-person drag, relative to the horse. Comfort scales the sway.
 */
import { PerspectiveCamera } from "three";
import { carouselAt, carouselSeatPose, CAROUSEL_OMEGA_MAX, type CarouselSeatPose } from "@caysonverse/shared/land/carousel";
import { villageClock } from "../village/villageClock";
import { rideComfort, selfRide } from "./coasterRide";

const P: CarouselSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, pitch: 0, theta: 0, ring: 0 };
const EYE_UP = 1.02;
let yawSm = 0;
let init = false;

export const carouselProbe = { active: false, omega: 0, eye: [0, 0, 0] as [number, number, number], bob: 0 };

export function resetCarouselCamera(): void {
  init = false;
  carouselProbe.active = false;
}

export function stepCarouselCamera(camera: PerspectiveCamera, dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const wall = villageClock.liveMs();
  const st = carouselAt(wall);
  carouselSeatPose(Math.max(0, selfRide.slot), wall, P);
  const k = rideComfort() === 0 ? 0 : rideComfort() === 1 ? 0.5 : 1;
  const heading = Math.atan2(-P.fx, -P.fz); // yaw (three: -Z is forward at yaw 0)
  // the body turns with the carousel; a short lag so the start of the turn eases in
  if (!init) {
    yawSm = heading;
    init = true;
  } else {
    let d = heading - yawSm;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    yawSm += d * (1 - Math.exp(-dt * 20));
  }
  const sway = Math.sin(st.rideT * 1.7) * 0.004 * k * (st.omega / CAROUSEL_OMEGA_MAX);
  // the rider leans a little back from the pole and to the outside of it, so the brass pole stands beside the view, not across it
  const ox = -P.fx * 0.42 + Math.sin(P.theta) * 0.24;
  const oz = -P.fz * 0.42 - Math.cos(P.theta) * 0.24;
  camera.position.set(P.x + ox, P.y + EYE_UP, P.z + oz);
  camera.rotation.order = "YXZ";
  camera.rotation.set(-lookPitch + P.pitch * 0.6 * k, yawSm + Math.max(-1.9, Math.min(1.9, lookYaw)), sway);
  camera.up.set(0, 1, 0);
  if (Math.abs(camera.fov - baseFov) > 1e-3) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  carouselProbe.active = true;
  carouselProbe.omega = st.omega;
  carouselProbe.bob = P.y;
  carouselProbe.eye[0] = P.x;
  carouselProbe.eye[1] = P.y + EYE_UP;
  carouselProbe.eye[2] = P.z;
}
