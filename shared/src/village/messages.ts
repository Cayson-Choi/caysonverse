/**
 * 케이슨 마을 room messages — browser-safe (values and types only), shared by the server and the client.
 * The shared player messages stay in ../messages.ts; a village
 * client also hears Move/Chat/Emoji/Jump/Typing (VillageRoom is a PlayerRoom), so a value here
 * must never equal one of those (a test pins it).
 */

import type { FishCatch, FishingEvent, FishingPhase, FishingReject, FishingState } from "./fishing";

/** VillageRoom messages (client → server). */
export const VillageMsg = {
  /**
   * The sender uses the door they stand at: the memorial hall's front door from the village, or the way
   * out from inside. The server checks the distance to the door pad (pad radius + a small reach) and a
   * 1-per-second rate, moves the player to the other side and flips `Player.area`. Anything else is
   * dropped silently.
   */
  UseDoor: "UseDoor",
  /**
   * Light a candle in a memorial cubby (Task 9; server-kept since 2026-11-14). The server checks that the sender is in the hall
   * (`CANDLE_REACH_M` covers the whole room: a cubby is looked at from anywhere through its close-up), that the cubby's candle is
   * not already burning, and a 1-per-5-seconds rate; then it keeps the candle for `CANDLE_BURN_MS` and tells everyone in the
   * hall, in every room of the village (`VillageServerMsg.CandleLit`). Anything else is dropped silently.
   */
  LightCandle: "LightCandle",
  /** Ask the server to rent the session's one fishing rod at the lakeside kiosk. */
  FishingRentRod: "FishingRentRod",
  /** Cast the session's rented line at the pond. */
  FishingCast: "FishingCast",
  /** Pull the line; only a server-observed submerged bobber can catch a fish. */
  FishingReel: "FishingReel",
  /**
   * The sender uses the stair of the house floor they stand on: floor 1's up pad → floor 2, floor 2's down pad → floor 1 (집 실내 G).
   * Like `UseDoor` the server decides from the authoritative position, area and sitting state, at most once a second; anything else is
   * dropped silently. (The way out of a house is `UseDoor` too.)
   */
  UseStair: "UseStair",
  /** Submit a house keypad code. The server validates the claimed house against the authoritative player position. */
  Keypad: "Keypad",
} as const;

export type VillageMsg = (typeof VillageMsg)[keyof typeof VillageMsg];

/** Client → server: use the door at hand. Carries no data (the server never reads it). */
export type UseDoorPayload = Record<string, never> | { loadFailed: true };

/** Client → server: use the stair at hand. Carries no data (the server never reads it). */
export type UseStairPayload = Record<string, never>;

/** Client → server: light a candle in this cubby (a `cubbyAnchors` id, `<wall>_<row>_<col>`). */
export interface LightCandlePayload {
  cubby: string;
}

/** Client → server: a house id and the digits currently entered on its keypad. */
export interface KeypadPayload {
  buildingId: string;
  code: string;
}

/** Payload type for each VillageMsg value. */
export interface VillageMsgPayloads {
  [VillageMsg.UseDoor]: UseDoorPayload;
  [VillageMsg.UseStair]: UseStairPayload;
  [VillageMsg.LightCandle]: LightCandlePayload;
  [VillageMsg.FishingRentRod]: FishingEmptyPayload;
  [VillageMsg.FishingCast]: FishingEmptyPayload;
  [VillageMsg.FishingReel]: FishingEmptyPayload;
  [VillageMsg.Keypad]: KeypadPayload;
}

/** Fishing actions carry no client-controlled state; the server reads its own player pose and clock. */
export type FishingEmptyPayload = Record<string, never>;

/**
 * How far (m, on the ground plane) from a cubby's anchor a visitor may light its candle: the whole hall (15 x 12 m, so 20 m) —
 * the close-up opens on any cubby from anywhere in the room (owner 2026-11-13: the top rows as well), and its button must work.
 */
export const CANDLE_REACH_M = 20;
/** Per-client candle cap: at most `count` accepted candles per `windowMs`. */
export const CANDLE_RATE = { count: 1, windowMs: 5000 } as const;
/**
 * How long a lit candle burns (ms): an hour (owner 2026-11-13: "초를 켜면 1시간 정도 켜졌다가 꺼지게 … 누가 와서 켜고 갔는지 알잖아").
 * The server keeps it (who, when) and tells a visitor who walks into the hall later; a cubby's candle cannot be lit again while
 * it burns.
 */
export const CANDLE_BURN_MS = 60 * 60_000;

/** VillageRoom messages (server → client). */
export const VillageServerMsg = {
  /**
   * The server's wall clock (Task 7A: the village's day and night follow real Korean time). Sent to a visitor
   * when they join and to everyone every `SERVER_TIME_INTERVAL_MS`; the client keeps `serverTimeMs - Date.now()`
   * as its offset, so a wrong clock on the device cannot change the time of day it shows.
   */
  ServerTime: "ServerTime",
  /** Someone lit a candle (Task 9): sent to every client in the hall, the lighter included. */
  CandleLit: "CandleLit",
  /** Every candle burning now (`CandleStatePayload`): sent to a visitor who comes into the hall, or rejoins inside it. */
  CandleState: "CandleState",
  /** The owner's session-local fishing state, including bobber phase and the latest catch. */
  FishingState: "FishingState",
  /** A fishing transition (cast, bite, missed or caught) for the owner's UI. */
  FishingResult: "FishingResult",
  /** A personal rejection for an invalid/out-of-reach fishing action. */
  FishingRejected: "FishingRejected",
  /** Result of a house keypad attempt; the expected code is never sent. */
  KeypadResult: "KeypadResult",
} as const;

export type VillageServerMsg = (typeof VillageServerMsg)[keyof typeof VillageServerMsg];

/** Server → client: the server's `Date.now()` at the moment of sending (Unix epoch milliseconds, UTC). */
export interface ServerTimePayload {
  serverTimeMs: number;
}

/** How often the server re-sends its clock to everyone in a village room (5 minutes). */
export const SERVER_TIME_INTERVAL_MS = 5 * 60 * 1000;

/** Server → hall clients: the cubby whose candle was lit, who lit it (their nickname) and how long ago (ms; 0 for a new one). */
export interface CandleLitPayload {
  cubby: string;
  by: string;
  agoMs: number;
}

/** Server → one client: the candles burning now. */
export interface CandleStatePayload {
  candles: CandleLitPayload[];
}

/** Wire-safe state projection. Bite timestamps stay server-only; `serverNowMs` is for UI countdown/animation only. */
export interface FishingStatePayload {
  phase: FishingPhase;
  rodRented: boolean;
  castId: number;
  lastResult: FishingState["lastResult"];
  catch: FishCatch | null;
  serverNowMs: number;
}

export interface FishingResultPayload extends FishingStatePayload {
  event: Exclude<FishingEvent, "rod_rented">;
}

export interface FishingRejectedPayload {
  reason: FishingReject;
}

export type KeypadResultReason =
  | "invalid_request"
  | "too_far"
  | "locked_out"
  | "rate_limited"
  | "invalid_code"
  | "wrong_code"
  /** The house has no interior yet (its door stays locked). */
  | "not_ready"
  /** Eight players are already inside (both floors together): "집이 가득 찼어요". */
  | "full"
  /** Sitting or riding the bus: the keypad does nothing. */
  | "busy";

export interface KeypadResultPayload {
  ok: boolean;
  buildingId: string;
  reason?: KeypadResultReason;
  retryAfterMs?: number;
  area?: string;
}
