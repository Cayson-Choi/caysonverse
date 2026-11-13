import { defineRoom } from "colyseus";
import { VILLAGE_ROOM } from "@caysonverse/shared/constants";
import { VillageRoom } from "./VillageRoom";

/**
 * Matchmaking registration for every room, keyed by its public name. Shared by
 * the production server (`index.ts`) and the integration tests so both exercise
 * the exact same wiring.
 *
 * The village (케이슨 마을) is NOT a singleton and is never pre-created at boot: clients `joinOrCreate`
 * it. VillageRoom.maxClients (30) makes a full room lock, so the next visitor creates a new room (a shard);
 * `sortBy({ clients: -1 })` sends a visitor to the fullest room that still has a seat, so shards fill up
 * one at a time instead of spreading everyone thin. The `clients` sort key is the room listing's own count of
 * seats taken (kept by the matchmaker), which wins over any client-supplied metadata or create option:
 * nothing a client sends can fake a fuller or emptier room. No filter: every shard is the same village.
 */
export const rooms = {
  [VILLAGE_ROOM]: defineRoom(VillageRoom).sortBy({ clients: -1 }),
};

export { VillageRoom };
