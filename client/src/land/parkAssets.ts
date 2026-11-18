import { useGLTF } from "@react-three/drei";
import { FileLoader, TextureLoader } from "three";
import { useLoader } from "@react-three/fiber";
import { MOUNTAINS_GRID_URL, MOUNTAINS_TEXTURE_URL } from "../village/mountains";
import { CAROUSEL_CARRIAGE_URL, CAROUSEL_HORSE_LOD_URL, CAROUSEL_HORSE_URL, CAROUSEL_STATIC_URL } from "./CarouselWorld";
import { CAR_AO_URL, CAR_URL } from "./CoasterWorld";
import { parkGateDoor } from "@caysonverse/shared/village/parkArea";
import { isTouchDevice } from "../device";
import { ALL_PARK_URLS } from "./pbr";
import { WHEEL_FRAME_URL, WHEEL_GONDOLA_URL, WHEEL_ROTOR_URL } from "./WheelWorld";

/**
 * Every file 케이슨랜드 suspends on, started TOGETHER (a phone's park entry used to be a waterfall: each component's own
 * useGLTF / useTexture suspended after the one before it, and every retry rebuilt the whole tree's geometry and sky from scratch —
 * seconds of main-thread work in a dozen discarded renders, none of it behind the curtain).
 */
export const PARK_MARBLE_URL_LO = "/textures/houses/lo/T_h_stone.webp";
export const PARK_MARBLE_URL_HI = "/textures/houses/hi/T_h_stone.webp";
export const PARK_PINE_URL_LO = "/textures/houses/lo/T_h_wood_pine.webp";
export const PARK_PINE_URL_HI = "/textures/houses/hi/T_h_wood_pine.webp";

export const PARK_GLB_URLS: readonly string[] = [
  CAR_URL,
  CAROUSEL_STATIC_URL,
  CAROUSEL_HORSE_URL,
  CAROUSEL_HORSE_LOD_URL,
  CAROUSEL_CARRIAGE_URL,
  WHEEL_ROTOR_URL,
  WHEEL_FRAME_URL,
  WHEEL_GONDOLA_URL,
];

/** The single textures the park's components load one at a time (the cache key of a one-url list is the same as a plain url's). */
export function parkSingleTextureUrls(touch: boolean): string[] {
  return [touch ? PARK_PINE_URL_LO : PARK_PINE_URL_HI, touch ? PARK_MARBLE_URL_LO : PARK_MARBLE_URL_HI, CAR_AO_URL, MOUNTAINS_TEXTURE_URL];
}

let started = false;
/** Start every park download (idempotent). Called when the player is near the gate and again when the park mounts. */
export function preloadPark(touch: boolean): void {
  if (started) return;
  started = true;
  for (const u of PARK_GLB_URLS) useGLTF.preload(u);
  useLoader.preload(TextureLoader, ALL_PARK_URLS);
  for (const u of parkSingleTextureUrls(touch)) useLoader.preload(TextureLoader, u);
  useLoader.preload(FileLoader, MOUNTAINS_GRID_URL, (l) => {
    l.setResponseType("arraybuffer");
  });
}

/**
 * ParkWorld's first call: suspends until every glb is in (one pass of cheap retries: nothing else of the park has rendered
 * yet, so nothing is discarded). The textures are read with useLoader, not drei's useTexture, which would also upload each
 * one in an effect the moment it mounts (thirty textures in one frame): the shader gate uploads them a few per frame.
 */
export function useParkAssets(touch: boolean): void {
  preloadPark(touch);
  for (const u of PARK_GLB_URLS) useGLTF(u);
  useLoader(TextureLoader, ALL_PARK_URLS);
  for (const u of parkSingleTextureUrls(touch)) useLoader(TextureLoader, u);
}

/** How near the gate (m) a player must come before the park's files start loading. */
export const PRELOAD_RANGE_M = 160;

/** Called every frame in the village: starts the park's downloads (once per page) when the player is within PRELOAD_RANGE_M of the gate. */
export function maybePreloadPark(x: number, z: number): void {
  if (started || !Number.isFinite(x) || !Number.isFinite(z)) return;
  const g = parkGateDoor().pad;
  if (Math.hypot(x - g.x, z - g.z) > PRELOAD_RANGE_M) return;
  preloadPark(isTouchDevice);
}
