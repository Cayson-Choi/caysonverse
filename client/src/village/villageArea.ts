/**
 * Which of 케이슨 마을's two areas the local player is in (Task 4): the open village or the memorial hall's
 * interior. The truth is the server's `Player.area` of OUR player; `startRemoteSync` copies it into this store
 * (through `areaGate`) as it syncs, and everything on the client that depends on the area reads it from here:
 * the scene (which ground and maps to show), the map bounds (activeMap.ts), the remote-player filter, the door
 * target, the quiet-hall rule (quiet.ts) and the HUD room name. Module state, like activeMap.ts, so the
 * per-frame code can read it without React; `useLocalArea` is the React window onto it.
 *
 * It outlives a scene, so the scene seeds it from the room state when it mounts (`seedLocalArea`: a reconnect
 * into the hall must start in the hall, a fresh join in the village) and resets it when it unmounts.
 */

import { useSyncExternalStore } from "react";
import type { AreaId } from "@caysonverse/shared/village/villageLayout";
import { normalizeArea, type AreaGate } from "../game/areaFilter";
import { setQuiet } from "../game/quiet";
import type { PlayersRoom } from "../game/remoteSync";

let area: AreaId = "village";
const listeners = new Set<() => void>();

/** The area the local player is in: "village" until the server says "hall". */
export function localArea(): AreaId {
  return area;
}

/** Record the local player's area (the first call after a mount seeds it; later calls are doors). */
export function setLocalArea(next: AreaId): void {
  if (next === area) return;
  area = next;
  // The memorial hall is quiet: jumping and emoji are off while the local player is inside (quiet.ts).
  setQuiet(next === "hall");
  for (const l of [...listeners]) l();
}

export function subscribeLocalArea(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** React: the local player's area (re-renders on a door). */
export function useLocalArea(): AreaId {
  return useSyncExternalStore(subscribeLocalArea, localArea, localArea);
}

/** Back to the village, quiet off (a scene unmounting, a new connection). */
export function resetLocalArea(): void {
  setLocalArea("village");
}

/** Counts the scenes that have seeded the area: a scene may only reset what it seeded itself. */
let generation = 0;

/**
 * A scene mounting seeds the area from its room's own state (`readSelfArea`): a reconnect into the hall must start
 * in the hall. Returns the scene's token for `releaseLocalArea`. Call it from a layout effect, never during render
 * (it notifies, and a render must not update other components).
 */
export function seedLocalArea(next: AreaId): number {
  setLocalArea(next);
  return ++generation;
}

/**
 * The scene that took `token` is going away: back to the village — unless a newer scene has seeded since. A
 * reconnect remounts the scene: the new one seeds the area it finds (the hall), and the old one's unmount must not
 * throw that away (a one-render "village" blip inside the hall).
 */
export function releaseLocalArea(token: number): void {
  if (token === generation) resetLocalArea();
}

/** Our own `area` in `room`'s synced state; "village" when our player is not in it yet. */
export function readSelfArea(room: PlayersRoom | null): AreaId {
  return normalizeArea(room?.state?.players?.get?.(room.sessionId)?.area);
}

/**
 * The gate `startRemoteSync` takes (areaFilter.ts `AreaGate`): reads the local area from this store, writes the
 * area the synced state reports, and tells the sync when it changes.
 */
export const areaGate: AreaGate = {
  local: localArea,
  setLocal: setLocalArea,
  subscribe: subscribeLocalArea,
};
