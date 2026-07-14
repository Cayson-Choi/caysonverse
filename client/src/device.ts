/**
 * Device capability detection (Task 10). Decides ONCE, at startup, whether this
 * session is a touch device. No user-agent sniffing: we ask the platform via the
 * coarse-pointer media query and the touch-point count. Both are injected through
 * `TouchEnv` so the pure helper is fully testable and non-DOM safe.
 *
 * A hybrid laptop (mouse + touchscreen) reads as a touch device here — that only
 * governs joystick VISIBILITY and the render profile; keyboard/mouse input keep
 * working regardless (both input paths are always active).
 */

/** The (injectable) slice of the platform the detector consults. */
export interface TouchEnv {
  /** `window.matchMedia`, if present. */
  matchMedia?: (query: string) => { matches: boolean };
  /** `navigator.maxTouchPoints`, if present. */
  maxTouchPoints?: number;
}

/** Pure predicate: coarse pointer OR at least one touch point ⇒ touch device. */
export function detectTouchDevice(env: TouchEnv): boolean {
  const coarsePointer = env.matchMedia?.("(pointer: coarse)").matches ?? false;
  const touchPoints = env.maxTouchPoints ?? 0;
  return coarsePointer || touchPoints > 0;
}

/** Read the live platform once (browser only; falls back to a non-touch env). */
function currentEnv(): TouchEnv {
  if (typeof window === "undefined" || typeof navigator === "undefined") return {};
  return {
    matchMedia: (query) => window.matchMedia(query),
    maxTouchPoints: navigator.maxTouchPoints,
  };
}

/**
 * The session's touch verdict, evaluated exactly once at module load. Static per
 * session (no runtime switching) — imported by the render profile, the joystick
 * overlay, and the touch-specific UI tweaks.
 */
export const isTouchDevice: boolean = detectTouchDevice(currentEnv());
