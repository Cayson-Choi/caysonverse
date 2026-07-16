import type { ViewMode } from "./viewMode";

/**
 * Live camera readout, published once per frame by CameraRig and read by the
 * dev/E2E hook (`window.__cvCamera`). A single shared mutable object — never React
 * state — so the per-frame write is allocation-free. Lets the maze camera-cap E2E
 * assert the ACTUAL camera height/distance (the cap is applied at render time and
 * is not reflected in the user's `orbit.distance`), and lets the first-person E2E
 * assert the live view mode / blend / FP look yaw (design 19).
 */
export const cameraProbe = {
  /** World-space camera position. */
  x: 0,
  y: 0,
  z: 0,
  /** Effective follow distance after the portrait pull-back AND the maze cap. */
  distance: 0,
  /** Active view mode ('tp' | 'fp' | 'ov'). */
  mode: "tp" as ViewMode,
  /** TP<->FP transition factor (0 = third-person, 1 = first-person). */
  blend: 0,
  /** First-person look azimuth (rad); meaningful while `mode === 'fp'`. */
  fpYaw: 0,
  /** Overview transition factor (0 = normal view, 1 = fully top-down). */
  ovBlend: 0,
};

declare global {
  interface Window {
    /**
     * Dev/E2E only: a snapshot of the live camera (position, capped effective
     * distance, and view mode/blend/FP look yaw). Installed by CameraRig under
     * `import.meta.env.DEV`; absent in production. Kept separate from `__cv`
     * (owned by debug.ts) so this lane never edits that shared hook.
     */
    __cvCamera?: () => {
      x: number;
      y: number;
      z: number;
      distance: number;
      mode: ViewMode;
      blend: number;
      fpYaw: number;
      ovBlend: number;
    };
  }
}
