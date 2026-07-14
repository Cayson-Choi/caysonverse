// Browser-safe shared constants. Safe to import (as values) from the client
// bundle — no @colyseus/schema decorator runtime lives here (that is schema.ts).

/** Public application name. Shown in the client UI and used in server logs. */
export const APP_NAME = "caysonverse";

/** Default Colyseus server port, used when the PORT env var is not set. */
export const DEFAULT_SERVER_PORT = 2567;

/** Matchmaking name of the main world room (registered in Task 3). */
export const WORLD_ROOM = "world";
