import { Schema, type, MapSchema } from "@colyseus/schema";
import type { AreaId } from "./village/villageLayout";

/**
 * Root room state, synchronized from the server to every connected client.
 *
 * SERVER-ONLY at runtime: this module executes @colyseus/schema decorators, so
 * it must never enter the browser bundle. The client may `import type` from here
 * but must NOT import any value. Browser-safe shared values live in
 * `constants.ts` / `messages.ts` instead — do not add a barrel that re-exports
 * this module together with them.
 */

/**
 * A single connected participant.
 *
 * Design notes (binding):
 * - No animation-state field: the client derives walk/idle from interpolated
 *   velocity, so it never needs to be synced.
 * - No `y` coordinate: the ground is server-fixed, which structurally prevents
 *   fly-hacks (a client simply cannot express vertical position).
 * - No chat text: transient messages are events, not state (anti-pattern to
 *   keep them in the synced tree).
 * - Appearance (character stage 3, design 5.2): 15 uint8 fields, declared in
 *   APPEARANCE_FIELDS order (shared/src/appearance.ts — the single source of
 *   their ranges, palettes and validation). VillageRoom.onJoin writes all 15 once,
 *   from the validated join options, so they are fixed for the whole session and
 *   clients read them once (`pickAppearance(player)`). Slot fields are part
 *   indices, colour fields palette indices, `voice` a VOICE_GENDERS index. They
 *   replace the pre-builder `character` / `tint` preset pair.
 */
export class Player extends Schema {
  @type("string") nickname = ""; // set once at join
  // ── appearance (APPEARANCE_FIELDS order) ──
  @type("uint8") hat = 0;
  @type("uint8") hatColor = 0;
  @type("uint8") hair = 0;
  @type("uint8") hairColor = 0;
  @type("uint8") face = 0;
  @type("uint8") skin = 0;
  @type("uint8") top = 0;
  @type("uint8") topColor = 0;
  @type("uint8") bottom = 0;
  @type("uint8") bottomColor = 0;
  @type("uint8") shoes = 0;
  @type("uint8") shoesColor = 0;
  @type("uint8") item = 0;
  @type("uint8") itemColor = 0;
  @type("uint8") voice = 0;
  @type("float32") x = 0;
  @type("float32") z = 0;
  @type("float32") yaw = 0; // radians, normalized to [-PI, PI]
  // The mover's own clock (ms) at the pose above — `MovePayload.t` of the last accepted Move, 0 = unknown (an
  // older client, or a pose the server placed). Viewers time the remote walk by it (client playout.ts).
  @type("uint32") moveT = 0;
  @type("boolean") connected = true; // used by reconnection (Task 11)
  // Seating (v2 Task 1): -1 = standing; 0..SEATS.length-1 = the occupied seat.
  // The first legitimate discrete synced state — a seated player is fully
  // server-positioned (x/z/yaw snapped to the seat), so 100 seated avatars sync.
  @type("int8") seatIndex = -1;
  // 케이슨 마을: which area the player is in — "village" (the open village) or "hall" (inside the memorial hall,
  // where the room is quiet: no emoji, no jumping). Written by VillageRoom at join and on every door use.
  @type("string") area: AreaId = "village";
}

/** The village room's synced state: every connected player, keyed by session id. */
export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}
