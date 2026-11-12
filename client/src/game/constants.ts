import type { KeyboardControlsEntry } from "@react-three/drei";
import { MOVE_ELAPSED_CEIL_MS, PATCH_RATE_MS } from "@caysonverse/shared/constants";

/** Name of the head joint accessories (e.g. the AI 조교 halo) are parented to in character.glb. */
export const HEAD_BONE_NAME = "head";

/**
 * Base animation clip names of character.glb — the first seven entries of the
 * manifest `clips` (shared/src/characterManifest.ts). The long/short-skirt variant
 * clips are NOT listed here: they are picked through manifest `clipVariants`
 * (`clipFor(CLIP.x, look)`). Keep every base clip name the client uses here so a
 * future asset swap touches one place only.
 */
export const CLIP = {
  idle: "Idle",
  walk: "Walking_A",
  // Run cycle (controls-ux Task 5) — 0.792 s loop. Which loop plays and how fast follows the ground speed (stride.ts).
  run: "Running_A",
  // Jump (controls-ux Task 11) — 1.167 s clip, played one-shot at ~1.46x so it spans
  // JUMP_DURATION_MS (jump.ts).
  jump: "Jump_Full_Short",
  // Seating (v2 Task 1). Down = sit-down motion, Idle = the held seated pose,
  // StandUp = rise.
  sitDown: "Sit_Chair_Down",
  sitIdle: "Sit_Chair_Idle",
  sitStand: "Sit_Chair_StandUp",
} as const;

/** Crossfade duration (seconds) between the idle / walk / run loops. */
export const ANIM_FADE = 0.2;

/**
 * The character model faces +Z at yaw 0; our `pose.yaw` also measures facing as
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

/** Third-person safety distance below which the local avatar is hidden instead of showing its inside surfaces. */
export const SELF_CAMERA_HIDE_DISTANCE = 1.8;

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
  distance: 6, // first-visit follow distance (m); after that the player's own zoom is kept (cameraMemory.ts)
  // Keep the third-person camera outside the avatar's head and hat. Going closer enters first person instead of
  // rendering the inside of the local character during a max-zoom look-down.
  minDistance: 3.2,
  // 18m + pitch 0.35 puts the camera ~7.8m up — above the 4m walls, so max
  // zoom-out reads as a bird's-eye overview of the room instead of a wall face.
  maxDistance: 18,
  pitch: 0.35, // first-visit elevation (rad); after that the player's own tilt is kept (cameraMemory.ts)
  minPitch: -0.1,
  maxPitch: 1.2,
  // Lowest third-person camera height (m above the y=0 floor). A low pitch at a long zoom (1.4 + 18·sin(-0.1) ≈ -0.4)
  // used to put the camera under the ground and show its underside (owner 2026-11-09); the arm now stops here.
  minY: 0.6,
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

/*
 * ── Remote playout clock (playout.ts; fix/remote-move-snapback) ──
 * Each remote is drawn at its own render time, which trails its newest data by an
 * adaptive lag and never passes it (no dead reckoning, so no run-ahead-then-back).
 */

/**
 * Buffer (ms) behind the fastest arrival while fewer than PLAYOUT_WARMUP moving pairs
 * have been measured (it is the floor then): a guess that covers a typical phone link,
 * so the first walk after joining does not stutter while the lag is still learning.
 */
export const PLAYOUT_DEFAULT_BUFFER_MS = 250;
export const PLAYOUT_WARMUP = 10;

/** Bounds (ms) of the buffer the measured "lag needed" samples may ask for. */
export const PLAYOUT_MIN_BUFFER_MS = 50;
export const PLAYOUT_MAX_BUFFER_MS = 1000;

/**
 * Added on top of the largest recent "lag needed" sample: PLAYOUT_MARGIN_MS (frame
 * timing slack) plus PLAYOUT_SPREAD_MARGIN of the samples' spread (max - min), so a
 * jittery link — whose next sample may well beat the largest so far — keeps headroom.
 */
export const PLAYOUT_MARGIN_MS = 20;
export const PLAYOUT_SPREAD_MARGIN = 0.25;

/** How many recent samples (offsets, lag needed) are kept: about 4 s of walking. */
export const PLAYOUT_HISTORY = 40;

/**
 * A pair of snapshots slower than RESTING_SPEED (m/s) or further apart than
 * RESTING_SPAN_MS on the timeline is a RESTING stretch: a stop, then the next start (or
 * a join, then the first move). It is drawn as standing still and then stepping off at
 * MOVE_SPEED just in time to reach the second pose (`restTailStart`) — a straight line
 * across it would creep through the whole pause and, when the render time skips ahead,
 * jump. It asks for no lag, and the render time may skip its standing part at once.
 * The speed is well under the 2 m/s walk and well over a stop-start pair (one frame of
 * motion over the pause, ~0.2 m/s); the span is well over the 100-117 ms between two
 * moves, even when the patch grouping merges two of them.
 */
export const RESTING_SPEED = 0.5;
export const RESTING_SPAN_MS = 400;

/**
 * How the render time follows its target: err / PLAYOUT_WARP_MS is the playback
 * speed change, at most +PLAYOUT_MAX_SPEEDUP (catching up) and -PLAYOUT_MAX_SLOWDOWN
 * (building up buffer) — a 10-20% time-warp is not noticeable, a jump is.
 */
export const PLAYOUT_WARP_MS = 1000;
export const PLAYOUT_MAX_SPEEDUP = 0.1;
export const PLAYOUT_MAX_SLOWDOWN = 0.2;

/**
 * The arrival-time fallback (a remote with no mover clock) spaces consecutive snapshots
 * at least this share of PATCH_RATE_MS apart on its timeline, so a bunched burst of
 * patches is replayed at about the patch rate instead of as a one-frame lurch.
 */
export const PLAYOUT_ARRIVAL_SPACING = 0.8;

/** Further behind the target than this (ms: a long outage) and the render time joins it in one go. */
export const PLAYOUT_RESYNC_MS = 1000;

/** Held on its newest pose this long (ms) and a remote shows idle (it has stopped on screen). */
export const PLAYOUT_HOLD_IDLE_MS = 100;

/**
 * Per-remote-player snapshot ring buffer capacity (oldest evicted). Covers the
 * largest playout buffer plus the gait's 600 ms window at 10 Hz.
 */
export const SNAPSHOT_CAPACITY = 24;

/**
 * If a freshly sampled target is farther than this (m) from where the avatar is
 * currently drawn, teleport instead of sliding — the server clamped/rejected a
 * move (kick-back) or the player respawned. Also the self kick-back threshold.
 */
export const SNAP_DISTANCE = 3;

/**
 * The self-correction's threshold (m) once the server has REFUSED my Move (its echoed
 * `moveT` went from a stamp of mine to 0). Its speed budget refills faster than anyone
 * runs, but only up to 4.8 m: a runner already more than ~1.6 m past the server's pose
 * would stay out of its reach for good (every later Move refused, nothing synced, the
 * others seeing a frozen avatar). So a refused runner this far ahead resyncs at once.
 */
export const REFUSED_SNAP_DISTANCE = 1.5;

/**
 * How long (ms) the server's echo of my clock must have stayed 0 (it refused my Move and has
 * taken none since) before the self-correction treats the refusal as one it will not heal.
 * While it refuses, the server's speed budget keeps filling — up to MOVE_ELAPSED_CEIL_MS of
 * running — so a short uplink stall (the queued moves arrive bunched, the last ones over the
 * budget) is absorbed within ~0.3 s: the next moves are taken and the echo carries a stamp
 * again. Snapping at the first 0 yanked the mover back 1.8-3.4 m (and the others saw it jump
 * back) for a refusal the server was about to heal. Past the full budget plus one patch, the
 * server cannot catch up any more. (fix: refused-move snap)
 */
export const REFUSAL_HEAL_MS = MOVE_ELAPSED_CEIL_MS + PATCH_RATE_MS;

/**
 * Locomotion hysteresis (m/s): begin the walk cycle above ON, end it below OFF.
 * The gap between the two keeps the animation from flapping when interpolated
 * speed wobbles around a single threshold at snapshot boundaries.
 */
export const WALK_ON_SPEED = 0.3;
export const WALK_OFF_SPEED = 0.15;

/**
 * Run/walk hysteresis (m/s). A remote's gait is derived from its INTERPOLATED speed
 * only (the client never syncs walk/run), and every avatar's locomotion loop — the
 * walk or the run cycle — follows the speed it goes at (stride.ts). Walking is
 * MOVE_SPEED (2 m/s since 2026-11-10) and running RUN_SPEED (6.4 m/s): the ON
 * threshold sits well above a walker's ±30% jitter ceiling (2.6 m/s) and even its
 * windowed reading through delivery bursts, the OFF threshold well below a runner's
 * dips (4.5 m/s), so ordinary jitter neither flashes the run cycle on a walker nor
 * drops a runner back to walk. A tab opened before the walk slowed down still walks
 * at 4 m/s: at that speed the run cycle (slowed to it) is the one whose feet keep pace.
 */
export const RUN_ON_SPEED = 3.8;
export const RUN_OFF_SPEED = 3.4;

/**
 * Render-time windows (ms) the remote gait speed is measured over (see
 * `remoteGaitSpeed`). A single patch-to-patch speed is useless for the idle/walk/run
 * decision: receive-time bursts make a walker read 5-10x its speed for a segment
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
 * Fallback world height (m) of a speech bubble's BOTTOM edge: where a new bubble sprite
 * starts (bubbleSprite.ts) and where useSpeechBubble puts it when called without an anchor.
 * Avatars pass an anchor sized to their own height instead — bubbleRestHeight(topY)
 * (nametagLayout.ts) at rest and with no tag (the local player's own tag is off by
 * default), raised by the NametagSystem to just above the tag's top edge (BUBBLE_GAP_M).
 * Sprites are centre-origin, so the bubble module adds half its own height when positioning.
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
