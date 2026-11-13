import path from "node:path";
import fs from "node:fs";
import express from "express";
import { defineServer } from "colyseus";
import { APP_NAME, DEFAULT_SERVER_PORT } from "@caysonverse/shared/constants";
import { rooms } from "./rooms";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// Built client assets, produced by `vite build`. This resolves to
// <repo>/client/dist both in dev (tsx, __dirname = server/src) and in the
// production bundle (__dirname = server/dist). Present after `npm run build`.
const clientDist = path.resolve(__dirname, "..", "..", "client", "dist");

const server = defineServer({
  // 케이슨 마을 (see ./rooms).
  rooms,

  // Colyseus initializes an Express app and hands it to this callback for our
  // custom HTTP routes. The transport mounts matchmaking/WebSocket routes
  // separately, so the SPA fallback below explicitly skips `/matchmake`.
  express: (app) => {
    // Liveness probe.
    app.get("/healthz", (_req, res) => {
      res.json({ ok: true });
    });

    // Serve the built SPA whenever `client/dist` exists — no NODE_ENV gate, so a
    // bare `npm start` (which does NOT set NODE_ENV) serves the app on Railway
    // and locally alike (resolves [task2-m1]). In dev the client runs on the
    // Vite dev server and `client/dist` usually does not exist, so this block is
    // skipped and the server still boots; if a stale dist happens to be present
    // on a dev box, serving it is harmless (the Vite dev server is used anyway).
    if (fs.existsSync(clientDist)) {
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

server.listen(PORT).then(() => {
  console.log(`[${APP_NAME}] listening on http://localhost:${PORT}`);
});
