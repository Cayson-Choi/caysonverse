import { defineRoom } from "colyseus";
import { WORLD_ROOM } from "@caysonverse/shared/constants";
import { WorldRoom } from "./WorldRoom";

/**
 * Matchmaking registration for every room, keyed by its public name. Shared by
 * the production server (`index.ts`) and the integration tests so both exercise
 * the exact same wiring.
 */
export const rooms = {
  [WORLD_ROOM]: defineRoom(WorldRoom),
};

export { WorldRoom };
