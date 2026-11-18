/**
 * The own rider of the 달배: first-person camera on the cushion, facing the bow. The eye sits over the cushion and is carried by the hull: it swings
 * along the arc and pitches with the boat (nose up while the boat climbs the bow side, down on the way back), so the horizon tips +-55 degrees at the
 * turning points. At the top the seat barely presses (about 0.57 g): the eye floats up a little and the view hangs still for a moment. Comfort scales
 * the pitch (low: the view stays level and only the eye moves; medium: half). Free look is the first-person drag. Nothing is allocated per frame.
 */
import { PerspectiveCamera } from "three";
import { MOON_MAX_ANGLE, MOON_SEAT, moonBoatAt, moonGLoad, moonSeatPose, type MoonBoatState, type MoonSeatPose } from "@caysonverse/shared/land/moonBoat";
import { villageClock } from "../village/villageClock";
import { rideComfort, selfRide } from "./coasterRide";

const P: MoonSeatPose = { x: 0, y: 0, z: 0, fy: 0, fz: 1, uy: 1, uz: 0, angle: 0, gload: 1 };
const ST: MoonBoatState = { cycle: 0, phase: 0, status: "boarding", angle: 0, omega: 0, alpha: 0, rideT: 0, departsInMs: 0 };

export const moonBoatProbe = { active: false, angle: 0, gload: 1, altitude: 0, eye: [0, 0, 0] as [number, number, number], float: 0, pitch: 0 };

export function resetMoonBoatCamera(): void {
  moonBoatProbe.active = false;
}

export function stepMoonBoatCamera(camera: PerspectiveCamera, _dt: number, lookYaw: number, lookPitch: number, baseFov: number): void {
  const wall = villageClock.liveMs();
  const st = moonBoatAt(wall, ST);
  moonSeatPose(Math.max(0, selfRide.slot), wall, P);
  const k = rideComfort() === 0 ? 0.25 : rideComfort() === 1 ? 0.6 : 1;
  const g = moonGLoad(st);
  // weightlessness: the lighter the seat (g under 1), the higher the eye lifts off the cushion (to 0.07 m at the 55 degree turn)
  const float = Math.max(0, 1 - g) * 0.16 * (st.status === "riding" ? 1 : 0);
  const lift = MOON_SEAT.eye + float;
  // the eye in the boat frame is `lift` above the cushion along the seat's up
  // 0.15 m back from the cushion point, along the seat (the rider sits back in the seat, the row ahead a little farther off)
  camera.position.set(P.x - 0 * P.fy, P.y + P.uy * lift - P.fy * 0.15, P.z + P.uz * lift - P.fz * 0.15);
  // the hull's pitch: nose up while the angle is positive (the boat's +z end rises)
  const pitch = P.angle * k;
  camera.rotation.order = "YXZ";
  // the rider faces the bow (+z): yaw PI in three's frame (its forward is -z)
  camera.rotation.set(-lookPitch + pitch, Math.PI + Math.max(-1.9, Math.min(1.9, lookYaw)), 0);
  camera.up.set(0, 1, 0);
  if (Math.abs(camera.fov - baseFov) > 1e-3) {
    camera.fov = baseFov;
    camera.updateProjectionMatrix();
  }
  moonBoatProbe.active = true;
  moonBoatProbe.angle = P.angle;
  moonBoatProbe.gload = g;
  moonBoatProbe.altitude = P.y;
  moonBoatProbe.float = float;
  moonBoatProbe.pitch = pitch;
  moonBoatProbe.eye[0] = camera.position.x;
  moonBoatProbe.eye[1] = camera.position.y;
  moonBoatProbe.eye[2] = camera.position.z;
}

void MOON_MAX_ANGLE;
