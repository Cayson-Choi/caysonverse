/**
 * Stride matching (pure): which locomotion loop is on an avatar's body and how fast it plays, so that a foot on the
 * ground stays where it was put while the body goes by — the steps carry the body instead of the body sliding over
 * stepping feet (발주자 2026-11-10: "발이 자연스럽게 움직이면서 그걸로 앞으로 가게").
 *
 * Every walk / run loop is in place (no root motion): the avatar's group carries the body at the ground speed and the
 * loop only swings the legs. Played at rate 1, a loop's soles sweep backward under the body at its own natural speed
 * (LOOP_STRIDE, measured from character.glb and re-measured by strideClips.test.ts); played at
 * `ground speed / natural speed`, the sole on the ground keeps pace with the ground and stays put in the world.
 *
 * The walk's feet do not sweep back evenly: a heel lands sweeping back about twice as fast as the flat foot after it.
 * One even rate would leave the heel skidding back (or the flat foot creeping forward), so the walk loops also swing
 * their rate within every step (`warp`): slower while the heel lands, faster over the flat foot. That keeps the foot
 * planted through the whole contact and lets each step reach its full length (fewer, longer steps at the same speed).
 *
 * The loop follows the speed the body actually goes at, not the key: the walk cycle at walking speeds (MOVE_SPEED, or
 * slower along a wall), the run cycle above RUN_ON_SPEED (RUN_SPEED, or a tab still walking at the old 4 m/s), and
 * Idle once the body has stood still for LOOP_STOP_MS while a key is still held (pushed into a wall) — a loop stepping
 * on the spot would be a slide too. Each bottom's variant loops have their own strides (the long skirt's legs barely
 * move), so a look plays its clipFor-resolved loops at their own rates — the long skirt's capped to the others' pace,
 * its feet hidden under the hem (review 2026-11-10).
 *
 * The rate follows the speed the loop has to keep pace with at every moment: a loop fading out after walk <-> run
 * keeps following it too (only a stop freezes it), and a body that keeps going backward of its facing (first person,
 * S) plays its loop backward — it steps back instead of stepping forward over a ground that goes the other way.
 */

import { MOVE_SPEED, RUN_SPEED } from "@caysonverse/shared/constants";
import { ANIM_FADE, CLIP, RUN_OFF_SPEED, RUN_ON_SPEED } from "./constants";
import { clipFor, type AvatarLook } from "./characterLook";
import type { Gait } from "./gait";

/** How a walk / run loop meets the ground. */
export interface LoopStride {
  /**
   * Natural speed: the ground speed (m/s) its soles keep pace with at rate 1 (with its `warp`): the speed at which the
   * sole points touching the ground slide least.
   */
  speed: number;
  /** Phase (0..1 of the loop) at which its left foot is mid-contact: walk <-> run handovers line the feet up on it. */
  leftContact: number;
  /**
   * How far the rate swings within each step (0 = even): the rate is `1 + warp · cos(4π (phase - warpPeak))` times the
   * mean — fastest at `warpPeak` and half a loop later (the other foot's step), slowest a quarter loop from there.
   */
  warp: number;
  /** Phase (0..0.5) of the fastest point of a step. */
  warpPeak: number;
  /**
   * Phase (0..1) past the matching contact at which this loop takes over from the other walk / run loop
   * (handoverTime). The run takes over as the walk's planted foot pushes off: the body is at run speed from that
   * frame on, and a walking foot left on the ground through the crossfade would skate (review 2026-11-10: ~60 cm).
   */
  handoverLead: number;
  /** Ceiling of the loop's mean rate when not MAX_LOOP_SCALE (the long skirt's: see LOOP_STRIDE). */
  maxScale?: number;
}

/**
 * The stride of every walk / run loop in character.glb, keyed by the clip name the mixer plays (clipFor-resolved).
 * ONE place: strideClips.test.ts re-measures every number here from the GLB (three's forward kinematics on the bare
 * feet; a skirt variant keeps its base loop's timing and is judged over the base loop's contacts, as its feet hover),
 * so a re-export with other strides fails there instead of sliding again.
 *
 * The walk's warp is the even second harmonic (one swing per step) of the rate that would hold the contacting soles
 * exactly still. The run's contacts are short and sweep back evenly: no warp. The run's handover lead was picked by
 * replaying walk -> run switches at every point of the step (three's mixer on the GLB, the shoe soles measured).
 *
 * The long skirt's loops swing the legs about half as far (they stay inside the skirt), so planting their feet took
 * twice the others' pace: ~7.5 steps a second walking, arms and hem pumping. Its feet are hidden under the hem, so
 * its rate is capped (`maxScale`) to about the pace of the other looks instead (stride.test.ts): the hidden soles
 * slide some, the visible body steps like everyone else's.
 */
export const LOOP_STRIDE: Readonly<Record<string, LoopStride>> = {
  Walking_A: { speed: 0.89, leftContact: 0.25, warp: 0.33, warpPeak: 0.31, handoverLead: 0 },
  Walking_A_ShortSkirt: { speed: 0.89, leftContact: 0.25, warp: 0.33, warpPeak: 0.31, handoverLead: 0 },
  Walking_A_LongSkirt: { speed: 0.49, leftContact: 0.25, warp: 0.29, warpPeak: 0.335, handoverLead: 0, maxScale: 2.4 },
  Running_A: { speed: 4.56, leftContact: 0.21, warp: 0, warpPeak: 0, handoverLead: 0.1 },
  Running_A_ShortSkirt: { speed: 3.8, leftContact: 0.21, warp: 0, warpPeak: 0, handoverLead: 0.1 },
  Running_A_LongSkirt: { speed: 2.1, leftContact: 0.21, warp: 0, warpPeak: 0, handoverLead: 0.1, maxScale: 1.7 },
};

/** A look's walk and run strides. */
export interface LookStride {
  walk: LoopStride;
  run: LoopStride;
}

/**
 * The strides `look` walks and runs with: its clipFor-resolved loops' (a clip missing from the table falls back to the
 * base loop's).
 */
export function lookStride(look: AvatarLook): LookStride {
  return {
    walk: LOOP_STRIDE[clipFor(CLIP.walk, look)] ?? LOOP_STRIDE[CLIP.walk],
    run: LOOP_STRIDE[clipFor(CLIP.run, look)] ?? LOOP_STRIDE[CLIP.run],
  };
}

/** A body going faster than this (m/s) steps off from Idle. */
export const LOOP_START_SPEED = 0.5;

/** A stepping body slower than this (m/s) for LOOP_STOP_MS has stopped (pushed into a wall): it stands in Idle. */
export const LOOP_STOP_SPEED = 0.25;
export const LOOP_STOP_MS = 150;

/**
 * Ceiling of a walk / run loop's mean rate (the warp swings around it), unless the loop has its own (`maxScale`). Both
 * game speeds play the other looks' loops under it (stride.test.ts); it only keeps a bogus speed reading from spinning
 * the legs.
 */
export const MAX_LOOP_SCALE = 4.5;

/**
 * A frame's ground speed (m/s) above this is no step: nothing walks or runs that fast (a running remote drawn 10%
 * fast is ~7 m/s). It is a drawn pose put somewhere else (a remote mounted while it walks: its pose re-seeded, 12-24
 * m/s for a frame) — the loop holds its pose over it, and from standing it does not start the run cycle at 4.5x.
 */
export const MAX_STEP_SPEED = 1.5 * RUN_SPEED;

/**
 * Crossfade (s) of a step-off from Idle into the walk / run cycle. The body goes at full speed from its first frame (no
 * acceleration), and Idle's feet go along with it for as long as Idle still shows: a quick blend drags them less.
 */
export const LOOP_START_FADE = 0.1;

/**
 * Crossfade (s) between the walk and the run cycle. The speed changes at once (2 <-> 6.4 m/s); the outgoing loop
 * follows it while it fades, but the walk's feet cannot sweep back at run speed (MAX_LOOP_SCALE) — a quick blend
 * leaves them less time to skate.
 */
export const LOOP_SWITCH_FADE = 0.1;

/** The crossfade (s) from loop `from` (null: a one-shot had the body) to loop `to`. */
export function loopFade(from: Gait | null, to: Gait): number {
  if (to === "idle" || from === null) return ANIM_FADE;
  return from === "idle" ? LOOP_START_FADE : LOOP_SWITCH_FADE;
}

/** Smoothing time constant (s) of a remote avatar's drawn speed: per-frame playout and frame-timing jitter. */
export const REMOTE_SPEED_SMOOTH_S = 0.1;
/**
 * Per-avatar state of the loop choice: the speed it goes at (after smoothing), how long it has been stopped, and
 * whether it is backing up.
 */
export interface LoopDriver {
  /** The speed (m/s) the loop follows this frame: 0 on a frame the body did not move. */
  speed: number;
  /** The smoothed speed of the frames the body moved (kept over a frame it did not). */
  ema: number;
  /** How long (ms) the body has been under LOOP_STOP_SPEED while a walk / run loop is on. */
  slowMs: number;
  /** Backing up: the loop plays backward (stepFacing). */
  back: boolean;
  /** How long (ms) the body has gone backward of its facing (under BACKSTEP_COS) while not yet backing up. */
  backMs: number;
}

export function createLoopDriver(): LoopDriver {
  return { speed: 0, ema: 0, slowMs: 0, back: false, backMs: 0 };
}

/**
 * The loop on the body this frame. `current` is the loop on it now (Idle as well when a one-shot has just handed the
 * body back); `moving` whether the avatar is moving at all (the player's input; a remote's gait or drawn motion);
 * `raw` the speed (m/s) its body went at over this frame of `dt` s. Without smoothing (the local player's exact speed)
 * a start is taken at once, so a runner starts on the run cycle, not on the walk. `smoothS` > 0 eases `raw` (a remote's
 * drawn speed), and such a body steps off at walking speed at most: its drawn pose steps off at MOVE_SPEED anyway
 * (interpolation restTailStart), and a remote a viewer has just mounted is drawn jerkily for its first frames (shaders
 * compiling, data catching up: a walker read 4-15 m/s for a frame or three, review 2026-11-10 round 2) — the smoothing
 * takes a real runner on to the run cycle within a few frames. A reading over MAX_STEP_SPEED is no step: the frame
 * counts as one the body did not move.
 */
export function stepLoop(d: LoopDriver, current: Gait, moving: boolean, raw: number, dt: number, smoothS = 0): Gait {
  if (!moving) {
    d.speed = 0;
    d.slowMs = 0;
    return "idle";
  }
  if (!(raw <= MAX_STEP_SPEED)) raw = 0;
  if (raw > 0) {
    if (current === "idle") d.ema = smoothS > 0 ? Math.min(raw, MOVE_SPEED) : raw;
    else d.ema = smoothS <= 0 || d.ema <= 0 ? raw : d.ema + (raw - d.ema) * (1 - Math.exp(-dt / smoothS));
  }
  d.speed = raw > 0 ? d.ema : 0;
  if (current === "idle") {
    d.slowMs = 0;
    if (d.speed <= LOOP_START_SPEED) return "idle";
    return d.speed > RUN_ON_SPEED ? "run" : "walk";
  }
  if (d.speed < LOOP_STOP_SPEED) {
    d.slowMs += dt * 1000;
    if (d.slowMs < LOOP_STOP_MS) return current;
    d.slowMs = 0;
    return "idle";
  }
  d.slowMs = 0;
  if (current === "run") return d.speed < RUN_OFF_SPEED ? "walk" : "run";
  return d.speed > RUN_ON_SPEED ? "run" : "walk";
}

/**
 * A body backing up: once it has gone more than 120 degrees off its facing (cos under BACKSTEP_COS) for BACKSTEP_MS,
 * its loop plays backward, until it goes within ~100 degrees of its facing again (cos over FORESTEP_COS). The hold
 * keeps a turn from flipping it: a third-person reversal turns the body round at TURN_SPEED (12 rad/s), under 0.09 s
 * past 120 degrees, and stepping backward through it slid the feet more (replayed on the GLB). Sideways (first-person
 * A / D) stays forward: no step fits a sideways slide, and a flipping sign would twitch the legs.
 */
export const BACKSTEP_COS = -0.5;
export const BACKSTEP_MS = 150;
export const FORESTEP_COS = -0.2;

/**
 * The cosine of the angle between a frame's motion (`dx`, `dz`) and the facing of a body at `yaw` (0 faces +Z, as
 * `atan2(dirX, dirZ)`); NaN when it did not move.
 */
export function alongFacing(dx: number, dz: number, yaw: number): number {
  const len = Math.hypot(dx, dz);
  if (!(len > 0)) return Number.NaN;
  return (dx * Math.sin(yaw) + dz * Math.cos(yaw)) / len;
}

/** One frame of `dt` s of the backing-up state from this frame's `along` (alongFacing; NaN keeps it). */
export function stepFacing(d: LoopDriver, along: number, dt: number): void {
  if (Number.isNaN(along)) return;
  if (d.back) {
    if (along > FORESTEP_COS) d.back = false;
    return;
  }
  if (along < BACKSTEP_COS) {
    d.backMs += dt * 1000;
    if (d.backMs >= BACKSTEP_MS) {
      d.back = true;
      d.backMs = 0;
    }
  } else {
    d.backMs = 0;
  }
}

/** The speed (m/s) the loop plays at this frame: negative while backing up (the loop plays backward). */
export function loopSpeed(d: LoopDriver): number {
  return d.back ? -d.speed : d.speed;
}

/**
 * The playback rate of a walk / run loop of stride `s` at ground speed `speed` (m/s; negative: backing up, the loop
 * plays backward), at `phase` (0..1) of the loop: the sole on the ground keeps pace with the ground. A body that did
 * not move this frame holds its pose (0).
 */
export function loopRate(s: LoopStride, speed: number, phase: number): number {
  if (!speed || Number.isNaN(speed)) return 0;
  const mean = Math.sign(speed) * Math.min(Math.abs(speed) / s.speed, s.maxScale ?? MAX_LOOP_SCALE);
  return s.warp === 0 ? mean : mean * (1 + s.warp * Math.cos(4 * Math.PI * (phase - s.warpPeak)));
}

/**
 * The playback rate of `loop` for a look of strides `stride` at ground speed `speed` (m/s), `time` s into the loop's
 * `duration`-second clip (stride.ts loopRate). Idle plays at 1.
 */
export function loopTimeScale(loop: Gait, speed: number, stride: LookStride, time = 0, duration = 1): number {
  if (loop === "idle") return 1;
  return loopRate(stride[loop], speed, duration > 0 ? time / duration : 0);
}

/**
 * Where (s) to start `to` (a loop of `toDuration` s) so its feet carry on from `from` at `fromTime` of its
 * `fromDuration`-second loop: the same step, the same foot down (the run taking over `handoverLead` later, as that
 * foot pushes off). A loop starting from Idle (`from` null) starts with its left foot mid-contact — planted under the
 * body, the pose nearest standing.
 */
export function handoverTime(
  from: LoopStride | null,
  fromTime: number,
  fromDuration: number,
  to: LoopStride,
  toDuration: number,
): number {
  const phase =
    from && fromDuration > 0
      ? fromTime / fromDuration - from.leftContact + to.leftContact + to.handoverLead
      : to.leftContact;
  return (((phase % 1) + 1) % 1) * toDuration;
}
