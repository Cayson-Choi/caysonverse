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

// ── Chat (Task 7) — one auditable place for every chat limit. ──

/** Maximum chat message length in characters, counted after trimming. */
export const CHAT_MAX_LENGTH = 200;

/** Per-client chat rate cap: at most `count` accepted messages per `windowMs`. */
export const CHAT_RATE = { count: 3, windowMs: 5000 } as const;

/** How long (ms) a speech bubble stays visible above its author before removal. */
export const SPEECH_BUBBLE_MS = 6000;

/** Cap on concurrently visible speech bubbles; oldest beyond this are hidden. */
export const MAX_VISIBLE_BUBBLES = 30;

/** Cap on retained chat-log rows (session-only; oldest beyond this are dropped). */
export const MAX_CHAT_LOG = 100;

// ── Emoji reactions (Task 8) — one auditable place for every emoji limit. ──

/** The six selectable reactions (index matches the client palette and shortcuts 1-6). */
export const EMOJIS = ["👍", "❤️", "😂", "👏", "🎉", "🙋"] as const;

/** Per-client emoji rate cap: at most `count` accepted reactions per `windowMs`. */
export const EMOJI_RATE = { count: 1, windowMs: 500 } as const;

/** How long (ms) an emoji reaction floats above its sender before removal. */
export const EMOJI_DISPLAY_MS = 3000;

// ── Admin: announce banner + kick (Task 9). ──

/**
 * Maximum announcement banner length in characters, counted after trimming.
 * Larger than CHAT_MAX_LENGTH because a notice may carry more than one line of
 * instruction. Parameterizes the shared chat sanitizer (see server chat.ts).
 */
export const ANNOUNCE_MAX_LENGTH = 300;

/**
 * WebSocket close code the server uses when an admin KICKS a client. In the
 * application-reserved 4000–4999 range so the SDK delivers it verbatim to
 * `room.onLeave(code)`. The client maps exactly this code to the kicked UX
 * (entry screen + Korean notice + no auto-reconnect); every other code is an
 * ordinary disconnect. Shared so client and server agree on one value.
 */
export const KICK_CLOSE_CODE = 4001;

/**
 * Reconnection grace window in SECONDS. On an unexpected drop the server marks
 * the player `connected = false` and calls `allowReconnection(client, this)`;
 * the client has this long to re-establish the SAME session (same avatar and
 * position) before the server removes the player permanently. Kicks (4001) and
 * consented leaves bypass this window entirely (immediate removal). Shared so the
 * server window and the client's transient-reconnect budget agree on one value.
 */
export const RECONNECT_WINDOW_S = 20;

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
