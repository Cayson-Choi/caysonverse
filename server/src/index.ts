import path from "node:path";
import fs from "node:fs";
import express from "express";
import { defineServer, matchMaker } from "colyseus";
import { APP_NAME, DEFAULT_SERVER_PORT, WORLD_ROOM } from "@caysonverse/shared/constants";
import { rooms } from "./rooms";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";

// Built client assets, produced by `vite build`. This resolves to
// <repo>/client/dist both in dev (tsx, __dirname = server/src) and in the
// production bundle (__dirname = server/dist). Present in production only.
const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");

const server = defineServer({
  // The authoritative world room, keyed by WORLD_ROOM (see ./rooms).
  rooms,

  // Colyseus initializes an Express app and hands it to this callback for our
  // custom HTTP routes. The transport mounts matchmaking/WebSocket routes
  // separately, so the SPA fallback below explicitly skips `/matchmake`.
  express: (app) => {
    // Liveness probe.
    app.get("/healthz", (_req, res) => {
      res.json({ ok: true });
    });

    // Serve the built SPA in production only. In dev the client runs on the
    // Vite dev server and `client/dist` usually does not exist — skip serving
    // gracefully so the server still boots.
    if (isProduction && fs.existsSync(clientDist)) {
      app.use(express.static(clientDist));

      // SPA fallback: return index.html for client-side routes but never for
      // Colyseus matchmaking/internal routes. Implemented as a middleware
      // (not a `*` route) to avoid Express 5's path-to-regexp wildcard syntax.
      const indexHtml = path.join(clientDist, "index.html");
      app.use((req, res, next) => {
        if (req.method !== "GET") return next();
        if (req.path.startsWith("/matchmake")) return next();
        res.sendFile(indexHtml);
      });
    }
  },
});

server.listen(PORT).then(async () => {
  // Pre-create the ONE shared world room at boot (verified against Colyseus 0.17:
  // matchMaker.createRoom must run AFTER listen() — beforeListen is too early, the
  // matchmaker has no processId yet). Combined with WorldRoom.autoDispose = false,
  // the singleton exists before the first client and survives empty. The client
  // uses join-existing-only (`client.join`), so a full room surfaces the capacity
  // notice instead of silently spawning a second world. Runs on every boot, so a
  // server restart re-creates the room for reconnecting clients. With the in-memory
  // LocalDriver/LocalPresence this resolves before the transport serves any request.
  await matchMaker.createRoom(WORLD_ROOM, {});
  console.log(`[${APP_NAME}] listening on http://localhost:${PORT}`);
});
