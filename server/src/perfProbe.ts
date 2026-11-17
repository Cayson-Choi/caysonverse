import fs from "node:fs";
import { monitorEventLoopDelay } from "node:perf_hooks";
import { Room } from "colyseus";

/**
 * Load-test probe (perf/no-hitch, 2026-11-17): OFF unless `CV_PERF_LOG=<file>` is set, never on a real server (the bot load
 * test, scripts/loadtest-bots.mjs, starts a local server with it). Every `CV_PERF_EVERY_MS` (default 5000) one JSON line:
 *  - the event loop's delay (p50/p99/max, ms) over the window;
 *  - the rooms' patch ticks (`broadcastPatch`: encode the state's changes once, send them to every client): count and
 *    p50/p95/p99/max ms;
 *  - the message handlers (`_onMessage`): count and total ms;
 *  - the bytes the patches put on the wire (sum, and per client per second), clients, rooms, CPU % of one core, RSS and heap.
 * Wraps Room.prototype once; the cost is two `performance.now()` per patch and per message.
 */
export function startPerfProbe(): void {
  const file = process.env.CV_PERF_LOG;
  if (!file || process.env.NODE_ENV === "production" && process.env.CV_PERF_ALLOW_PROD !== "1") return;
  const every = Number(process.env.CV_PERF_EVERY_MS ?? 5000);
  const eld = monitorEventLoopDelay({ resolution: 5 });
  eld.enable();
  const patchMs: number[] = [];
  let msgCount = 0;
  let msgMs = 0;
  let patchBytes = 0;
  let patchSends = 0;
  const rooms = new Set<Room>();

  const proto = Room.prototype as unknown as {
    broadcastPatch: (this: Room) => boolean;
    _onMessage: (this: Room, client: unknown, buffer: unknown) => void;
  };
  const patch = proto.broadcastPatch;
  proto.broadcastPatch = function (this: Room) {
    rooms.add(this);
    // the bytes: every client's raw send during this patch
    const sends: { c: { raw: (...a: unknown[]) => unknown }; raw: (...a: unknown[]) => unknown }[] = [];
    for (const c of this.clients as unknown as { raw: (...a: unknown[]) => unknown }[]) {
      const raw = c.raw;
      sends.push({ c, raw });
      c.raw = function (this: unknown, data: unknown, ...rest: unknown[]) {
        const n = (data as { byteLength?: number; length?: number })?.byteLength ?? (data as { length?: number })?.length ?? 0;
        patchBytes += n;
        patchSends++;
        return raw.call(this, data, ...rest);
      };
    }
    const t0 = performance.now();
    try {
      return patch.call(this);
    } finally {
      patchMs.push(performance.now() - t0);
      for (const s of sends) s.c.raw = s.raw;
    }
  };
  const onMsg = proto._onMessage;
  proto._onMessage = function (this: Room, client: unknown, buffer: unknown) {
    const t0 = performance.now();
    try {
      return onMsg.call(this, client, buffer);
    } finally {
      msgMs += performance.now() - t0;
      msgCount++;
    }
  };

  let cpu = process.cpuUsage();
  let at = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    const dt = now - at;
    const c = process.cpuUsage(cpu);
    const s = patchMs.sort((a, b) => a - b);
    const q = (p: number) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(3);
    let clients = 0;
    for (const r of rooms) {
      if ((r as unknown as { _internalState?: number })._internalState === 3) rooms.delete(r);
      else clients += r.clients.length;
    }
    const mem = process.memoryUsage();
    const line = {
      t: Date.now(),
      rooms: rooms.size,
      clients,
      eld: { p50: +(eld.percentile(50) / 1e6).toFixed(2), p99: +(eld.percentile(99) / 1e6).toFixed(2), max: +(eld.max / 1e6).toFixed(2) },
      patch: { n: s.length, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: +(s[s.length - 1] ?? 0).toFixed(3) },
      msgs: { n: msgCount, ms: +msgMs.toFixed(1) },
      bytes: { patch: patchBytes, sends: patchSends, perClientPerSec: clients ? Math.round(patchBytes / clients / (dt / 1000)) : 0, avgPatch: patchSends ? Math.round(patchBytes / patchSends) : 0 },
      cpuPct: +(((c.user + c.system) / 1000 / dt) * 100).toFixed(1),
      rssMB: +(mem.rss / 1048576).toFixed(1),
      heapMB: +(mem.heapUsed / 1048576).toFixed(1),
    };
    try {
      fs.appendFileSync(file, JSON.stringify(line) + "\n");
    } catch {
      /* best effort */
    }
    patchMs.length = 0;
    msgCount = 0;
    msgMs = 0;
    patchBytes = 0;
    patchSends = 0;
    eld.reset();
    cpu = process.cpuUsage();
    at = now;
  }, every);
  timer.unref();
}
