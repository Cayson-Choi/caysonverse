import { Schema, type } from "@colyseus/schema";

/**
 * Root room state, synchronized from the server to every connected client.
 *
 * SERVER-ONLY at runtime: this module executes @colyseus/schema decorators, so
 * it must never enter the browser bundle. The client may `import type` from here
 * but must NOT import any value. Browser-safe shared values live in
 * `constants.ts` / `messages.ts` instead — do not add a barrel that re-exports
 * this module together with them.
 *
 * Task 3 replaces these placeholder fields with the real world state (players,
 * positions, etc.). The fields below exist so the schema smoke test can verify
 * @type change-tracking works end-to-end through the build pipeline.
 */
export class WorldState extends Schema {
  @type("string") name = "";
  @type("number") tick = 0;
}
