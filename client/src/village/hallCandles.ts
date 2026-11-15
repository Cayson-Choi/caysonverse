import { useSyncExternalStore } from "react";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { localArea, subscribeLocalArea } from "./villageArea";
import { CANDLE_BURN_MS, VillageServerMsg, type CandleLitPayload, type CandleStatePayload } from "@caysonverse/shared/village/messages";

/**
 * The candles burning in the memorial hall (케이슨 마을 Task 9), as this client sees them. The server keeps them (an hour each,
 * who lit it: server/src/rooms/candleBook.ts) and tells this client: `CandleState` (all of them, with how long ago each was lit)
 * when it comes into the hall, `CandleLit` for each new one. The client counts the rest of the hour down from what it was told.
 *
 * Module state like villageArea.ts: the hall's scene reads `burningCandles` every frame (no React), the close-up card
 * through `useCandles` (re-rendered when a candle is lit or goes out). Cleared when the hall is left.
 */

/**
 * The candles go out on THIS client when it leaves the hall (the server keeps them, and tells it again on the way back in). Not
 * on the hall scene's unmount: the server's `CandleState` comes with the door, and the hall scene may mount and unmount around
 * that moment (round 3 check: the list was set and wiped 120 ms later).
 */
let lastArea: AreaId = localArea();
subscribeLocalArea(() => {
  const area = localArea();
  if (area === lastArea) return;
  if (lastArea === "hall") clearCandles();
  lastArea = area;
});

/** The time base (ms): the page's monotonic clock. */
export const candleClock = (): number => performance.now();

const lit = new Map<string, { at: number; by: string }>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version += 1;
  for (const l of [...listeners]) l();
}

/** Someone lit the candle of `cubby` `agoMs` ago (the server said so). */
export function noteCandleLit(cubby: string, by: string, now: number = candleClock(), agoMs = 0): void {
  lit.set(cubby, { at: now - Math.max(0, agoMs), by });
  bump();
}

/** The candles burning now, as the server listed them (replaces what this client had). */
export function setCandles(list: readonly CandleLitPayload[], now: number = candleClock()): void {
  lit.clear();
  for (const c of list) if (validCandle(c)) lit.set(c.cubby, { at: now - Math.max(0, c.agoMs || 0), by: typeof c.by === "string" ? c.by : "" });
  bump();
}

function validCandle(m: unknown): m is CandleLitPayload {
  const c = m as CandleLitPayload | null;
  return c !== null && typeof c === "object" && typeof c.cubby === "string" && c.cubby.length > 0;
}

/** Drop the candles that have burnt out by `now`; true when one went out. */
export function pruneCandles(now: number = candleClock()): boolean {
  let gone = false;
  for (const [cubby, c] of lit) {
    if (now - c.at >= CANDLE_BURN_MS) {
      lit.delete(cubby);
      gone = true;
    }
  }
  if (gone) bump();
  return gone;
}

/** Is the candle of `cubby` burning at `now`? */
export function isCandleBurning(cubby: string, now: number = candleClock()): boolean {
  const c = lit.get(cubby);
  return c !== undefined && now - c.at < CANDLE_BURN_MS;
}

/** The candles burning at `now` (cubby id → when it was lit, by whom). Read-only view; prune first to drop the old ones. */
export function burningCandles(): ReadonlyMap<string, { at: number; by: string }> {
  return lit;
}

/** Put every candle out (the hall was left, a new connection). */
export function clearCandles(): void {
  if (lit.size === 0) return;
  lit.clear();
  bump();
}

export function subscribeCandles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: a number that changes whenever a candle is lit or goes out. */
export function useCandles(): number {
  return useSyncExternalStore(subscribeCandles, () => version, () => version);
}

/** What `bindHallCandles` needs of a room. */
export interface CandleRoom {
  onMessage<T>(type: string, callback: (message: T) => void): () => void;
}

/**
 * Listen for `CandleLit` on a village room (resilience.ts binds it the moment the room exists, as the clock is: the SDK
 * warns about a message nobody listens for). A malformed message is ignored. Returns the unbind.
 */
export function bindHallCandles(room: CandleRoom): () => void {
  const offLit = room.onMessage<CandleLitPayload>(VillageServerMsg.CandleLit, (m) => {
    if (validCandle(m)) noteCandleLit(m.cubby, typeof m.by === "string" ? m.by : "", candleClock(), Number.isFinite(m.agoMs) ? m.agoMs : 0);
  });
  const offState = room.onMessage<CandleStatePayload>(VillageServerMsg.CandleState, (m) => {
    if (m && Array.isArray(m.candles)) setCandles(m.candles);
  });
  return () => {
    offLit();
    offState();
  };
}

/** The slice of an InstancedMesh `showInstances` touches. */
export interface CountedMesh {
  count: number;
  visible: boolean;
  instanceMatrix: { needsUpdate: boolean };
}

/**
 * Draw the first `n` instances of a candle mesh; with none it is hidden (`visible = false`, final fix: a count-0 mesh
 * still costs a scene-graph pass and a program switch), and its matrices are only re-uploaded while some burn.
 */
export function showInstances(mesh: CountedMesh, n: number): void {
  const was = mesh.count;
  mesh.count = n;
  mesh.visible = n > 0;
  if (n > 0 || was > 0) mesh.instanceMatrix.needsUpdate = true;
}
