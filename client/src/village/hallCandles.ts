import { useSyncExternalStore } from "react";
import { CANDLE_BURN_MS, VillageServerMsg, type CandleLitPayload } from "@caysonverse/shared/village/messages";

/**
 * The candles burning in the memorial hall (케이슨 마을 Task 9), as this client sees them. The server stores nothing: a
 * `CandleLit { cubby, by }` reaches everyone in the hall, and each client lets that candle burn for `CANDLE_BURN_MS`
 * (60 s) from the moment it heard it. Lighting it again in the meantime starts the 60 s over.
 *
 * Module state like villageArea.ts: the hall's scene reads `burningCandles` every frame (no React), the close-up card
 * through `useCandles` (re-rendered when a candle is lit or goes out). Cleared when the hall is left.
 */

/** The time base (ms): the page's monotonic clock. */
export const candleClock = (): number => performance.now();

const lit = new Map<string, { at: number; by: string }>();
const listeners = new Set<() => void>();
let version = 0;

function bump(): void {
  version += 1;
  for (const l of [...listeners]) l();
}

/** Someone lit the candle of `cubby` (the server said so). */
export function noteCandleLit(cubby: string, by: string, now: number = candleClock()): void {
  lit.set(cubby, { at: now, by });
  bump();
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
  return room.onMessage<CandleLitPayload>(VillageServerMsg.CandleLit, (m) => {
    if (m && typeof m.cubby === "string" && m.cubby.length > 0) noteCandleLit(m.cubby, typeof m.by === "string" ? m.by : "");
  });
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
