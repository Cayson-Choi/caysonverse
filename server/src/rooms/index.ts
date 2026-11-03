import { defineRoom } from "colyseus";
import { VILLAGE_ROOM, WORLD_ROOM } from "@caysonverse/shared/constants";
import { CLASS_ROOM, ESCAPE_ROOM } from "@caysonverse/shared/escape/constants";
import { WorldRoom } from "./WorldRoom";
import { VillageRoom } from "./VillageRoom";
import { ClassRoom } from "../class/ClassRoom";
import { EscapeRoom } from "../escape/EscapeRoom";

/**
 * Matchmaking registration for every room, keyed by its public name. Shared by
 * the production server (`index.ts`) and the integration tests so both exercise
 * the exact same wiring.
 *
 * A class is found by its code: `filterBy(["classCode"])` puts the create option's
 * classCode in the room's listing, so `join(CLASS_ROOM, { classCode })` matches only
 * that class. Never add the spawn token to filterBy/sortBy or to defineRoom's default
 * options (those are merged into every client create).
 *
 * The village (케이슨 마을) is NOT a singleton and is never pre-created at boot: clients `joinOrCreate`
 * it. VillageRoom.maxClients (30) makes a full room lock, so the next visitor creates a new room (a shard);
 * `sortBy({ clients: -1 })` sends a visitor to the fullest room that still has a seat, so shards fill up
 * one at a time instead of spreading everyone thin. No filter: every shard is the same village.
 *
 * A team's escape room is never matchmade: ClassRoom creates it (spawn token) and its members
 * join it by id with a one-time ticket, so it has no filter (nothing about it is listed).
 */
export const rooms = {
  [WORLD_ROOM]: defineRoom(WorldRoom),
  [VILLAGE_ROOM]: defineRoom(VillageRoom).sortBy({ clients: -1 }),
  [CLASS_ROOM]: defineRoom(ClassRoom).filterBy(["classCode"]),
  [ESCAPE_ROOM]: defineRoom(EscapeRoom),
};

export { WorldRoom, VillageRoom, ClassRoom, EscapeRoom };
