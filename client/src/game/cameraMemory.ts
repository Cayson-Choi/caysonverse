/**
 * The player's own camera choice — the follow distance (zoom: wheel / pinch) and the tilt (pitch: vertical drag) — kept
 * for the whole visit and across page reloads (owner 2026-11-10: "마우스 스크롤로 특정 카메라로 세팅하면 그 상태를 유지").
 *
 * One memory for every scene: 케이슨 마을 (the village and the memorial hall), the escape game's hub and classrooms and the
 * legacy world all start from it, so walking through a door, switching experiences, a reconnect or a reload never
 * resets the zoom or the tilt. Only the player changes it; CameraRig writes it back after each wheel notch and at the
 * end of each drag or pinch. The yaw is not kept: it is a direction on one map, and each map starts behind the body.
 *
 * Stored in localStorage under `CAMERA_STORAGE_KEY`. Every read and write is wrapped in try/catch, and a stored value
 * that is broken, out of range or of the wrong type falls back to the default, field by field: a private window or
 * blocked site data just means the choice lasts for this visit.
 */

import { CAMERA } from "./constants";
import type { StorageLike } from "./settings";
import type { Orbit } from "./types";

/** What is remembered: the zoom and the tilt. */
export interface CameraMemory {
  /** Follow distance (m), CAMERA.minDistance .. CAMERA.maxDistance. */
  distance: number;
  /** Orbit pitch (rad), CAMERA.minPitch .. CAMERA.maxPitch. */
  pitch: number;
}

/** localStorage key. The `v1` is the schema version of the stored blob. */
export const CAMERA_STORAGE_KEY = "cv-camera-v1";

/** A first visit (or nothing usable stored): the world's default framing. */
export const DEFAULT_CAMERA_MEMORY: Readonly<CameraMemory> = Object.freeze({
  distance: CAMERA.distance,
  pitch: CAMERA.pitch,
});

/** A finite number clamped into [min, max]; anything else is `fallback`. A value already in range is kept exactly. */
function clampedOr(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v < min ? min : v > max ? max : v;
}

/** A memory from any value: each field validated on its own (clamped into its band), a bad one is its default. */
export function normalizeCameraMemory(value: unknown): CameraMemory {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { ...DEFAULT_CAMERA_MEMORY };
  const v = value as Record<string, unknown>;
  return {
    distance: clampedOr(v.distance, CAMERA.minDistance, CAMERA.maxDistance, DEFAULT_CAMERA_MEMORY.distance),
    pitch: clampedOr(v.pitch, CAMERA.minPitch, CAMERA.maxPitch, DEFAULT_CAMERA_MEMORY.pitch),
  };
}

/** A memory from the raw stored string: `null` and broken JSON are the defaults. */
export function parseCameraMemory(raw: string | null): CameraMemory {
  if (raw === null) return { ...DEFAULT_CAMERA_MEMORY };
  try {
    return normalizeCameraMemory(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_CAMERA_MEMORY };
  }
}

/** The browser's localStorage, or null when the platform hides it (private mode, blocked site data, no DOM). */
function browserStorage(): StorageLike | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

/** Read the stored memory; blocked or empty storage is the default, never an error. */
export function loadCameraMemory(storage: StorageLike | null = browserStorage()): CameraMemory {
  try {
    return parseCameraMemory(storage ? storage.getItem(CAMERA_STORAGE_KEY) : null);
  } catch {
    return { ...DEFAULT_CAMERA_MEMORY };
  }
}

/** Store the memory; a blocked or full storage just means the choice lasts for this visit. */
export function saveCameraMemory(memory: CameraMemory, storage: StorageLike | null = browserStorage()): void {
  try {
    storage?.setItem(CAMERA_STORAGE_KEY, JSON.stringify({ distance: memory.distance, pitch: memory.pitch }));
  } catch {
    // Storage blocked or full — the choice still holds for this visit (the live memory below).
  }
}

/** This visit's memory: read from storage on first use, then kept here (so it holds even where storage is blocked). */
let live: CameraMemory | null = null;

/**
 * Put the remembered zoom and tilt on a fresh `orbit` (a scene's camera, before its first frame). The yaw is left as
 * the scene set it. `storage` is read only the first time in a visit.
 */
export function restoreOrbit(orbit: Orbit, storage?: StorageLike | null): void {
  if (live === null) live = loadCameraMemory(storage === undefined ? browserStorage() : storage);
  orbit.distance = live.distance;
  orbit.pitch = live.pitch;
}

/**
 * Remember the player's current zoom and tilt (after a wheel notch, at the end of a drag or a pinch). Stored only when
 * it changed, so calling it on every pointer-up costs nothing.
 */
export function rememberOrbit(orbit: Readonly<Orbit>, storage?: StorageLike | null): void {
  const next = normalizeCameraMemory({ distance: orbit.distance, pitch: orbit.pitch });
  if (live !== null && live.distance === next.distance && live.pitch === next.pitch) return;
  live = next;
  saveCameraMemory(next, storage === undefined ? browserStorage() : storage);
}

/** The live memory as it stands (a copy), or null before the first restore / remember. */
export function liveCameraMemory(): CameraMemory | null {
  return live === null ? null : { ...live };
}

/** Forget the live memory, so the next `restoreOrbit` reads storage again (a fresh page load, in tests). */
export function forgetLiveCameraMemory(): void {
  live = null;
}
