/**
 * Mixer-throttle decision (pure). Distant remote avatars advance their animation
 * mixer less often to save CPU; the frames we skip have their deltas accumulated
 * and handed over on the frame we do tick, so playback speed stays correct (just
 * chunkier the farther away it is). This module only decides — the component
 * owns the frame counter, the accumulator, and the actual mixer.update() call.
 */

import {
  MIXER_FAR_DIST,
  MIXER_NEAR_DIST,
  MIXER_STRIDE_FAR,
  MIXER_STRIDE_MID,
  MIXER_STRIDE_NEAR,
} from "./constants";

/** How many frames apart to advance the mixer at a given camera distance (m). */
export function mixerCadence(distance: number): number {
  if (distance < MIXER_NEAR_DIST) return MIXER_STRIDE_NEAR;
  if (distance <= MIXER_FAR_DIST) return MIXER_STRIDE_MID;
  return MIXER_STRIDE_FAR;
}

/** Decision for one frame: whether to advance the mixer and by what delta. */
export interface MixerTick {
  update: boolean;
  /** Accumulated delta (s) to pass to mixer.update — 0 when not updating. */
  delta: number;
}

/**
 * Decide whether to advance the mixer this frame.
 *
 * @param distance          camera→avatar distance (m), selects the cadence band
 * @param framesSinceUpdate frames elapsed since the last update, INCLUDING this
 *                          one (so it is >= 1 on the frame after a reset)
 * @param accumulatedDelta  summed frame deltas (s) since the last update,
 *                          INCLUDING this frame
 */
export function decideMixerTick(
  distance: number,
  framesSinceUpdate: number,
  accumulatedDelta: number,
): MixerTick {
  if (framesSinceUpdate >= mixerCadence(distance)) {
    return { update: true, delta: accumulatedDelta };
  }
  return { update: false, delta: 0 };
}
