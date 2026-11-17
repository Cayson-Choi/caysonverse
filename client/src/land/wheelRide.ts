/**
 * The own rider of the 하늘 등불 바퀴: first-person camera inside the gondola. The eye sits 0.76 m over the cushion; the body faces east or west (its bench);
 * the cabin hangs from its pivot and swings with the wheel's acceleration (the pitch of the view follows the swing, a few degrees), so the world
 * slides and tips a little as the wheel starts and stops. Free look is the first-person drag, relative to the bench. Comfort scales the swing.
 */
import { PerspectiveCamera } from "three";
import { wheelAt, wheelSeatPose, type WheelSeatPose } from "@caysonverse/shared/land/wheel";
import { villageClock } from "../village/villageClock";
import { rideComfort, selfRide } from "./coasterRide";

const P: WheelSeatPose = { x: 0, y: 0, z: 0, fx: 1, fz: 0, sway: 0, gondola: 0, pivotX: 0, pivotY: 0 };
const EYE_UP = 0.86;

export const wheelProbe = { active: false, altitude: 0, omega: 0, eye: [0, 0, 0] as [number, number, number], sway: 0 };

export function resetWheelCamera(): void {
  wheelProbe.active = false;
}

export function stepWheelCamera(camera: PerspectiveCamera, _dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const wall = villageClock.liveMs();
  const st = wheelAt(wall);
  wheelSeatPose(Math.max(0, selfRide.slot), wall, P);
  const k = rideComfort() === 0 ? 0 : rideComfort() === 1 ? 0.5 : 1;
  const c = Math.cos(P.sway);
  const s = Math.sin(P.sway);
  // the eye is "up" in the cabin's frame: tipped with the swing
  const ex = P.x - EYE_UP * s;
  const ey = P.y + EYE_UP * c;
  camera.position.set(ex, ey, P.z);
  const heading = Math.atan2(-P.fx, -P.fz);
  // a swing about z tips the view's pitch by sway * fx (east: nose up with a positive swing)
  const tip = P.sway * P.fx * k;
  const micro = st.status === "riding" ? Math.sin(wall / 1300) * 0.004 * k : 0;
  camera.rotation.order = "YXZ";
  camera.rotation.set(-lookPitch + tip + micro, heading + Math.max(-1.9, Math.min(1.9, lookYaw)), 0);
  camera.up.set(0, 1, 0);
  if (Math.abs(camera.fov - baseFov) > 1e-3) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  wheelProbe.active = true;
  wheelProbe.altitude = P.y;
  wheelProbe.omega = st.omega;
  wheelProbe.sway = P.sway;
  wheelProbe.eye[0] = ex;
  wheelProbe.eye[1] = ey;
  wheelProbe.eye[2] = P.z;
}
