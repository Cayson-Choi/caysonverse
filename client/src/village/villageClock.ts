/**
 * The village's clock (Task 7A): what time it is in 케이슨 마을, for the sun.
 *
 * The owner: "실제 한국 시간과 같게 해야지". The time of day comes from the SERVER, not from the device: a phone whose
 * clock is an hour (or a day) off would otherwise show the village at the wrong time of day. The server sends its
 * `Date.now()` when a visitor joins and every 5 minutes (shared/village/messages.ts `ServerTime`); the client keeps
 * the offset `serverTimeMs - Date.now()` at that moment and reads the time as `Date.now() + offset` from then on.
 * A device clock that is 3 h wrong therefore changes nothing; a device clock that jumps between two messages is
 * corrected by the next one. Before the first message (the connection is still arriving) the offset is 0.
 *
 * DEV only: `?time=2026-06-21T20:30` (Korean time unless the text names a zone, sunClock.ts `parseKstTime`) freezes the
 * village at that moment, for looking at dawn, dusk and night without waiting for them. Absent in production builds.
 */

import { VillageServerMsg, type ServerTimePayload } from "@caysonverse/shared/village/messages";
import { parseKstTime } from "@caysonverse/shared/village/sunClock";

/** The slice of a Colyseus room this binding uses. */
export interface ClockRoom {
  onMessage<T = unknown>(type: string, callback: (message: T) => void): () => void;
}

/** The device clock, as a seam for tests. */
export type Now = () => number;

export interface VillageClock {
  /** The village's wall clock now (Unix epoch ms, UTC): the device clock plus the server's offset, or the DEV pin. */
  nowMs(): number;
  /** The same wall clock WITHOUT the DEV pin: what the bus and the crosswalk signals run on (the bus is driven by the server's clock). */
  liveMs(): number;
  /** The server told us its time `serverTimeMs`; the device clock read `deviceNowMs` just then (default: now). */
  sync(serverTimeMs: number, deviceNowMs?: number): void;
  /** Ms the server's clock is ahead of the device's (negative: behind); 0 before the first sync. */
  offsetMs(): number;
  /** Counts the syncs that moved the offset by more than a second (a consumer that must not ease across a jump). */
  jumps(): number;
  /** Pin the clock to an instant (DEV `?time=`), or release it with null. */
  pin(utcMs: number | null): void;
  /** Whether a sync has arrived yet. */
  synced(): boolean;
}

/** A clock on the device's own `now` (a test passes a fake). */
export function createVillageClock(now: Now = Date.now): VillageClock {
  let offset = 0;
  let isSynced = false;
  let jumpCount = 0;
  let pinned: number | null = null;
  return {
    nowMs: () => (pinned !== null ? pinned : now() + offset),
    liveMs: () => now() + offset,
    sync(serverTimeMs, deviceNowMs = now()) {
      if (!Number.isFinite(serverTimeMs)) return;
      const next = serverTimeMs - deviceNowMs;
      if (Math.abs(next - offset) > 1000) jumpCount++;
      offset = next;
      isSynced = true;
    },
    offsetMs: () => offset,
    jumps: () => jumpCount,
    pin(utcMs) {
      pinned = utcMs;
    },
    synced: () => isSynced,
  };
}

/** The game's one village clock. */
export const villageClock: VillageClock = createVillageClock();

/** The DEV pin from a page address (`?time=...`), or null (also null for text that is not a date-time). */
export function pinFromSearch(search: string): number | null {
  const text = new URLSearchParams(search).get("time");
  return text ? parseKstTime(text) : null;
}

if (import.meta.env.DEV && typeof location !== "undefined") {
  const pin = pinFromSearch(location.search);
  if (pin !== null) villageClock.pin(pin);
}

/**
 * Listen for the server's clock on a village room. Called by the connection layer the moment the room exists
 * (resilience.ts `attachResilience`), before anything awaits: the server sends the first message right after the join
 * and the SDK drops a message that has no handler yet. Returns the unbind.
 */
export function bindVillageClock(room: ClockRoom, clock: VillageClock = villageClock): () => void {
  return room.onMessage<ServerTimePayload>(VillageServerMsg.ServerTime, (m) => {
    if (m && typeof m.serverTimeMs === "number") clock.sync(m.serverTimeMs);
  });
}
