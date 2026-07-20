import path from "node:path";
import fs from "node:fs";
import express from "express";
import { defineServer, matchMaker } from "colyseus";
import { APP_NAME, DEFAULT_SERVER_PORT, WORLD_ROOM } from "@caysonverse/shared/constants";
import { rooms } from "./rooms";
import { RateWindow } from "./rooms/rateLimit";
import { resolveClientIp } from "./rooms/clientIp";
import {
  GROQ_URL,
  GROQ_DEFAULT_MODEL,
  NPC_ERRORS,
  NPC_RATE_LIMIT,
  NPC_RATE_WINDOW_MS,
  NPC_TIMEOUT_MS,
  buildGroqRequest,
  extractReply,
  validateNpcChatBody,
} from "./npc/groqChat";
import {
  VOICE_RATE_LIMIT,
  VOICE_RATE_WINDOW_MS,
  VoiceCache,
  synthesizeVoice,
  validateVoiceBody,
} from "./npc/voice";

const PORT = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);

// Built client assets, produced by `vite build`. This resolves to
// <repo>/client/dist both in dev (tsx, __dirname = server/src) and in the
// production bundle (__dirname = server/dist). Present after `npm run build`.
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

    // ── AI 조교 NPC chat proxy (design 31) ──────────────────────────────────
    // The Groq key lives ONLY in the server env; the client posts its running
    // 1:1 conversation here. Per-IP sliding-window limiter (same trusted-proxy
    // model as the admin limiter: right-most XFF hop, socket address fallback).
    const npcLimiters = new Map<string, RateWindow>();
    app.post("/api/npc-chat", express.json({ limit: "32kb" }), async (req, res) => {
      const ip =
        resolveClientIp({ ip: req.headers["x-forwarded-for"] } as never) ??
        req.socket.remoteAddress ??
        "unknown";
      // Memory backstop: the per-IP map cannot grow unbounded (drop-all reset
      // is fine — the window is only a minute).
      if (npcLimiters.size > 2000) npcLimiters.clear();
      let limiter = npcLimiters.get(ip);
      if (!limiter) {
        limiter = new RateWindow(NPC_RATE_LIMIT, NPC_RATE_WINDOW_MS);
        npcLimiters.set(ip, limiter);
      }
      if (!limiter.tryAccept(Date.now())) {
        res.status(429).json({ error: NPC_ERRORS.rateLimited });
        return;
      }

      const parsed = validateNpcChatBody(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const apiKey = process.env.GROQ_API_KEY;
      if (!apiKey) {
        res.status(503).json({ error: NPC_ERRORS.notConfigured });
        return;
      }

      try {
        const upstream = await fetch(GROQ_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(
            buildGroqRequest(
              parsed.messages,
              process.env.GROQ_MODEL || GROQ_DEFAULT_MODEL,
              parsed.npc,
            ),
          ),
          signal: AbortSignal.timeout(NPC_TIMEOUT_MS),
        });
        const reply = upstream.ok ? extractReply(await upstream.json()) : null;
        if (!reply) {
          console.error(`[${APP_NAME}] npc-chat upstream failure: HTTP ${upstream.status}`);
          res.status(502).json({ error: NPC_ERRORS.upstream });
          return;
        }
        res.json({ reply });
      } catch (err) {
        // Timeout/network — never leak upstream details to the client.
        console.error(`[${APP_NAME}] npc-chat error:`, err);
        res.status(502).json({ error: NPC_ERRORS.upstream });
      }
    });

    // ── AI 조교 neural voice (design 31 후속) ───────────────────────────────
    // The panel posts each NPC line here and plays the returned MP3 (Edge TTS
    // ko-KR-SunHi neural voice). Failures are non-fatal: the client falls back
    // to the browser's Web Speech voice.
    const voiceLimiters = new Map<string, RateWindow>();
    const voiceCache = new VoiceCache();
    app.post("/api/npc-voice", express.json({ limit: "8kb" }), async (req, res) => {
      const ip =
        resolveClientIp({ ip: req.headers["x-forwarded-for"] } as never) ??
        req.socket.remoteAddress ??
        "unknown";
      if (voiceLimiters.size > 2000) voiceLimiters.clear();
      let limiter = voiceLimiters.get(ip);
      if (!limiter) {
        limiter = new RateWindow(VOICE_RATE_LIMIT, VOICE_RATE_WINDOW_MS);
        voiceLimiters.set(ip, limiter);
      }
      if (!limiter.tryAccept(Date.now())) {
        res.status(429).json({ error: "rate limited" });
        return;
      }
      const parsed = validateVoiceBody(req.body);
      if (!parsed.ok) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      try {
        let audio = voiceCache.get(parsed.text);
        if (!audio) {
          audio = await synthesizeVoice(parsed.text);
          voiceCache.set(parsed.text, audio);
        }
        res.setHeader("content-type", "audio/mpeg");
        res.setHeader("cache-control", "no-store");
        res.send(audio);
      } catch (err) {
        console.error(`[${APP_NAME}] npc-voice error:`, err);
        res.status(502).json({ error: "voice synthesis failed" });
      }
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

server.listen(PORT).then(async () => {
  // Pre-create the ONE shared world room at boot (verified against Colyseus 0.17:
  // matchMaker.createRoom must run AFTER listen() — beforeListen is too early, the
  // matchmaker has no processId yet). Combined with WorldRoom.autoDispose = false,
  // the singleton exists shortly after boot and survives empty. The client uses
  // join-existing-only (`client.join`), so a full room surfaces the capacity notice
  // instead of silently spawning a second world. Runs on every boot, so a server
  // restart re-creates the room for reconnecting clients.
  //
  // HONEST NOTE on timing: `listen()` has already resolved here, so the transport
  // is ALREADY accepting matchmake requests before this `createRoom` completes —
  // there is a sub-ms boot window in which a join arriving for `world` gets
  // MATCHMAKE_INVALID_CRITERIA (521, "no rooms found") meaning "not created YET",
  // not "full". A mass reconnect right after a restart is exactly when clients hit
  // it. The CLIENT handles this by retrying a 521 a few times before treating it as
  // capacity (see client net/joinRetry + connection.ts + resilience.ts). We do NOT
  // add a watchdog to recreate the room if the sole instance ever dies while the
  // server lives (a forced disconnect flipping autoDispose) — that room-death-
  // without-restart case is an accepted v1 risk (YAGNI).
  await matchMaker.createRoom(WORLD_ROOM, {});
  console.log(`[${APP_NAME}] listening on http://localhost:${PORT}`);
});
