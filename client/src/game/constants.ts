import type { KeyboardControlsEntry } from "@react-three/drei";

/**
 * Single source of truth for character presets. Index === `Player.character`
 * (0..3) and must stay aligned with the server's CHARACTER_COUNT. The model
 * files were verified to be valid glTF; the animation clip names below were
 * discovered by inspecting the GLBs (see models/LICENSE.md), NOT hardcoded blind.
 */
export interface CharacterPreset {
  /** English id (asset/debug). */
  id: string;
  /** Korean label shown in the entry screen. */
  label: string;
  /** Public path to the GLB (served from client/public). */
  model: string;
}

export const CHARACTERS: readonly CharacterPreset[] = [
  { id: "knight", label: "기사", model: "/models/knight.glb" },
  { id: "barbarian", label: "바바리안", model: "/models/barbarian.glb" },
  { id: "mage", label: "마법사", model: "/models/mage.glb" },
  { id: "rogue", label: "도적", model: "/models/rogue.glb" },
] as const;

/**
 * Animation clip names present in every KayKit Adventurers GLB (76 clips on a
 * shared skeleton). Verified by parsing the GLB JSON chunk for all four models.
 * Keep every clip name the client uses here so a future asset swap touches one
 * place only.
 */
export const CLIP = {
  idle: "Idle",
  walk: "Walking_A",
} as const;

/** Crossfade duration (seconds) between idle and walk. */
export const ANIM_FADE = 0.2;

/**
 * KayKit models face +Z at yaw 0; our `pose.yaw` also measures facing as
 * `atan2(dirX, dirZ)` (0 => +Z), so no extra offset is needed. Kept as a named
 * constant so a model with a different rest orientation is a one-line change.
 */
export const MODEL_FACING_OFFSET = 0;

/** Yaw turn rate (radians/second) for the smooth shortest-arc facing lerp. */
export const TURN_SPEED = 12;

/** Approximate character head height (m) — camera look-at target and eye level. */
export const HEAD_HEIGHT = 1.4;

/** drei KeyboardControls action names (typed control set). */
export type MoveControl = "forward" | "backward" | "left" | "right";

/** WASD + arrow keys. `code` values match regardless of shift/capslock. */
export const MOVE_KEYS: KeyboardControlsEntry<MoveControl>[] = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
];

/** Third-person orbit camera tuning. */
export const CAMERA = {
  distance: 6, // initial follow distance (m)
  minDistance: 2.5,
  maxDistance: 10,
  pitch: 0.35, // initial elevation (rad)
  minPitch: -0.1,
  maxPitch: 1.2,
  yaw: 0, // initial azimuth (rad) — camera starts behind the +Z-facing model
  dragSpeed: 0.005, // rad per pixel of pointer drag
  zoomSpeed: 0.01, // m per wheel delta unit
} as const;

/** Scene palette — matches the entry screen's cosmic navy/violet backdrop. */
export const SKY_COLOR = "#171335";
export const FOG_NEAR = 25;
export const FOG_FAR = 70;
