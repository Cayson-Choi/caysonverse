// Resolves the Colyseus server URL used by the client.
//
// Production: the client is served by the game server itself, so the same
// origin is correct. Development: VITE_SERVER_URL points at the standalone
// server (see client/.env.development). No Vite dev proxy is used.
//
// The actual Colyseus connection is wired up in a later task; this module only
// exposes the resolved base URL.
export const SERVER_URL: string =
  import.meta.env.VITE_SERVER_URL || window.location.origin;
