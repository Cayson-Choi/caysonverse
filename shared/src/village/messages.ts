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
   * Light a candle in a memorial cubby (Task 9). The server checks that the sender is in the hall and within
   * `CANDLE_REACH_M` (on the ground) of that cubby's anchor, and a 1-per-5-seconds rate, then tells everyone in the hall
   * (`VillageServerMsg.CandleLit`). Nothing is stored. Anything else is dropped silently.
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
  /** Submit a house keypad code. The server validates the claimed house against the authoritative player position. */
  Keypad: "Keypad",
} as const;

export type VillageMsg = (typeof VillageMsg)[keyof typeof VillageMsg];

/** Client → server: use the door at hand. Carries no data (the server never reads it). */
export type UseDoorPayload = Record<string, never>;

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
}

/** Fishing actions carry no client-controlled state; the server reads its own player pose and clock. */
export type FishingEmptyPayload = Record<string, never>;
export interface FishingSitPayload {
  spot: number | string;
}
export interface FishingHoldPayload {
  down: boolean;
}

/** How far (m, on the ground plane) from a cubby's anchor a visitor may light its candle. */
export const CANDLE_REACH_M = 1.5;
/** Per-client candle cap: at most `count` accepted candles per `windowMs`. */
export const CANDLE_RATE = { count: 1, windowMs: 5000 } as const;
/** How long a lit candle burns in everyone's hall (ms). Clients keep the time; the server stores nothing. */
export const CANDLE_BURN_MS = 60_000;

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
} as const;

export type VillageServerMsg = (typeof VillageServerMsg)[keyof typeof VillageServerMsg];

/** Server → client: the server's `Date.now()` at the moment of sending (Unix epoch milliseconds, UTC). */
export interface ServerTimePayload {
  serverTimeMs: number;
}

/** How often the server re-sends its clock to everyone in a village room (5 minutes). */
export const SERVER_TIME_INTERVAL_MS = 5 * 60 * 1000;

/** Server → hall clients: the cubby whose candle was lit and who lit it (their nickname). */
export interface CandleLitPayload {
  cubby: string;
  by: string;
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
  /** In `fighting`: the progress of the hold (ms), what it needs (ms) and whether the server counts the button as down. */
  holdMs: number;
  holdNeedMs: number;
  holdDown: boolean;
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

export type KeypadResultReason = "invalid_request" | "too_far" | "locked_out" | "rate_limited" | "invalid_code" | "wrong_code";

export interface KeypadResultPayload {
  ok: boolean;
  buildingId: string;
  reason?: KeypadResultReason;
  retryAfterMs?: number;
  /** True while the house interior GLB is pending; the server uses the existing hall boundary as a placeholder. */
  placeholder?: boolean;
  area?: string;
}
