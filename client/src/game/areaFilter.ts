/**
 * Who the village shows (케이슨 마을, Task 4). Two areas share one room and one coordinate space: the open
 * village and the memorial hall's interior (`Player.area`). A player only ever sees the avatars of their own
 * area — the other area is a different place, hundreds of metres away, behind a wall — so remoteSync takes a
 * remote's avatar out of the store while they are in the other area and puts it back, at their current
 * position, when the one of them (or both) comes through the door. An avatar that is not in the store is not
 * mounted: no model, nametag, bubble or draw call (RemotePlayers renders the roster).
 *
 * Outside the village nobody has an area, so remoteSync is given no `AreaGate` and nothing is filtered.
 */

import type { AreaId } from "@caysonverse/shared/village/villageLayout";

/** `"hall"` is the hall; anything else (an older server, an unknown value) is the village. */
export function normalizeArea(value: unknown): AreaId {
  return value === "hall" ? "hall" : "village";
}

/** True when a player in `remoteArea` has an avatar for a viewer standing in `localArea`. */
export function showsInArea(remoteArea: unknown, localArea: AreaId): boolean {
  return normalizeArea(remoteArea) === localArea;
}

/**
 * The village scene's window onto the local player's area, handed to `startRemoteSync`: where the viewer
 * stands now, how the sync tells the scene (it reads the viewer's own synced `area`), and a subscription
 * so every remote is re-judged the moment the viewer goes through a door.
 */
export interface AreaGate {
  local(): AreaId;
  setLocal(area: AreaId): void;
  subscribe(listener: () => void): () => void;
}
