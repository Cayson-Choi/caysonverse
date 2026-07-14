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
