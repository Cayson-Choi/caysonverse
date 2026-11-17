/**
 * The own rider of the 하늘 등불 바퀴: first-person camera inside the gondola. The eye sits 0.86 m over the cushion; the rider faces SOUTH, out of the
 * wheel's plane (the rim trusses are behind). The cabin hangs from its pivot and swings with the wheel's acceleration (a few degrees of roll), so the
 * horizon tips a little as the wheel starts and stops. Free look is the first-person drag. Comfort scales the swing.
 */
import { PerspectiveCamera } from "three";
import { wheelAt, wheelSeatPose, type WheelSeatPose, type WheelState } from "@caysonverse/shared/land/wheel";
import { villageClock } from "../village/villageClock";
import { rideComfort, selfRide } from "./coasterRide";

const P: WheelSeatPose = { x: 0, y: 0, z: 0, fx: 0, fz: 1, sway: 0, gondola: 0, pivotX: 0, pivotY: 0 };
const EYE_UP = 0.86;
const ST: WheelState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, departsInMs: 0 };

export const wheelProbe = { active: false, altitude: 0, omega: 0, eye: [0, 0, 0] as [number, number, number], sway: 0 };

export function resetWheelCamera(): void {
  wheelProbe.active = false;
}

export function stepWheelCamera(camera: PerspectiveCamera, _dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const wall = villageClock.liveMs();
  const st = wheelAt(wall, ST);
  wheelSeatPose(Math.max(0, selfRide.slot), wall, P);
  const k = rideComfort() === 0 ? 0 : rideComfort() === 1 ? 0.5 : 1;
  const c = Math.cos(P.sway);
  const s = Math.sin(P.sway);
  // the eye is "up" in the cabin's frame: tipped with the swing
  const ex = P.x - EYE_UP * s;
  const ey = P.y + EYE_UP * c;
  camera.position.set(ex, ey, P.z);
  const heading = Math.atan2(-P.fx, -P.fz);
  // the rider looks south, along +z: a swing about the world z axis is a ROLL of the view (about its own axis, the opposite way round)
  const roll = -P.sway * k;
  const micro = st.status === "riding" ? Math.sin(wall / 1300) * 0.003 * k : 0;
  camera.rotation.order = "YXZ";
  camera.rotation.set(-lookPitch + micro, heading + Math.max(-1.9, Math.min(1.9, lookYaw)), roll);
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
