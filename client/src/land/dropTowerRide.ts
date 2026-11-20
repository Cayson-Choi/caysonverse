/**
 * The own rider of the 구름 낙하탑: first-person camera on the seat, facing OUT over the park. The eye sits 0.8 m over the hips; free look is the first-person
 * drag, relative to the seat. What the ride feels like comes from the clock's motion (shared/src/land/dropTower.ts): the slow lift just rises over the park
 * (a little car sway), the hold at 85 m is a still pause with a light wobble, the free fall is weightless (the view lifts a hair off the seat, the field of
 * view opens with the speed, a fine wind tremble), the magnetic brakes press you into the seat (the eye sinks, the view dips) and ease off. Comfort scales
 * every effect (low: none but the motion itself). Nothing is allocated per frame.
 */
import { PerspectiveCamera } from "three";
import { DROP_FALL_V, dropAt, dropGLoad, dropSeatPose, type DropSeatPose, type DropState } from "@caysonverse/shared/land/dropTower";
import { rideMs } from "./rideClock";
import { rideComfort, selfRide } from "./coasterRide";

const P: DropSeatPose = { x: 0, y: 0, z: 0, fx: 1, fz: 0, face: 0, vy: 0, gload: 1, stage: "idle" };
const ST: DropState = { cycle: 0, phase: 0, status: "boarding", stage: "idle", y: 0, v: 0, a: 0, rideT: 0, departsInMs: 0 };
const EYE_UP = 0.8;

export const dropProbe = { active: false, y: 0, v: 0, gload: 1, stage: "idle", eye: [0, 0, 0] as [number, number, number], fovExtra: 0, sink: 0 };

export function resetDropCamera(): void {
  dropProbe.active = false;
}

export function stepDropCamera(camera: PerspectiveCamera, _dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const wall = rideMs();
  const st = dropAt(wall, ST);
  dropSeatPose(Math.max(0, selfRide.slot), wall, P);
  const k = rideComfort() === 0 ? 0 : rideComfort() === 1 ? 0.5 : 1;
  const g = dropGLoad(st);
  const speed = Math.min(1, Math.abs(st.v) / DROP_FALL_V);
  // weightless (g under 1): the eye lifts off the cushion; heavy (g over 1): it sinks into it
  const sink = (g - 1) * 0.07 * k;
  const t = wall / 1000;
  const tremble = st.stage === "fall" ? Math.sin(t * 61) * 0.0025 * speed * k : 0;
  const sway = st.stage === "hold" ? Math.sin(t * 1.3) * 0.006 * k : st.stage === "lift" ? Math.sin(t * 0.9) * 0.003 * k : 0;
  const ex = P.x + P.fx * 0.12;
  const ey = P.y + EYE_UP - sink;
  const ez = P.z + P.fz * 0.12;
  camera.position.set(ex, ey, ez);
  const heading = Math.atan2(-P.fx, -P.fz);
  camera.rotation.order = "YXZ";
  // the brakes dip the view a touch; the fall keeps it level (looking out and a little down at the park)
  const dip = st.stage === "brake" ? -0.035 * k * Math.min(1, g - 1) : 0;
  camera.rotation.set(-lookPitch + dip + tremble, heading + Math.max(-1.9, Math.min(1.9, lookYaw)), sway);
  camera.up.set(0, 1, 0);
  const fov = baseFov + 9 * speed * k * (st.stage === "fall" ? 1 : 0.4);
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = fov;
    camera.updateProjectionMatrix();
  }
  dropProbe.active = true;
  dropProbe.y = P.y;
  dropProbe.v = st.v;
  dropProbe.gload = g;
  dropProbe.stage = st.stage;
  dropProbe.fovExtra = fov - baseFov;
  dropProbe.sink = sink;
  dropProbe.eye[0] = ex;
  dropProbe.eye[1] = ey;
  dropProbe.eye[2] = ez;
}
