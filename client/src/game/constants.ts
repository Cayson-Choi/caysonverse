import type { KeyboardControlsEntry } from "@react-three/drei";

/**
 * The four royal presets (v2 Task 13). Keys the fixed atlas palette
 * (royalPalette.ts) and the procedural accessories (royalAttachments.ts).
 */
export type RoyalId = "king" | "queen" | "princess" | "prince";

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
  /**
   * Royal identity marker (v2 Task 13). Set exactly on the four royal presets;
   * it selects the fixed palette texture (tint is NOT applied — pastel
   * multiplication would corrupt the gold) and the procedural accessories. It
   * rides on the crown config because the avatar assembly call sites
   * (LocalPlayer/RemotePlayer, other work lanes) forward only
   * `{hideNodes, crown, crownScene}` — and a crown is precisely what makes a
   * preset royal, so the marker introduces no new plumbing.
   */
  royal?: RoyalId;
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
  /**
   * Chat-voice gender (design 34 후속): the Edge-TTS neural voice this
   * character SPEAKS with when its chat messages are read aloud — male
   * characters get the male voice, female characters the female voice.
   */
  voice: "male" | "female";
}

export const CHARACTERS: readonly CharacterPreset[] = [
  { id: "knight", label: "기사", model: "/models/knight.glb", voice: "male" },
  { id: "barbarian", label: "바바리안", model: "/models/barbarian.glb", voice: "male" },
  { id: "mage", label: "마법사", model: "/models/mage.glb", voice: "male" },
  { id: "rogue", label: "도적", model: "/models/rogue.glb", voice: "female" },
  // ── Royals (v2 Task 13) — same bodies in ROYAL DRESS: fixed atlas palette
  //    (crown.royal → royalPalette.ts), ALL weapons hidden (unarmed royalty,
  //    node names measured by scripts/dump-uv-cells.mjs), built-in cape kept
  //    and repainted, procedural gold accessories, crown on the head. ──
  // 왕: barbarian body — deep-red garment + gold, red cape, full-size crown.
  {
    id: "king",
    label: "왕",
    model: "/models/barbarian.glb",
    hideNodes: [
      "Barbarian_Hat",
      "Mug",
      "1H_Axe",
      "2H_Axe",
      "1H_Axe_Offhand",
      "Barbarian_Round_Shield",
    ],
    crown: { scale: 1.0, royal: "king" },
    voice: "male",
  },
  // 왕비: mage body — deep-purple gown + gold trim, cape as a royal train,
  // gold medallion + waist band, staff/spellbooks hidden, medium crown.
  {
    id: "queen",
    label: "왕비",
    model: "/models/mage.glb",
    hideNodes: ["Mage_Hat", "1H_Wand", "2H_Staff", "Spellbook", "Spellbook_open"],
    crown: { scale: 0.8, royal: "queen" },
    voice: "female",
  },
  // 공주: rogue body — rose dress + pale-gold straps, rose cape, flared peplum
  // (hidden while seated), daggers/crossbows hidden, a low flattened tiara.
  {
    id: "princess",
    label: "공주",
    model: "/models/rogue.glb",
    hideNodes: ["Knife", "Knife_Offhand", "1H_Crossbow", "2H_Crossbow", "Throwable"],
    crown: { scale: 0.7, flatten: 0.5, royal: "princess" },
    voice: "female",
  },
  // 왕자: knight body — gold plate + royal-blue tunic/cape, gold epaulettes,
  // helmet + every sword/shield hidden, a small circlet.
  {
    id: "prince",
    label: "왕자",
    model: "/models/knight.glb",
    hideNodes: [
      "Knight_Helmet",
      "1H_Sword",
      "2H_Sword",
      "1H_Sword_Offhand",
      "Badge_Shield",
      "Rectangle_Shield",
      "Round_Shield",
      "Spike_Shield",
    ],
    crown: { scale: 0.8, flatten: 0.72, royal: "prince" },
    voice: "male",
  },
] as const;

/**
 * Accessory node names that presets are allowed to hide. Verified to exist in the
 * respective KayKit GLBs (measured by scripts/dump-uv-cells.mjs, which parses
 * each model's node list). The config-integrity unit test checks every preset's
 * `hideNodes` against THIS list, so a typo can't silently no-op in the browser —
 * no GLB is loaded in the test.
 */
export const HIDEABLE_NODES = [
  // Headwear / props
  "Knight_Helmet",
  "Barbarian_Hat",
  "Mage_Hat",
  "Mug",
  // Built-in capes (visible by default in the GLBs; royals KEEP + repaint them)
  "Knight_Cape",
  "Barbarian_Cape",
  "Mage_Cape",
  "Rogue_Cape",
  // Knight weapons/shields (v2 Task 13 — unarmed royalty)
  "1H_Sword",
  "2H_Sword",
  "1H_Sword_Offhand",
  "Badge_Shield",
  "Rectangle_Shield",
  "Round_Shield",
  "Spike_Shield",
  // Barbarian weapons/shield
  "1H_Axe",
  "2H_Axe",
  "1H_Axe_Offhand",
  "Barbarian_Round_Shield",
  // Mage implements
  "1H_Wand",
  "2H_Staff",
  "Spellbook",
  "Spellbook_open",
  // Rogue weapons
  "Knife",
  "Knife_Offhand",
  "1H_Crossbow",
  "2H_Crossbow",
  "Throwable",
] as const;

/** Public path to the crown accessory GLB (Quaternius, CC0 — see models/LICENSE.md). */
export const CROWN_MODEL = "/models/crown.glb";

/**
 * Base fit-scale applied to the crown before the per-royal `scale` multiplier.
 * The raw crown is ~0.89 m wide (mesh × the GLB's ×100 node scale); the `head`
 * bone has unit world scale, so this shrinks it onto the head. Tuned by screenshot.
 */
export const CROWN_BASE_SCALE = 0.55;

/**
 * Head-bone-local Y at which the crown's BOTTOM RIM is anchored. The KayKit chibi
 * head mesh tops out ~0.95 m above the head bone (measured, near-identical across
 * all four bodies); anchoring the rim just under that (0.9) rests every crown on
 * the crown of the head/hair. Anchoring the RIM (not a fixed pivot) is what keeps
 * the flattened tiara/circlet on TOP of the hair instead of sinking into it.
 */
export const CROWN_RIM_Y = 0.9;

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
  // Run cycle (controls-ux Task 5) — 0.800 s loop; verified present in all 4 GLBs.
  run: "Running_A",
  // Jump (controls-ux Task 11) — 1.167 s clip, played one-shot at ~1.46x so it spans
  // JUMP_DURATION_MS (jump.ts); verified present in all 4 GLBs.
  jump: "Jump_Full_Short",
  // Seating (v2 Task 1) — verified present in all 4 KayKit GLBs (same Rig_Medium
  // skeleton). Down = sit-down motion, Idle = the held seated pose, StandUp = rise.
  sitDown: "Sit_Chair_Down",
  sitIdle: "Sit_Chair_Idle",
  sitStand: "Sit_Chair_StandUp",
} as const;

/** Crossfade duration (seconds) between the idle / walk / run loops. */
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

/**
 * First-person camera eye height (m). A touch above HEAD_HEIGHT so the FP view
 * sits at the eye level of the (hidden) own avatar rather than inside its head.
 * The whole own group is hidden in FP, so this can't clip; tuned for a natural
 * standing eye-line. Seated FP keeps this same height (design 19 — simplest).
 */
export const FP_EYE_HEIGHT = HEAD_HEIGHT + 0.1;

/** drei KeyboardControls action names (typed control set). */
export type MoveControl = "forward" | "backward" | "left" | "right" | "run" | "camLeft" | "camRight";

/**
 * WASD + arrow keys walk, Shift (held) runs, Z / C are registered for the held-key
 * camera turn. `code` values match regardless of shift/capslock — which is also
 * why Shift+W still reads as W.
 */
export const MOVE_KEYS: KeyboardControlsEntry<MoveControl>[] = [
  { name: "forward", keys: ["ArrowUp", "KeyW"] },
  { name: "backward", keys: ["ArrowDown", "KeyS"] },
  { name: "left", keys: ["ArrowLeft", "KeyA"] },
  { name: "right", keys: ["ArrowRight", "KeyD"] },
  { name: "run", keys: ["ShiftLeft", "ShiftRight"] },
  { name: "camLeft", keys: ["KeyZ"] },
  { name: "camRight", keys: ["KeyC"] },
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
  // Overview (top-down) zoom sensitivity — metres of camera HEIGHT per input unit
  // (design 20). Tuned so a few wheel notches / a pinch cross the overview's
  // [15 m … full-map] height band without feeling twitchy.
  ovZoomSpeed: 0.08, // m of height per wheel delta unit
  ovPinchSpeed: 0.15, // m of height per pixel of pinch spread change
} as const;

/**
 * The third-person view that takes over while seated: a camera right behind the
 * chair, high and far enough to look over the avatar's head at the lecture-hall
 * screen. Tuned by screenshot — the plan's first guess (0.22 rad, 3.2 m) left the big
 * chibi head covering half of the screen. Applied as an orbit goal (the yaw comes from
 * the seat), and given back when the player stands.
 */
export const SEAT_CAM = { pitch: 0.32, distance: 4.2 } as const;

/**
 * Scene palette — bright daylight sky (design 30: the world reads as a lit real
 * building). The entry screen keeps its cosmic navy branding; only the 3D world
 * changed. Also the fog colour, so distance fades into haze, not darkness.
 */
export const SKY_COLOR = "#cde3f5";
// Pushed out with maxDistance=18: at full zoom-out across the 60m map the far
// wall sits ~75-80m from the camera, so the old FOG_FAR=70 would swallow it.
export const FOG_NEAR = 35;
export const FOG_FAR = 100;

/**
 * The scene camera's far plane (m). The overview raises it with its blend (CameraRig): on a
 * tall phone the whole-map fit is width-limited and puts the camera over 200 m up, which
 * would clip the entire map away.
 */
export const CAMERA_FAR = 200;

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
 * Remote run/walk hysteresis (m/s). A remote's gait is derived from its
 * INTERPOLATED speed only (the client never syncs walk/run). Walking is 4 m/s and
 * running 6.4 m/s; the ON threshold sits above a walker's ±30% jitter ceiling
 * (5.2 m/s), and the OFF threshold sits well below the run speed, so ordinary
 * jitter neither flashes the run cycle on a walker nor drops a runner back to walk.
 */
export const RUN_ON_SPEED = 5.6;
export const RUN_OFF_SPEED = 4.8;

/**
 * Render-time windows (ms) the remote gait speed is measured over (see
 * `remoteGaitSpeed`). A single patch-to-patch speed is useless for the idle/walk/run
 * decision: receive-time bursts make a 4 m/s walker read 20-40 m/s for a segment
 * and a runner on a jittery link dip to 4 m/s. So the speed is the path length
 * travelled over a window, divided by the window:
 *   - SPEED_WINDOW_MS (300)       the responsive reading: ramps up over it when a move
 *                                 starts and decays to 0 over it after a stop;
 *   - SPEED_LONG_WINDOW_MS (600)  the sanity reading: long enough to contain a whole
 *                                 stall-then-catch-up burst (a 250-400 ms late patch
 *                                 and the patches queued behind it), which the short
 *                                 window alone reads as a ~7 m/s sprint;
 *   - SPEED_LONG_MIN_MS (150)     the shortest span the long reading divides by, so it
 *                                 has no ramp-up of its own at the start of a move.
 * The gait uses the smaller of the two readings.
 */
export const SPEED_WINDOW_MS = 300;
export const SPEED_LONG_WINDOW_MS = 600;
export const SPEED_LONG_MIN_MS = 150;

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

/**
 * Name tag distance fade (controls-ux Task 13, spec §6): fully opaque up to
 * NAMETAG_FADE_START metres from the camera, fading linearly to nothing at
 * NAMETAG_FADE_END. Replaces the old instant hide at 20 m.
 */
export const NAMETAG_FADE_START = 25;
export const NAMETAG_FADE_END = 30;

/**
 * The tag's text stays between these projected CSS pixel heights at every distance
 * (readable far away, not shouting up close). The tag's WORLD size follows from it
 * (nametagLayout.ts).
 */
export const NAMETAG_TEXT_PX = { min: 12, max: 16 } as const;

/**
 * How fast a tag's opacity chases its target, in opacity per second — so a tag
 * crossing the fade line (or being selected / dropped) dissolves instead of popping.
 */
export const NAMETAG_FADE_RATE = 4;

/**
 * World height (m) of the whole tag (capsule included) at the distances where the
 * natural size already puts the text inside NAMETAG_TEXT_PX. 0.30 (design 22):
 * small enough that the speech bubble stays the visual protagonist.
 */
export const NAMETAG_BASE_HEIGHT_M = 0.30;

/**
 * Tag canvas metrics (px): the text em size and the capsule's vertical padding
 * above and below it. The canvas is always FONT + 2·PAD tall, so the text takes
 * NAMETAG_TEXT_FRACTION of the tag's height whatever the badge or border.
 */
export const NAMETAG_FONT_PX = 48;
export const NAMETAG_PAD_Y_PX = 14;
export const NAMETAG_TEXT_FRACTION = NAMETAG_FONT_PX / (NAMETAG_FONT_PX + 2 * NAMETAG_PAD_Y_PX);

/**
 * Height (m) of the nametag sprite's CENTRE above the avatar's feet, at rest (no
 * overlap lift). The tag is NAMETAG_BASE_HEIGHT_M (0.30 m) tall up close but is grown
 * with distance to keep its text 12 px: about 0.8 m tall at 30 m on a 720 px-tall
 * canvas, and about 1.6 m on a 360 px-tall landscape phone. So its vertical span is
 * roughly 1.95–2.25 m up close, 1.7–2.5 m at 30 m on a desktop-sized canvas and
 * 1.3–2.9 m at 30 m on a short phone — higher still while the tag is lifted
 * (DECLUTTER). The top edge can therefore pass the old fixed 2.5 m bubble anchor, so
 * nothing may be anchored to a fixed height above the tag: the NametagSystem publishes
 * each avatar's bubble anchor (LabelEntry.bubbleAnchor) from the tag's real top edge
 * every frame.
 *
 * Only the FALLBACK now: an avatar registers its own rest height (LabelEntry.heightM,
 * from the assembled avatar's top — nametagRestHeight), so a hat or the AI 조교 halo
 * never pokes through its tag. A label that gives none keeps this.
 */
export const NAMETAG_HEIGHT = 2.1;

/**
 * Clear space (m) between the top of an avatar (hair, hat, the AI 조교 halo — see
 * BuiltAvatar.topY) and the BOTTOM edge of its name tag at the tag's designed size.
 */
export const NAMETAG_HEAD_GAP_M = 0.08;

/**
 * World height (m) at which a speech bubble's BOTTOM edge sits when there is no
 * nametag to sit on: the local player (whose own tag is not drawn) and an avatar
 * before the NametagSystem has published its anchor. Sprites are centre-origin, so
 * the bubble module adds half its own height to the anchor when positioning. With a
 * tag the bubble sits just above the tag's top edge instead (BUBBLE_GAP_M).
 */
export const BUBBLE_BASE_HEIGHT = 2.5;

/**
 * Name tag selection and layout (controls-ux Task 14, spec §6): which tags are drawn
 * (the nearest NAMETAG_CAP on screen, plus everyone speaking, plus the pinned teacher
 * and AI assistants), how overlapping ones stack, and how a wall in the way dims them.
 */
export const NAMETAG_CAP = 15;
/** Selection and stacking are recomputed at 5 Hz, not every frame. */
export const NAMETAG_SELECT_INTERVAL_MS = 200;
/** The wall-occlusion ray test visits this many tags per frame (round-robin). */
export const NAMETAG_OCCLUSION_PER_FRAME = 8;
/** Opacity factor of a tag whose line of sight to the camera crosses a wall. */
export const NAMETAG_OCCLUDED_OPACITY = 0.35;
/** How long a tag's blue highlight border stays after its owner speaks. */
export const NAMETAG_HIGHLIGHT_MS = 1000;
/** Overlap stacking: each tag lifts at most maxSteps times, (its height + gapPx) screen px each. */
export const DECLUTTER = { maxSteps: 3, gapPx: 2 } as const;
/**
 * How fast a tag's lift chases its stacking target, per second (exponential
 * smoothing): a stack settles in about a quarter of a second instead of snapping
 * whenever the 5 Hz layout changes.
 */
export const NAMETAG_LIFT_RATE = 12;
/** Clear space (m) between the top of a tag and the bottom of its speech bubble. */
export const BUBBLE_GAP_M = 0.06;

/** World height (m) of the emoji-reaction sprite (a single glyph, no backdrop). */
export const EMOJI_SPRITE_HEIGHT = 0.5;

/**
 * DEFAULT world height (m) of the emoji sprite's centre BEFORE the float animation's rise
 * is added — slightly above the speech bubble's default anchor (BUBBLE_BASE_HEIGHT). It is
 * only the floor: emojiBaseHeight (emojiFloat.ts) starts the glyph above the avatar's real
 * speech bubble when one is up, and above a tall or stacked name tag, so a reaction and a
 * bubble can be visible at once without overlapping however far the bubble was lifted.
 */
export const EMOJI_BASE_HEIGHT = BUBBLE_BASE_HEIGHT + 0.4;
