import type { Orbit } from "../game/types";

/**
 * How the follow camera starts in a classroom (AI 학교 탈출, Task 24). The team appears in the middle of the room
 * (COUNSEL_SPAWN) facing north, and the camera starts behind them to the south at the default yaw and distance; a little
 * higher than the world's default pitch (0.35 → 0.55) so the first picture shows the floor and the puzzle objects round the
 * players, not just the back of the avatar. Only what differs from `CAMERA` is listed.
 */
export const ROOM_START_ORBIT: Partial<Orbit> = Object.freeze({ pitch: 0.55 });
