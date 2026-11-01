import { defineRoom } from "colyseus";
import { WORLD_ROOM } from "@caysonverse/shared/constants";
import { CLASS_ROOM } from "@caysonverse/shared/escape/constants";
import { WorldRoom } from "./WorldRoom";
import { ClassRoom } from "../class/ClassRoom";

/**
 * Matchmaking registration for every room, keyed by its public name. Shared by
 * the production server (`index.ts`) and the integration tests so both exercise
 * the exact same wiring.
 *
 * A class is found by its code: `filterBy(["classCode"])` puts the create option's
 * classCode in the room's listing, so `join(CLASS_ROOM, { classCode })` matches only
 * that class. Never add the spawn token to filterBy/sortBy or to defineRoom's default
 * options (those are merged into every client create).
 */
export const rooms = {
  [WORLD_ROOM]: defineRoom(WorldRoom),
  [CLASS_ROOM]: defineRoom(ClassRoom).filterBy(["classCode"]),
};

export { WorldRoom, ClassRoom };
