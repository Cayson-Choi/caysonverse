/** Per-frame mutable game data. These live in refs — NEVER React state. */

/** The local player's position and facing (radians, [-PI, PI]). */
export interface Pose {
  x: number;
  z: number;
  yaw: number;
}

/** Third-person camera orbit state around the player. */
export interface Orbit {
  yaw: number;
  pitch: number;
  distance: number;
}

/**
 * The local player's server-confirmed seat. `index` is -1 while standing and the
 * occupied seat index while seated. Written ONLY by the schema sync (never
 * optimistically) and read each frame by LocalPlayer + the sit-prompt UI.
 */
export interface SeatState {
  index: number;
}
