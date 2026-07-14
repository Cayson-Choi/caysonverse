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
  dragSpeed: 0.005, // rad per pixel of pointer drag (mouse + one-finger touch)
  zoomSpeed: 0.01, // m per wheel delta unit (desktop wheel zoom)
  pinchSpeed: 0.02, // m per pixel of two-finger pinch spread change (touch zoom)
} as const;

/** Scene palette — matches the entry screen's cosmic navy/violet backdrop. */
export const SKY_COLOR = "#171335";
export const FOG_NEAR = 25;
export const FOG_FAR = 70;

/*
 * ── Remote-avatar snapshot interpolation & rendering (BINDING values) ──
 * These are the exact tuning numbers Task 5 mandates. Kept in one auditable
 * place; the pure modules (interpolation/locomotion/mixerThrottle) and the
 * RemotePlayer component all reference them so a change never drifts.
 */

/**
 * Render remote players this many ms in the past. We always draw from a time
 * behind the newest received snapshot so there are two snapshots to interpolate
 * BETWEEN, hiding jitter/loss. Buffered latency, deliberately traded for smooth.
 */
export const RENDER_DELAY_MS = 150;

/**
 * When the render time runs past the newest snapshot (a dropped/late patch), we
 * dead-reckon at the last segment's velocity for at most this long, then ease
 * back to the authoritative rest pose (see EXTRAPOLATE_SETTLE_MS).
 */
export const EXTRAPOLATE_MAX_MS = 250;

/**
 * After the extrapolation window closes, the avatar EASES from the overshot
 * dead-reckon position back to `newest` (the last authoritative pose) over this
 * long, then holds there. A remote that stopped walking emits no further patches,
 * so extrapolation must be a transient loss-hiding measure that CONVERGES to the
 * server position — never a permanent standing offset ~1m past the true stop.
 */
export const EXTRAPOLATE_SETTLE_MS = 150;

/** Per-remote-player snapshot ring buffer capacity (oldest evicted). */
export const SNAPSHOT_CAPACITY = 10;

/**
 * If a freshly sampled target is farther than this (m) from where the avatar is
 * currently drawn, teleport instead of sliding — the server clamped/rejected a
 * move (kick-back) or the player respawned. Also the self kick-back threshold.
 */
export const SNAP_DISTANCE = 3;

/**
 * Locomotion hysteresis (m/s): begin the walk cycle above ON, end it below OFF.
 * The gap between the two keeps the animation from flapping when interpolated
 * speed wobbles around a single threshold at snapshot boundaries.
 */
export const WALK_ON_SPEED = 0.3;
export const WALK_OFF_SPEED = 0.15;

/**
 * Mixer-update distance bands (m from camera) and their frame strides. Distant
 * avatars advance their animation less often to save CPU (v1 rule, no LOD yet):
 *   d < NEAR         → every frame
 *   NEAR ≤ d ≤ FAR   → every 3rd frame
 *   d > FAR          → every 6th frame
 * The withheld frames' deltas are accumulated and passed on the frame we tick,
 * so the animation plays at the correct speed, just chunkier.
 */
export const MIXER_NEAR_DIST = 10;
export const MIXER_FAR_DIST = 25;
export const MIXER_STRIDE_NEAR = 1;
export const MIXER_STRIDE_MID = 3;
export const MIXER_STRIDE_FAR = 6;

/** Hide a remote player's nametag beyond this distance from the camera (m). */
export const NAMETAG_MAX_DIST = 20;

/** Height (m) of the nametag sprite above the avatar's feet. */
export const NAMETAG_HEIGHT = 2.1;

/**
 * World height (m) at which a speech bubble's BOTTOM edge sits — above the
 * nametag (which spans roughly 1.9–2.3 m). Sprites are centre-origin, so the
 * bubble module adds half its own height to this anchor when positioning.
 */
export const BUBBLE_BASE_HEIGHT = 2.5;

/** World height (m) of the emoji-reaction sprite (a single glyph, no backdrop). */
export const EMOJI_SPRITE_HEIGHT = 0.5;

/**
 * World height (m) at which the emoji sprite sits BEFORE the float animation's
 * rise is added — slightly above the speech bubble's anchor (BUBBLE_BASE_HEIGHT)
 * so a reaction and a bubble can be visible at once without overlapping.
 */
export const EMOJI_BASE_HEIGHT = BUBBLE_BASE_HEIGHT + 0.4;
