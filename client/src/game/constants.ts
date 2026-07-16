import type { KeyboardControlsEntry } from "@react-three/drei";

/**
 * Attach-time transform for a crown accessory. The crown GLB bakes its own
 * +Z→+Y stand-up rotation and a ×100 node scale, so all we vary per royal is a
 * uniform fit-scale (`scale`, a multiplier on CROWN_BASE_SCALE) and an optional
 * `flatten` that squashes ONLY the height (Y) axis — turning the tall gold crown
 * into a low tiara/circlet without changing its footprint.
 */
export interface CrownConfig {
  /** Uniform fit-scale multiplier over CROWN_BASE_SCALE. */
  scale: number;
  /** Height-axis (Y) squash factor in (0, 1]; omitted ⇒ 1 (no flatten). */
  flatten?: number;
}

/**
 * Single source of truth for character presets. Index === `Player.character`
 * (0..7) and must stay aligned with the server's CHARACTER_COUNT. 0..3 are the
 * base KayKit bodies; 4..7 are the royals (왕/왕비/공주/왕자), COMPOSED from those
 * same cached bodies (no new GLB) by hiding a few accessory nodes and attaching a
 * crown to the `head` bone. The avatar assembly (avatar.ts) reads this config —
 * there is no per-character branching anywhere. Clip names were discovered by
 * inspecting the GLBs (see models/LICENSE.md), NOT hardcoded blind.
 */
export interface CharacterPreset {
  /** English id (asset/debug). */
  id: string;
  /** Korean label shown in the entry screen. */
  label: string;
  /** Public path to the GLB (served from client/public). */
  model: string;
  /**
   * Names of accessory nodes to hide (`visible = false`, never deleted — the
   * geometry stays shared with the cache). Every name must be in HIDEABLE_NODES.
   */
  hideNodes?: readonly string[];
  /** Crown accessory attached to the `head` bone after tinting (royals only). */
  crown?: CrownConfig;
}

export const CHARACTERS: readonly CharacterPreset[] = [
  { id: "knight", label: "기사", model: "/models/knight.glb" },
  { id: "barbarian", label: "바바리안", model: "/models/barbarian.glb" },
  { id: "mage", label: "마법사", model: "/models/mage.glb" },
  { id: "rogue", label: "도적", model: "/models/rogue.glb" },
  // ── Royals (v2 Task 2) — same bodies, accessories hidden, crown on the head. ──
  // 왕: barbarian body, hat + mug removed, full-size gold crown.
  {
    id: "king",
    label: "왕",
    model: "/models/barbarian.glb",
    hideNodes: ["Barbarian_Hat", "Mug"],
    crown: { scale: 1.0 },
  },
  // 왕비: mage body, pointed hat removed (keeps the cape as a gown), medium crown.
  {
    id: "queen",
    label: "왕비",
    model: "/models/mage.glb",
    hideNodes: ["Mage_Hat"],
    crown: { scale: 0.8 },
  },
  // 공주: rogue body, cape kept, a low flattened tiara.
  {
    id: "princess",
    label: "공주",
    model: "/models/rogue.glb",
    crown: { scale: 0.7, flatten: 0.5 },
  },
  // 왕자: knight body, helmet removed (exposes Knight_Head), a small circlet.
  {
    id: "prince",
    label: "왕자",
    model: "/models/knight.glb",
    hideNodes: ["Knight_Helmet"],
    crown: { scale: 0.6, flatten: 0.35 },
  },
] as const;

/**
 * Accessory node names that presets are allowed to hide. Verified to exist in the
 * respective KayKit GLBs (parsed from each model's node list). The config-integrity
 * unit test checks every preset's `hideNodes` against THIS list, so a typo can't
 * silently no-op in the browser — no GLB is loaded in the test.
 */
export const HIDEABLE_NODES = [
  "Knight_Helmet",
  "Knight_Cape",
  "Barbarian_Hat",
  "Barbarian_Cape",
  "Mug",
  "Mage_Hat",
  "Mage_Cape",
  "Rogue_Cape",
] as const;

/** Public path to the crown accessory GLB (Quaternius, CC0 — see models/LICENSE.md). */
export const CROWN_MODEL = "/models/crown.glb";

/**
 * Base fit-scale applied to the crown before the per-royal `scale` multiplier.
 * The raw crown is ~0.89 m wide (mesh × the GLB's ×100 node scale); the `head`
 * bone has unit world scale, so this shrinks it onto the ~0.3 m head. Tuned by
 * E2E screenshot across idle/walk/sit.
 */
export const CROWN_BASE_SCALE = 0.36;

/**
 * Local +Y offset (head-bone space, which is unit-scaled and axis-aligned with
 * world) that lifts the crown from the head-bone origin (~1.24 m) onto the top of
 * the head. Screenshot-tuned; the same value works for all four bodies (shared rig).
 */
export const CROWN_Y_OFFSET = 0.2;

/** Name of the head joint the crown is parented to (shared across all four bodies). */
export const HEAD_BONE_NAME = "head";

/**
 * Pure crown transform helper: the local [x, y, z] scale that fits a crown onto
 * the head. Width (X/Z) scales by `base × cfg.scale`; height (Y) additionally by
 * `cfg.flatten` (default 1). Kept THREE-free so it is unit-testable in isolation.
 */
export function crownLocalScale(cfg: CrownConfig, base: number): [number, number, number] {
  const s = base * cfg.scale;
  const flatten = cfg.flatten ?? 1;
  return [s, s * flatten, s];
}

/**
 * Animation clip names present in every KayKit Adventurers GLB (76 clips on a
 * shared skeleton). Verified by parsing the GLB JSON chunk for all four models.
 * Keep every clip name the client uses here so a future asset swap touches one
 * place only.
 */
export const CLIP = {
  idle: "Idle",
  walk: "Walking_A",
  // Seating (v2 Task 1) — verified present in all 4 KayKit GLBs (same Rig_Medium
  // skeleton). Down = sit-down motion, Idle = the held seated pose, StandUp = rise.
  sitDown: "Sit_Chair_Down",
  sitIdle: "Sit_Chair_Idle",
  sitStand: "Sit_Chair_StandUp",
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
  // 18m + pitch 0.35 puts the camera ~7.8m up — above the 4m walls, so max
  // zoom-out reads as a bird's-eye overview of the room instead of a wall face.
  maxDistance: 18,
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
// Pushed out with maxDistance=18: at full zoom-out across the 60m map the far
// wall sits ~75-80m from the camera, so the old FOG_FAR=70 would swallow it.
export const FOG_NEAR = 35;
export const FOG_FAR = 100;

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
