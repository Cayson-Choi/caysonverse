/**
 * Live third-person camera readout, published once per frame by CameraRig and
 * read by the dev/E2E hook (`window.__cv.getCamera`). A single shared mutable
 * object — never React state — so the per-frame write is allocation-free. Lets
 * the maze camera-cap E2E assert the ACTUAL camera height/distance (the cap is
 * applied at render time and is not reflected in the user's `orbit.distance`).
 */
export const cameraProbe = {
  /** World-space camera position. */
  x: 0,
  y: 0,
  z: 0,
  /** Effective follow distance after the portrait pull-back AND the maze cap. */
  distance: 0,
};

declare global {
  interface Window {
    /**
     * Dev/E2E only: a snapshot of the live camera (position + capped effective
     * distance). Installed by CameraRig under `import.meta.env.DEV`; absent in
     * production. Kept separate from `__cv` (owned by debug.ts) so this lane
     * never edits that shared hook.
     */
    __cvCamera?: () => { x: number; y: number; z: number; distance: number };
  }
}
