// Browser-safe shared constants. Safe to import (as values) from the client
// bundle — no @colyseus/schema decorator runtime lives here (that is schema.ts).

/** Public application name. Shown in the client UI and used in server logs. */
export const APP_NAME = "caysonverse";

/** Default Colyseus server port, used when the PORT env var is not set. */
export const DEFAULT_SERVER_PORT = 2567;

/** Matchmaking name of the main world room (registered in Task 3). */
export const WORLD_ROOM = "world";

/** Max clients allowed in the world room (100 target + reconnection headroom). */
export const MAX_CLIENTS = 110;

/** State broadcast interval in milliseconds (10Hz). */
export const PATCH_RATE_MS = 100;

/** Maximum walk speed in meters/second. */
export const MOVE_SPEED = 4;

/** Displacement clamp multiplier — tolerated overshoot over the ideal step. */
export const MOVE_SPEED_SLACK = 1.5;

/** Per-client move-message rate cap (messages per second). */
export const MOVE_MAX_MSGS_PER_SEC = 30;

/**
 * Floor for the elapsed-time budget used in move displacement validation.
 * Prevents a burst of messages (elapsed ~= 0) from collapsing the allowed
 * step to zero and dropping otherwise-legal tiny moves. See MOVEMENT spec.
 */
export const MOVE_ELAPSED_FLOOR_MS = 10;

/** Nickname length bounds, counted after trimming. */
export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 12;

/** Number of selectable character presets (valid index range 0..CHARACTER_COUNT-1). */
export const CHARACTER_COUNT = 4;

/** Number of selectable tint palette entries (valid index range 0..TINT_COUNT-1). */
export const TINT_COUNT = 8;

/**
 * Selectable character tint colors (index matches `Player.tint`).
 *
 * Applied as a THREE multiply tint on the model's base material, which can only
 * DARKEN toward the chosen hue — so every entry is light/pastel and index 0 is
 * pure white (`#ffffff`), i.e. "untinted". All values are browser-safe CSS hex
 * usable both for the entry-screen swatches and `material.color.set(...)`.
 */
export const TINT_COLORS = [
  "#ffffff", // 0 untinted (white)
  "#ffb3b3", // 1 red
  "#ffd0a6", // 2 orange
  "#fff3a6", // 3 yellow
  "#b6e8b6", // 4 green
  "#a6d8ff", // 5 blue
  "#c9b6ff", // 6 violet
  "#ffb3e6", // 7 pink
] as const;

/**
 * Map geometry lives in worldMap.ts (the single source of truth for bounds,
 * spawn, furniture and collision). Re-exported here so existing importers of
 * `@caysonverse/shared/constants` keep working; there is still ONE definition.
 */
export {
  WORLD_BOUNDS,
  SPAWN_POINT,
  SPAWN_JITTER,
  PLAYER_RADIUS,
} from "./worldMap";
