// A TEST-ONLY TCP proxy that adds latency and jitter between the dev client and the game server, for the
// remote-movement E2E (e2e/remote-move.mjs). Every chunk is held for `base + random() * jitter` ms, but never
// overtakes the chunk before it in the same direction — a late WebSocket frame delays everything queued behind
// it (TCP head-of-line), which is exactly what a jittery phone link does to 10 Hz state patches: a stall, then
// a burst. Both directions are delayed, so the mover's Move messages reach the server bunched and the viewer's
// patches arrive bunched.
//
//   node e2e/lib/jitterProxy.mjs <listenPort> <targetPort> [controlPort]
//   curl "http://localhost:<controlPort>/set?base=60&jitter=120"   # change it live (both numbers in ms)
//   curl "http://localhost:<controlPort>/stall?ms=900"              # one hiccup: hold everything for 900 ms, then burst
//
// Usable as a module too: `startJitterProxy({ listenPort, targetPort })` returns `{ set(base, jitter), close() }`.

import net from "node:net";
import http from "node:http";
import { fileURLToPath } from "node:url";

export function startJitterProxy({ listenPort, targetPort, targetHost = "127.0.0.1", base = 0, jitter = 0, random = Math.random }) {
  const conf = { base, jitter, stallUntil: 0 };
  const sockets = new Set();

  /**
   * Forward `from` → `to`, each chunk delayed, order kept. One FIFO and one timer per direction: separate
   * setTimeouts with different waits but the same due time may fire in either order, which would swap
   * WebSocket frames — something TCP never does (the server would apply an older Move after a newer one).
   */
  const pipe = (from, to) => {
    const queue = [];
    let lastAt = 0;
    let timer = null;
    let ended = false;
    const pump = () => {
      timer = null;
      const now = Date.now();
      while (queue.length > 0 && queue[0].at <= now) {
        const { chunk } = queue.shift();
        if (to.writable) to.write(chunk);
      }
      if (queue.length > 0) timer = setTimeout(pump, queue[0].at - now);
      else if (ended) to.end();
    };
    from.on("data", (chunk) => {
      const now = Date.now();
      const at = Math.max(lastAt, conf.stallUntil, now + conf.base + random() * conf.jitter);
      lastAt = at;
      queue.push({ at, chunk });
      if (timer === null) timer = setTimeout(pump, Math.max(0, queue[0].at - now));
    });
    from.on("end", () => {
      ended = true;
      if (timer === null) pump();
    });
  };

  const server = net.createServer((client) => {
    const upstream = net.connect(targetPort, targetHost);
    sockets.add(client);
    sockets.add(upstream);
    client.setNoDelay(true);
    upstream.setNoDelay(true);
    pipe(client, upstream);
    pipe(upstream, client);
    const kill = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", kill);
    upstream.on("error", kill);
    client.on("close", kill);
    upstream.on("close", kill);
  });
  server.listen(listenPort);

  return {
    set(b, j) {
      conf.base = b;
      conf.jitter = j;
    },
    /** Hold every chunk (both directions) for the next `ms`, then let them all through at once. */
    stall(ms) {
      conf.stallUntil = Date.now() + ms;
    },
    get: () => ({ ...conf }),
    close() {
      for (const s of sockets) s.destroy();
      server.close();
    },
  };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [listenPort, targetPort, controlPort] = process.argv.slice(2).map(Number);
  const proxy = startJitterProxy({ listenPort, targetPort });
  console.log(`jitter proxy :${listenPort} -> :${targetPort}`);
  if (controlPort) {
    http
      .createServer((req, res) => {
        const u = new URL(req.url, "http://x");
        if (u.pathname === "/set") proxy.set(Number(u.searchParams.get("base") ?? 0), Number(u.searchParams.get("jitter") ?? 0));
        if (u.pathname === "/stall") proxy.stall(Number(u.searchParams.get("ms") ?? 0));
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(proxy.get()));
      })
      .listen(controlPort);
    console.log(`control :${controlPort}  (/set?base=&jitter=)`);
  }
}
