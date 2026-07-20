/**
 * Device capability detection (Task 10). Decides ONCE, at startup, whether this
 * session is a touch device. No user-agent sniffing: we ask the platform which
 * pointer is PRIMARY via the coarse-pointer media query; `maxTouchPoints` is only
 * the fallback when matchMedia is unavailable. Injected through `TouchEnv` so the
 * pure helper is fully testable and non-DOM safe.
 *
 * A hybrid laptop (mouse + touchscreen) reads as a DESKTOP here (design 30 후속):
 * Windows machines routinely report maxTouchPoints > 0 from a digitizer driver
 * even when the user drives with a mouse, and treating those as touch pushed the
 * touch UI slots (chat bar at 190px, joystick) onto PC screens. The primary
 * pointer is what the user actually steers with; touch INPUT keeps working
 * regardless of this verdict (both input paths are always active).
 */

/** The (injectable) slice of the platform the detector consults. */
export interface TouchEnv {
  /** `window.matchMedia`, if present. */
  matchMedia?: (query: string) => { matches: boolean };
  /** `navigator.maxTouchPoints`, if present. */
  maxTouchPoints?: number;
}

/**
 * Pure predicate: the PRIMARY pointer decides — coarse ⇒ touch UI, fine ⇒
 * desktop UI (even with a touchscreen present). Only when the media query is
 * unavailable does the touch-point count decide.
 */
export function detectTouchDevice(env: TouchEnv): boolean {
  const coarse = env.matchMedia?.("(pointer: coarse)").matches;
  if (coarse !== undefined) return coarse;
  return (env.maxTouchPoints ?? 0) > 0;
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
