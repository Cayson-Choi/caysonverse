// The lake's line to the room: sending the intents (design 9.3: no positions, no times, no results), reading every angler's
// schema fields (9.4) and the personal messages. Nothing here is predicted: a phase is whatever the server last said.
//
// DEV only: `window.__cvLake` lets a test play the server's part (a mocked room) for what D2's rules do not yet send.

import { getRoom } from "../net/connection";
import { transitNowMs } from "../net/transitSync";
import { LAKE_FISHING_SPOTS } from "@caysonverse/shared/village/lakeLayout";
import { LakeMsg, LakeServerMsg, emptyFishView, parseBoard, parsePersonalState, parseTrophy, rejectText, type BoardLine, type FishView, type PersonalFishingState, type TrophyPayload } from "./lakeProtocol";

interface PlayerLike {
  rod?: number;
  fishSpot?: number;
  fishPhase?: number;
  fishSeq?: number;
  fishSig?: number;
  fishKind?: number;
  fishCm?: number;
  fishAt?: number;
  fishReel?: number;
}
interface RoomLike {
  sessionId: string;
  state?: { players?: { get?(sid: string): PlayerLike | undefined } };
  send(type: string, payload?: unknown): void;
  onMessage(type: string, cb: (payload: unknown) => void): () => void;
}

const room = (): RoomLike | null => getRoom() as unknown as RoomLike | null;

/** DEV mock: a view per session id replaces the schema's (set by __cvLake). */
const mockViews = new Map<string, FishView>();
let mockPersonal: ((s: PersonalFishingState) => void) | null = null;

/** The room's clock as the fishAt field counts it: Unix ms in 32 bits. */
export function roomClock32(): number {
  return Math.floor(transitNowMs()) >>> 0;
}

/** Milliseconds since a phase began (fishAt on the room clock); 0 when the stamp is unset or still ahead. */
export function elapsedSince(at: number): number {
  if (!at) return 0;
  const d = (roomClock32() - (at >>> 0)) >>> 0;
  return d > 0x7fffffff ? 0 : d;
}

/** Fill `out` with one angler's fishing fields (the schema's, or the DEV mock's). False when the player is unknown. */
export function readFishView(sid: string, out: FishView): boolean {
  const mock = mockViews.get(sid);
  if (mock) {
    Object.assign(out, mock);
    return true;
  }
  const p = room()?.state?.players?.get?.(sid);
  if (!p) return false;
  out.rod = p.rod ?? 0;
  out.spot = p.fishSpot ?? -1;
  out.phase = p.fishPhase ?? 0;
  out.seq = p.fishSeq ?? 0;
  out.sig = p.fishSig ?? 0;
  out.kind = p.fishKind ?? 0;
  out.cm = p.fishCm ?? 0;
  out.at = p.fishAt ?? 0;
  out.reel = p.fishReel ?? 0;
  return true;
}

/** Everyone who has a rod or a spot: the session ids to draw floats for. Cheap enough for 30 players each frame. */
export function forEachAngler(fn: (sid: string, view: FishView) => void): void {
  const r = room();
  const scratch = emptyFishView();
  const seen = new Set<string>();
  const players = r?.state?.players as unknown as { forEach?: (cb: (p: PlayerLike, sid: string) => void) => void } | undefined;
  players?.forEach?.((_p, sid) => {
    seen.add(sid);
    if (readFishView(sid, scratch) && scratch.rod > 0) fn(sid, scratch);
  });
  for (const sid of mockViews.keys()) {
    if (seen.has(sid)) continue;
    if (readFishView(sid, scratch) && scratch.rod > 0) fn(sid, scratch);
  }
}

export function selfId(): string {
  return room()?.sessionId ?? "";
}

const send = (type: string, payload: unknown = {}): void => {
  if (import.meta.env.DEV && mockSend) {
    mockSend(type, payload);
    return;
  }
  room()?.send(type, payload);
};
let mockSend: ((type: string, payload: unknown) => void) | null = null;

export const sendRentRod = (): void => send(LakeMsg.RentRod);
export const sendReturnRod = (): void => send(LakeMsg.ReturnRod);
export const sendFishSit = (spot: number): void => send(LakeMsg.Sit, { spot });
export const sendCast = (): void => send(LakeMsg.Cast);
export const sendStrike = (): void => send(LakeMsg.Strike);
export const sendStand = (): void => send(LakeMsg.Stand);
export const sendBoardRequest = (): void => send(LakeMsg.BoardRequest);

/** The hold: sent when it goes down or up, and repeated while down so the server's 1.5 s lapse never cuts a real hold (9.2). */
let holdTimer: ReturnType<typeof setInterval> | null = null;
export const HOLD_REPEAT_MS = 500;
export function sendHold(down: boolean): void {
  if (holdTimer) {
    clearInterval(holdTimer);
    holdTimer = null;
  }
  send(LakeMsg.Hold, { down });
  if (down) holdTimer = setInterval(() => send(LakeMsg.Hold, { down: true }), HOLD_REPEAT_MS);
}

export interface LakeNetListeners {
  state(s: PersonalFishingState): void;
  rejected(text: string): void;
  trophy(t: TrophyPayload): void;
  /** "오늘의 대어" (sent on joining and on request). */
  board?(lines: BoardLine[]): void;
}

/** Subscribe to the personal and room messages of this room. Returns the unsubscribe. */
export function listenLake(l: LakeNetListeners): () => void {
  const r = room();
  const offs: Array<() => void> = [];
  if (r) {
    offs.push(r.onMessage(LakeServerMsg.State, (p) => {
      const s = parsePersonalState(p);
      if (s) l.state(s);
    }));
    offs.push(r.onMessage(LakeServerMsg.Rejected, (p) => {
      const text = rejectText((p as { reason?: unknown } | null)?.reason);
      if (text) l.rejected(text);
    }));
    offs.push(r.onMessage(LakeServerMsg.Trophy, (p) => {
      const t = parseTrophy(p);
      if (t) l.trophy(t);
    }));
    offs.push(r.onMessage(LakeServerMsg.Board, (p) => {
      const b = parseBoard(p);
      if (b) l.board?.(b);
    }));
  }
  if (import.meta.env.DEV) mockPersonal = l.state;
  const mockHooks = { l };
  mockListeners = mockHooks.l;
  return () => {
    offs.forEach((o) => o());
    if (mockListeners === l) mockListeners = null;
    if (mockPersonal === l.state) mockPersonal = null;
    if (holdTimer) {
      clearInterval(holdTimer);
      holdTimer = null;
    }
  };
}
let mockListeners: LakeNetListeners | null = null;

/** The index into LAKE_FISHING_SPOTS of a spot id ("P03"), or -1. */
export function spotIndex(id: string): number {
  return LAKE_FISHING_SPOTS.findIndex((s) => s.id === id);
}

declare global {
  interface Window {
    /** DEV only: play the server's part for the lake (a mocked room) in e2e. */
    __cvLake?: {
      setView(sid: string, v: Partial<FishView> | null): void;
      personal(s: PersonalFishingState): void;
      trophy(t: TrophyPayload): void;
      reject(reason: string): void;
      onSend(fn: ((type: string, payload: unknown) => void) | null): void;
      sent: Array<{ type: string; payload: unknown }>;
      clock(): number;
    };
  }
}

if (import.meta.env.DEV && typeof window !== "undefined") {
  const sent: Array<{ type: string; payload: unknown }> = [];
  window.__cvLake = {
    sent,
    setView(sid, v) {
      if (v === null) mockViews.delete(sid);
      else mockViews.set(sid, { ...(mockViews.get(sid) ?? emptyFishView()), ...v });
    },
    personal: (s) => mockPersonal?.(s),
    trophy: (t) => mockListeners?.trophy(t),
    reject: (reason) => mockListeners?.rejected(rejectText(reason)),
    onSend(fn) {
      mockSend = fn
        ? (type, payload) => {
            sent.push({ type, payload });
            fn(type, payload);
          }
        : null;
    },
    clock: roomClock32,
  };
}
