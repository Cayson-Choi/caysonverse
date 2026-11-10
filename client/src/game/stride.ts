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
 * move), so a look plays its clipFor-resolved loops at their own rates.
 */

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
}

/**
 * The stride of every walk / run loop in character.glb, keyed by the clip name the mixer plays (clipFor-resolved).
 * ONE place: strideClips.test.ts re-measures every number here from the GLB (three's forward kinematics on the bare
 * feet; a skirt variant keeps its base loop's timing and is judged over the base loop's contacts, as its feet hover),
 * so a re-export with other strides fails there instead of sliding again.
 *
 * The walk's warp is the even second harmonic (one swing per step) of the rate that would hold the contacting soles
 * exactly still. The run's contacts are short and sweep back evenly: no warp.
 */
export const LOOP_STRIDE: Readonly<Record<string, LoopStride>> = {
  Walking_A: { speed: 0.89, leftContact: 0.25, warp: 0.33, warpPeak: 0.31 },
  Walking_A_ShortSkirt: { speed: 0.89, leftContact: 0.25, warp: 0.33, warpPeak: 0.31 },
  Walking_A_LongSkirt: { speed: 0.49, leftContact: 0.25, warp: 0.29, warpPeak: 0.335 },
  Running_A: { speed: 4.56, leftContact: 0.21, warp: 0, warpPeak: 0 },
  Running_A_ShortSkirt: { speed: 3.8, leftContact: 0.21, warp: 0, warpPeak: 0 },
  Running_A_LongSkirt: { speed: 2.1, leftContact: 0.21, warp: 0, warpPeak: 0 },
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
 * Ceiling of a walk / run loop's mean rate (the warp swings around it). Both game speeds play every look's loops under
 * it (stride.test.ts); it only keeps a bogus speed reading from spinning the legs.
 */
export const MAX_LOOP_SCALE = 4.5;

/**
 * Crossfade (s) of a step-off from Idle into the walk / run cycle. The body goes at full speed from its first frame (no
 * acceleration), and Idle's feet go along with it for as long as Idle still shows: a quick blend drags them less.
 */
export const LOOP_START_FADE = 0.1;

/** The crossfade (s) from loop `from` (null: a one-shot had the body) to loop `to`. */
export function loopFade(from: Gait | null, to: Gait): number {
  return from === "idle" && to !== "idle" ? LOOP_START_FADE : ANIM_FADE;
}

/** Smoothing time constant (s) of a remote avatar's drawn speed: per-frame playout and frame-timing jitter. */
export const REMOTE_SPEED_SMOOTH_S = 0.1;

/** Per-avatar state of the loop choice: the speed it goes at (after smoothing) and how long it has been stopped. */
export interface LoopDriver {
  /** The speed (m/s) the loop follows this frame: 0 on a frame the body did not move. */
  speed: number;
  /** The smoothed speed of the frames the body moved (kept over a frame it did not). */
  ema: number;
  /** How long (ms) the body has been under LOOP_STOP_SPEED while a walk / run loop is on. */
  slowMs: number;
}

export function createLoopDriver(): LoopDriver {
  return { speed: 0, ema: 0, slowMs: 0 };
}

/**
 * The loop on the body this frame. `current` is the loop on it now (Idle as well when a one-shot has just handed the
 * body back); `moving` whether the avatar is moving at all (the player's input; a remote's gait or drawn motion);
 * `raw` the speed (m/s) its body went at over this frame of `dt` s. `smoothS` > 0 eases `raw` (a remote's drawn
 * speed); a start is taken at once from the real speed, so a runner starts on the run cycle, not on the walk.
 */
export function stepLoop(d: LoopDriver, current: Gait, moving: boolean, raw: number, dt: number, smoothS = 0): Gait {
  if (!moving) {
    d.speed = 0;
    d.slowMs = 0;
    return "idle";
  }
  if (raw > 0) {
    d.ema =
      current === "idle" || smoothS <= 0 || d.ema <= 0 ? raw : d.ema + (raw - d.ema) * (1 - Math.exp(-dt / smoothS));
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
 * The playback rate of a walk / run loop of stride `s` at ground speed `speed` (m/s), at `phase` (0..1) of the loop:
 * the sole on the ground keeps pace with the ground. A body that did not move this frame holds its pose (0).
 */
export function loopRate(s: LoopStride, speed: number, phase: number): number {
  if (!(speed > 0)) return 0;
  const mean = Math.min(speed / s.speed, MAX_LOOP_SCALE);
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
 * `fromDuration`-second loop: the same step, the same foot down. A loop starting from Idle (`from` null) starts with
 * its left foot mid-contact — planted under the body, the pose nearest standing.
 */
export function handoverTime(
  from: LoopStride | null,
  fromTime: number,
  fromDuration: number,
  to: LoopStride,
  toDuration: number,
): number {
  const phase = from && fromDuration > 0 ? fromTime / fromDuration - from.leftContact + to.leftContact : to.leftContact;
  return (((phase % 1) + 1) % 1) * toDuration;
}
