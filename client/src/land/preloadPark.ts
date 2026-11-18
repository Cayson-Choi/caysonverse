/**
 * Starts loading the park's rides and textures while the player walks up to the gate (first-time-player review, phone: the park needed ~12-17 s after the door
 * before anything was drawn). Once per page; the park's own useGLTF / useTexture calls then find them cached.
 */
import { useGLTF, useTexture } from "@react-three/drei";
import { parkGateDoor } from "@caysonverse/shared/village/parkArea";
import { ALL_PARK_URLS } from "./pbr";
import { CAROUSEL_CARRIAGE_URL, CAROUSEL_HORSE_LOD_URL, CAROUSEL_HORSE_URL, CAROUSEL_STATIC_URL } from "./CarouselWorld";
import { WHEEL_FRAME_URL, WHEEL_GONDOLA_URL, WHEEL_ROTOR_URL } from "./WheelWorld";
import { CAR_URL } from "./CoasterWorld";

/** How near the gate (m) a player must come before the park's files start loading. */
export const PRELOAD_RANGE_M = 160;
let started = false;

export function maybePreloadPark(x: number, z: number): void {
  if (started || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const g = parkGateDoor().pad;
  if (Math.hypot(x - g.x, z - g.z) > PRELOAD_RANGE_M) return;
  started = true;
  for (const url of [CAR_URL, CAROUSEL_STATIC_URL, CAROUSEL_HORSE_URL, CAROUSEL_HORSE_LOD_URL, CAROUSEL_CARRIAGE_URL, WHEEL_ROTOR_URL, WHEEL_FRAME_URL, WHEEL_GONDOLA_URL]) useGLTF.preload(url);
  useTexture.preload(ALL_PARK_URLS);
}
