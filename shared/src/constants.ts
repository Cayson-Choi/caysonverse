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

/**
 * Matchmaking name of 케이슨 마을 (the open countryside village). Unlike the world, the village is NOT a
 * pre-created singleton: clients `joinOrCreate` it and a full room spills into a new shard.
 */
export const VILLAGE_ROOM = "village";

/** Max clients in one village room (a shard): the 31st visitor gets a new room. */
export const VILLAGE_MAX_CLIENTS = 30;

/** State broadcast interval in milliseconds (10Hz). */
export const PATCH_RATE_MS = 100;

/** Maximum walk speed in meters/second. */
export const MOVE_SPEED = 4;

/** Displacement clamp multiplier — tolerated overshoot over the ideal step. */
export const MOVE_SPEED_SLACK = 1.5;

/** Run speed as a multiple of the walk speed (Shift held; controls-ux §5). */
export const RUN_SPEED_MULTIPLIER = 1.6;

/**
 * Maximum run speed in meters/second (`MOVE_SPEED * RUN_SPEED_MULTIPLIER` = 6.4).
 * The client never reports walk/run state, so the server's move budget is sized
 * for the fastest legal gait.
 */
export const RUN_SPEED = MOVE_SPEED * RUN_SPEED_MULTIPLIER;

/** Per-client move-message rate cap (messages per second). */
export const MOVE_MAX_MSGS_PER_SEC = 30;

/**
 * Floor for the elapsed-time budget used in move displacement validation.
 * Prevents a burst of messages (elapsed ~= 0) from collapsing the allowed
 * step to zero and dropping otherwise-legal tiny moves. See MOVEMENT spec.
 */
export const MOVE_ELAPSED_FLOOR_MS = 10;

/**
 * Ceiling (ms) for the elapsed-time budget in move displacement validation
 * (anti-teleport, final-review D1). `elapsed = now - lastAcceptedAt` is
 * client-influenceable and otherwise UNBOUNDED: a client that idles/reconnects
 * then sends one move would accumulate a world-spanning single-step budget
 * (`RUN_SPEED * elapsed/1000 * slack`), letting it jump to any open-floor point
 * in one message despite the bounds clamp. Capping elapsed at a few patch
 * intervals bounds one post-idle move to ~RUN_SPEED × 0.5 × 1.5 ≈ 4.8 m while
 * staying well above any legitimate resume-after-hiccup step (moves flow at 10 Hz
 * = PATCH_RATE_MS). The room applies `Math.min(elapsed, this)` BEFORE the floor.
 */
export const MOVE_ELAPSED_CEIL_MS = 500;

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

// ── Jump + typing events (controls-ux Task 2) — broadcast events, not state. ──

/**
 * Per-client jump rate cap: at most `count` accepted jumps per `windowMs`. 0.8 s
 * (owner request: a 1 m hop needs air time to read as a jump, not a twitch).
 */
export const JUMP_RATE = { count: 1, windowMs: 800 } as const;

/**
 * How long (ms) a jump lasts on an avatar (the client's jump animation window).
 * Equals `JUMP_RATE.windowMs`, so two accepted jumps never overlap.
 */
export const JUMP_DURATION_MS = 800;

/**
 * Per-client "typing" ON cap: at most `count` accepted ONs per `windowMs`. The OFF
 * is never limited (it must always get through to clear the indicator).
 */
export const TYPING_RATE = { count: 1, windowMs: 3000 } as const;

/**
 * Safety TTL (ms) for the "…" typing indicator on the receiving side: if the OFF
 * is lost (disconnect, dropped packet) the indicator expires on its own.
 */
export const TYPING_TTL_MS = 5000;

// ── Roles (controls-ux Task 3) — synced as `Player.role` (uint8). ──

/** `Player.role` for an ordinary participant (the schema default). */
export const ROLE_STUDENT = 0;

/**
 * `Player.role` for the teacher. The server writes it ONLY when the join's admin
 * code authenticated (WorldRoom.onJoin); join options and client messages can
 * never set it. The `isAdmin` marker itself stays server-only.
 */
export const ROLE_TEACHER = 1;

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
 *
 * Deliberately OUTSIDE the codes Colyseus sends itself (CONSENTED 4000,
 * SERVER_SHUTDOWN 4001, WITH_ERROR 4002, FAILED_TO_RECONNECT 4003, MAY_TRY_RECONNECT
 * 4010): it used to be 4001, so a server restart (every client closed with 4001)
 * looked like a kick and nobody reconnected (ruling E3).
 */
export const KICK_CLOSE_CODE = 4101;

/**
 * Reconnection grace window in SECONDS. On an unexpected drop the server marks
 * the player `connected = false` and calls `allowReconnection(client, this)`;
 * the client has this long to re-establish the SAME session (same avatar and
 * position) before the server removes the player permanently. Kicks (KICK_CLOSE_CODE) and
 * consented leaves bypass this window entirely (immediate removal). Shared so the
 * server window and the client's transient-reconnect budget agree on one value.
 */
export const RECONNECT_WINDOW_S = 20;

/**
 * Player appearance (15 uint8 fields) lives in appearance.ts — the single source
 * for field order and ranges. Re-exported here so the server schema and the client
 * can keep reading their limits from `constants`; there is still ONE definition.
 */
export { APPEARANCE_FIELDS, APPEARANCE_RANGES } from "./appearance";

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
