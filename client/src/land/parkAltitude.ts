/**
 * How high the eye is above the park, as one number 0..1 that the whole look follows (owner 2026-11-20: "급행을 타고 천천히 위로 올라가는데 하늘이
 * 전혀 변화가 없이 그대로야"): from the ground (the sky is the ground view's, 0) to the top of the 66 m lift (1). Rising, the world gets the
 * aerial perspective a real height gives:
 *  - the far ground is hazier and its fog band closer, so the visible ground ends in a haze line that DROPS below the eye as you climb (the
 *    horizon a hill sits against falls away; the far ground spreads out below);
 *  - the distance goes bluer and the far ridges haze sooner;
 *  - the sky deepens overhead and its horizon band thickens (parkSky shader);
 *  - cloud puffs come into view at 95-200 m, so rising makes them nearer (ParkHighClouds);
 *  - the wind rises (coasterAudio).
 * Pure functions plus one small module state (`parkAltitude.a`, written once a frame by ParkAltitudeProbe, read by the camera rig, the
 * day/night driver, the sky, the mountains and the audio). 0 outside the park and in the overview camera.
 */

/** The eye height (m over the ground) where the effect starts and where it is complete (the lift's crest is 66.3 m over the station). */
export const ALTITUDE_FROM_M = 6;
export const ALTITUDE_FULL_M = 62;

export const parkAltitude = { a: 0 };

const clamp01 = (x: number): number => (x <= 0 ? 0 : x >= 1 ? 1 : x);

/** The altitude factor for an eye `y` m over the ground: smooth, 0 at and below ALTITUDE_FROM_M, 1 at and above ALTITUDE_FULL_M. */
export function altitudeFactor(y: number): number {
  const t = clamp01((y - ALTITUDE_FROM_M) / (ALTITUDE_FULL_M - ALTITUDE_FROM_M));
  return t * t * (3 - 2 * t);
}

/** The fog band at altitude `a`: the far end comes in to ~55 % and the near end to ~50 %, so the haze line falls below the horizon. */
export const FOG_FAR_AT_TOP = 0.55;
export const FOG_NEAR_AT_TOP = 0.5;
export function altitudeFogFar(far: number, a: number): number {
  return far * (1 - (1 - FOG_FAR_AT_TOP) * a);
}
export function altitudeFogNear(near: number, a: number): number {
  return near * (1 - (1 - FOG_NEAR_AT_TOP) * a);
}

/** The angle (rad) below the eye line at which the ground disappears into the haze, for an eye `eyeY` over the ground and a fog end `far` (m). */
export function hazeLineDip(eyeY: number, far: number): number {
  return Math.atan2(Math.max(0, eyeY), far);
}

/** The distance's blue: the fog colour at altitude `a` (rgb 0..1, in place): red and green drawn down a little, blue held. */
export function altitudeFogTint(rgb: [number, number, number], a: number): [number, number, number] {
  rgb[0] *= 1 - 0.1 * a;
  rgb[1] *= 1 - 0.045 * a;
  rgb[2] = Math.min(1, rgb[2] * (1 + 0.02 * a));
  return rgb;
}

/** The wind's extra gain on the lift (0 at the ground .. 0.2 at the top): the air gets bigger as you climb. */
export function altitudeWindGain(a: number): number {
  return 0.2 * a;
}
