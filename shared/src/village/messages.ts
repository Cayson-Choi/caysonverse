/**
 * 케이슨 마을 room messages — browser-safe (values and types only), shared by the server and the client.
 * The shared player messages stay in ../messages.ts; a village
 * client also hears Move/Chat/Emoji/Jump/Typing (VillageRoom is a PlayerRoom), so a value here
 * must never equal one of those (a test pins it).
 */

import type { FishDisposal, FishKind, FishSignal, FishingAction, FishingPhase, FishingReject, FishingResultKind, TrophyTier } from "./fishing";

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
  /** Rent the session's one rod (free) within `FISHING.rentReachM` of the rental pad. Empty payload. */
  FishingRentRod: "FishingRentRod",
  /** Give the rod back within `FISHING.returnReachM` of the pad (standing); leaving the lake does it by itself. Empty payload. */
  FishingReturnRod: "FishingReturnRod",
  /** Sit on a fishing chair: `{ spot }` = index into LAKE_FISHING_SPOTS (or its id, "P01"). Same checks as Sit (front/side only). */
  FishingSit: "FishingSit",
  /** Cast the line (seated, rod, stage `ready`; at least 1.5 s since the last cast). Empty payload. */
  FishingCast: "FishingCast",
  /** The pull. Honoured only in the bite window (+ grace); during the nibble it is ignored without penalty. Empty payload. */
  FishingStrike: "FishingStrike",
  /** The big-fish button: `{ down: true }` while pressed (repeat it every <= 500 ms; one counts 1.5 s), `{ down: false }` on release. */
  FishingHold: "FishingHold",
  /** Stand up from the fishing chair (the same as Stand; the line comes out). Empty payload. */
  FishingStand: "FishingStand",
  /** Ask for the "오늘의 대어" board (it is also sent on join and, to the people at the lake, whenever it changes). Empty payload. */
  FishingBoardRequest: "FishingBoardRequest",
  /**
   * The sender uses the stair of the house floor they stand on: floor 1's up pad → floor 2, floor 2's down pad → floor 1 (집 실내 G).
   * Like `UseDoor` the server decides from the authoritative position, area and sitting state, at most once a second; anything else is
   * dropped silently. (The way out of a house is `UseDoor` too.)
   */
  UseStair: "UseStair",
  /** Submit a house keypad code. The server validates the claimed house against the authoritative player position. */
  Keypad: "Keypad",
  /** Get on the roller coaster (케이슨랜드 별똥별 급행): the server picks the lowest free seat while the station is boarding. Empty payload. */
  RideBoard: "RideBoard",
  /** Get off (the server also unloads everyone itself when the train is back). Empty payload. */
  RideLeave: "RideLeave",
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
  [VillageMsg.FishingReturnRod]: FishingEmptyPayload;
  [VillageMsg.FishingSit]: FishingSitPayload;
  [VillageMsg.FishingCast]: FishingEmptyPayload;
  [VillageMsg.FishingStrike]: FishingEmptyPayload;
  [VillageMsg.FishingHold]: FishingHoldPayload;
  [VillageMsg.FishingStand]: FishingEmptyPayload;
  [VillageMsg.FishingBoardRequest]: FishingEmptyPayload;
  [VillageMsg.Keypad]: KeypadPayload;
  [VillageMsg.RideBoard]: RideBoardPayload;
  [VillageMsg.RideLeave]: Record<string, never>;
}

/** Fishing actions carry no client-controlled state; the server reads its own player pose and clock. */
export type FishingEmptyPayload = Record<string, never>;
export interface FishingSitPayload {
  spot: number | string;
}
export interface FishingHoldPayload {
  down: boolean;
}

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
  /** The owner's fishing state (a personal message): sent on every stage change, on join/reconnect, and ~4 times a second in a fight. */
  FishingState: "FishingState",
  /** A personal rejection for an invalid fishing action (a reason code; the HUD turns it into a short Korean line). */
  FishingRejected: "FishingRejected",
  /** A big catch, to the people it concerns: the whole lake (`tier: "lake"`) or the whole village (`tier: "village"`). */
  FishingTrophy: "FishingTrophy",
  /** "오늘의 대어": the best 5 of each species since 04:00 Korean time (or the server's start). Personal. */
  FishingBoard: "FishingBoard",
  /** Result of a house keypad attempt; the expected code is never sent. */
  KeypadResult: "KeypadResult",
  /** Why a RideBoard was refused: { reason: "closed" | "full" | "busy" }. */
  RideNotice: "RideNotice",
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

/**
 * The owner's fishing state (`VillageServerMsg.FishingState`). Secret plan times (the bite, the fish before `hooked`) are never
 * in it; `phase` is the name of `Player.fishPhase`, `phaseAt` the same ms as `Player.fishAt` (the server's clock `now()`, which
 * is `ServerTime.serverTimeMs` = Unix ms, so `serverNowMs - phaseAt` is how long the stage has lasted).
 */
export interface FishingStatePayload {
  rod: boolean;
  /** Index into LAKE_FISHING_SPOTS of the chair, -1 none. */
  spot: number;
  phase: FishingPhase;
  /** Cast number (= `Player.fishSeq`). */
  seq: number;
  phaseAt: number;
  serverNowMs: number;
  /** In `bite`: the signal, and when the strike window opens and closes (ms from `serverNowMs`; the grace is not included). */
  signal: FishSignal | null;
  windowOpensInMs: number | null;
  windowClosesInMs: number | null;
  /** In `fighting`: how close the fish is (holdMs of holdNeedMs = 1000: 0..1000) and whether the server counts the button as down. */
  holdMs: number;
  holdNeedMs: number;
  holdDown: boolean;
  /** In `fighting`: the line tension 0..1000 (snaps at 1000). */
  fightTension?: number;
  /** After a lost fight: why ("snap" the line broke, "escape" it was never pulled in, "idle"). */
  lostWhy?: "none" | "snap" | "escape" | "idle";
  lastResult: FishingResultKind;
  /** The fish, from `hooked` on (a landed or released fish stays until the next stage `ready`). */
  catch: FishCatchPayload | null;
  /** What caused this message ("rod_rented", "cast", ...) or null for a stage change / a refresh. */
  action: FishingAction | null;
}

export interface FishCatchPayload {
  kind: FishKind;
  label: string;
  cm: number;
  needsNet: boolean;
  disposal: FishDisposal;
  tier: TrophyTier;
}

export interface FishingRejectedPayload {
  reason: FishingReject;
}

export interface FishingTrophyPayload {
  /** The catcher's session id and nickname. */
  sid: string;
  by: string;
  kind: FishKind;
  label: string;
  cm: number;
  tier: Exclude<TrophyTier, "none">;
}

export interface FishingBoardEntry {
  kind: FishKind;
  label: string;
  cm: number;
  by: string;
  /** Unix ms of the catch. */
  at: number;
}

export interface FishingBoardPayload {
  /** The board day (Korean 04:00 to 04:00); the entries are grouped by species, biggest first, at most 5 each. */
  day: number;
  entries: FishingBoardEntry[];
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

/** Server → client: a RideBoard was refused. */
export interface RideNoticePayload {
  reason: "closed" | "full" | "busy" | "aloft" | "reserved" | "far";
}

/** Client → server: get on the ride `ride` ("coaster" | "carousel" | "wheel"; absent = the coaster, an older client). */
export interface RideBoardPayload {
  ride?: string;
}
