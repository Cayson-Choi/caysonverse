import { Schema, type, MapSchema } from "@colyseus/schema";

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
 */
export class Player extends Schema {
  @type("string") nickname = ""; // set once at join
  @type("uint8") character = 0; // 0..3 preset index
  @type("uint8") tint = 0; // 0..7 palette index
  @type("float32") x = 0;
  @type("float32") z = 0;
  @type("float32") yaw = 0; // radians, normalized to [-PI, PI]
  @type("boolean") connected = true; // used by reconnection (Task 11)
}

export class WorldState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
  @type("string") announcement = ""; // admin banner (wired in Task 9)
  @type("number") announcedAt = 0;
}
