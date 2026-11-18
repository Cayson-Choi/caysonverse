/**
 * e2e/bus-alight-sync.mjs — the rider's own screen and every viewer's screen agree about WHEN the rider is off the bus, whatever
 * the devices' clocks, the network, the tab and the connection do (coordinator's lead, 2026-11-18: "the rider's client may show
 * itself off while the server, and so every viewer, still has it seated"). The server is authoritative: `Player.busSeat`.
 *
 * Eight riders board the same bus and ride one lap; each has its own condition:
 *   R-90 / R-10 / R+10 / R+90 : the rider's device clock (Date.now and performance.now) off by -90 s, -10 s, +10 s, +90 s
 *   Rlat   : 150 ms each way on the game socket (300 ms round trip)
 *   Rhid   : the tab is hidden (no animation frames) from mid-lap until 3 s after the alighting
 *   Rrec   : mid-lap the network is cut for 5 s (a reconnect)
 *   Rleave : presses "leave" (and the stand key) over and over around the lap's end
 * Three viewers watch: V+90 (clock +90 s), V-90 (clock -90 s), V+10L (clock +10 s AND 300 ms round trip, far away: stand-ins).
 *
 * For each rider and viewer: the rider's own state (schema busSeat <0 / `boarded`) and what the viewer renders (`getRemoteView`)
 * flip within 1 s of each other; the rider is rendered standing at the position the rider itself stands at; nobody ever shows
 * the rider seated while the server says it is off, or the rider off while the viewer still shows it in the bus.
 *
 *   OFF=$(node -e 'const n=Date.now()+440000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2931 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2931 npx vite --port 5931 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5931 node e2e/bus-alight-sync.mjs
 */
import { createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const run = createRun("bus-alight-sync");
const SMALL = { viewport: { width: 640, height: 400 } };
const browser = await launchBrowser();

/** Init script of a page: the wall clock (Date.now) shifted by `off` ms and/or `delay` ms on the game socket (both directions). */
function patchPage(p, { off = 0, delay = 0 }) {
  return p.ctx.addInitScript(
    ([off, delay]) => {
      if (off) {
        // the device's wall clock (a real device's performance.now counts from its own page load, whatever its wall clock says)
        const dn = Date.now.bind(Date);
        Date.now = () => dn() + off;
      }
      if (delay) {
        const Orig = window.WebSocket;
        class DelayedSocket extends Orig {
          constructor(...a) {
            super(...a);
            this.__game = String(a[0]).includes(":2931");
          }
          send(d) {
            if (!this.__game) return super.send(d);
            setTimeout(() => {
              try {
                super.send(d);
              } catch {}
            }, delay);
          }
        }
        // every event of the game socket (open, message, close, error) is delivered `delay` ms late and in order; the handler is looked up
        // when the event is DELIVERED (the SDK swaps its handlers after the join handshake)
        for (const type of ["open", "message", "close", "error"]) {
          const d = Object.getOwnPropertyDescriptor(Orig.prototype, "on" + type);
          Object.defineProperty(DelayedSocket.prototype, "on" + type, {
            get() {
              return this["__h_" + type] ?? null;
            },
            set(h) {
              this["__h_" + type] = h;
              d.set.call(this, h && this.__game ? (e) => setTimeout(() => this["__h_" + type] && this["__h_" + type](e), delay) : h);
            },
          });
        }
        window.WebSocket = DelayedSocket;
      }
    },
    [off, delay],
  );
}

// Two sets (one lap each; the machine cannot hold eleven pages at once): --set=1 (default) or --set=2
const SET = (process.argv.find((a) => a.startsWith("--set=")) ?? "--set=1").slice(6);
const ALL = {
  1: {
    riders: [{ name: "R-90", off: -90000 }, { name: "R+90", off: 90000 }, { name: "Rlat", delay: 150 }, { name: "Rhid" }],
    viewers: [{ name: "V+90", off: 90000, at: [36.0, -10.5] }, { name: "V+10L", off: 10000, delay: 150, at: [-30, 30] }],
  },
  2: {
    riders: [{ name: "R-10", off: -10000 }, { name: "R+10", off: 10000 }, { name: "Rrec" }, { name: "Rleave" }],
    viewers: [{ name: "V-90", off: -90000, at: [36.0, -10.5] }, { name: "V+10L", off: 10000, delay: 150, at: [-30, 30] }],
  },
};
const riders = ALL[SET].riders;
const viewers = ALL[SET].viewers;
run.allow("AudioContext (headless audio device)", /AudioContext/);
run.allow("the cut network of Rrec", /ERR_INTERNET_DISCONNECTED|Network offline|Room connection was closed|reconnect/i);
for (const r of riders) {
  r.p = await openPlayer(browser, run, { tag: r.name, device: SMALL });
  await patchPage(r.p, r);
}
for (const v of viewers) {
  v.p = await openPlayer(browser, run, { tag: v.name, device: SMALL });
  await patchPage(v.p, v);
}

const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const busOf = (p) =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const ride = await window.__imp("/src/game/busRide.ts");
    const trip = sync.transitTripAt(sync.transitNowMs());
    return { status: trip.status, startMs: trip.startMs, now: sync.transitNowMs(), boarded: sync.getTransitState().boarded, slot: ride.selfBusRide.slot };
  });
/** What this viewer draws of `id` (rendered body + drawn pose), and this page's own pose. */
const viewOf = (p, id) =>
  p.page.evaluate((id) => ({ v: window.__cv.getRemoteView()[id] ?? null, d: window.__cv.getRemoteDrawn()[id] ?? null }), id);
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

await run.step("join everyone", async () => {
  for (const x of [...riders, ...viewers]) {
    try {
      await joinVillage(x.p, x.name.replace(/[^A-Za-z0-9]/g, "").slice(0, 4) || "x");
      run.check(`${x.name} joined`, true);
    } catch (e) {
      run.check(`${x.name} joined`, false, String(e).slice(0, 200));
    }
  }
  const b = await busOf(riders[0].p);
  run.check("the server clock is before the boarding window or inside it", b.status !== "inTransit", b);
});
if (process.env.JOIN_ONLY) {
  const code = run.finish();
  await browser.close();
  process.exit(code);
}
for (const r of riders) r.sid = await sid(r.p);

await run.step("to the stop", async () => {
  const slots = [[36.6, -6.0], [37.4, -6.0], [38.2, -6.0], [39.0, -6.0]];
  await Promise.all([
    ...riders.map(async (r, i) => {
      await walkAndWait(r.p, 38.5, -0.5, 60000, 1.5);
      await walkAndWait(r.p, slots[i][0], slots[i][1], 40000, 0.5);
    }),
    ...viewers.map((v) => walkAndWait(v.p, v.at[0], v.at[1], 90000, 3)),
  ]);
});

await run.step("board (the window opens) and sit where a seat is near", async () => {
  // all clocks here are the SERVER's (the bus snapshots), whatever the device says
  for (let t0 = Date.now(); Date.now() - t0 < 300000; ) {
    if ((await busOf(riders[0].p)).status === "boarding") break;
    await sleep(1000);
  }
  for (const r of riders) {
    await act(r.p);
    for (let t0 = Date.now(); Date.now() - t0 < 8000 && !(await busOf(r.p)).boarded; ) await sleep(200);
    r.boarded = (await busOf(r.p)).boarded;
  }
  run.check("every rider boarded", riders.every((r) => r.boarded), riders.map((r) => [r.name, r.boarded]));
  // every other rider sits (the seat is tried from where the entry spot is: some stay standing)
  for (const [i, r] of riders.entries()) {
    if (i % 2) continue;
    for (let k = 0; k < 10 && (await busOf(r.p)).slot <= 0; k++) {
      await r.p.page.evaluate(async (k) => (await window.__imp("/src/net/transitSync.ts")).sendBusSit("seat", k), k);
      await sleep(200);
    }
  }
  await sleep(1500);
  const slots = [];
  for (const r of riders) slots.push([r.name, (await busOf(r.p)).slot]);
  run.check("all riders are aboard on the server (a place in the bus)", slots.every(([, s]) => s >= 0), slots);
  for (const v of viewers) {
    for (const r of riders) {
      const w = await viewOf(v.p, r.sid);
      run.check(`${v.name} draws ${r.name} in the bus`, w.v && w.v.y > 0.3 && dist(w.v, w.d ?? w.v) < 1, { v: w.v });
    }
  }
});

// ── the lap, with each rider's special condition ──
// Three readings per rider and sample: the SERVER's truth (as a plain viewer's schema mirror has it: `busSeat` of the remote), the
// rider's OWN state (schema busSeat / `boarded` on its own page) and what each viewer RENDERS. A mismatch that lasts is a bug.
const samples = [];
const truthOf = (p) => p.page.evaluate(() => Object.fromEntries(window.__cv.getRemotes().map((r) => [r.sessionId, r.busSeat])));
await run.step("the lap", async () => {
  const hid = riders.find((r) => r.name === "Rhid");
  const rec = riders.find((r) => r.name === "Rrec");
  const spam = riders.find((r) => r.name === "Rleave");
  const ref = viewers[0]; // the viewer without network delay is the server's mirror
  let hidDone = false;
  let recDone = false;
  const t0 = Date.now();
  let firstTransit = null;
  let allOffAt = null;
  while (Date.now() - t0 < 420000 && !(allOffAt && Date.now() - allOffAt > 8000)) {
    const b = await busOf(riders[0].p);
    if (b.status === "inTransit") firstTransit ??= Date.now();
    const lap = firstTransit ? Date.now() - firstTransit : 0;
    if (hid && firstTransit && !hidDone && lap > 30000) {
      hidDone = true;
      await hid.p.page.evaluate(() => {
        window.__rafHeld = { orig: window.requestAnimationFrame.bind(window), queue: [] };
        window.requestAnimationFrame = (cb) => { window.__rafHeld.queue.push(cb); return 0; };
      });
    }
    if (rec && firstTransit && !recDone && lap > 45000) {
      recDone = true;
      await rec.p.ctx.setOffline(true);
      await rec.p.page.evaluate(() => window.__cv.dropConnection()); // an open socket is not always cut by the offline switch
      setTimeout(() => rec.p.ctx.setOffline(false), 5000);
    }
    // the leaver presses leave all the time once the lap is nearly over (the server refuses it on the road)
    if (spam && firstTransit && lap > 60000) await spam.p.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).sendBusRide("leave")).catch(() => {});
    const now = Date.now();
    const truth = await truthOf(ref.p).catch(() => ({}));
    const own = await Promise.all(riders.map((r) => busOf(r.p).catch(() => null)));
    const posOf = await Promise.all(riders.map((r) => pos(r.p).catch(() => null)));
    const seen = await Promise.all(riders.map((r) => Promise.all(viewers.map((v) => viewOf(v.p, r.sid).catch(() => null)))));
    for (const [i, r] of riders.entries()) {
      const rowViews = {};
      for (const [j, v] of viewers.entries()) {
        const w = seen[i][j];
        rowViews[v.name] = w?.v ? { aboard: w.v.y > 0.2, near: posOf[i] ? dist(w.v, posOf[i]) : null, mode: w.d?.mode } : null;
      }
      samples.push({ t: now - t0, rider: r.name, truth: (truth[r.sid] ?? -1) >= 0, own: own[i] ? own[i].slot >= 0 : null, views: rowViews });
    }
    const truthAboard = riders.some((r) => (truth[r.sid] ?? -1) >= 0);
    if (firstTransit && !truthAboard) allOffAt ??= now;
    await sleep(60);
  }
  run.check("the lap ended and the server put every rider off", !!allOffAt, { lapMs: firstTransit ? Date.now() - firstTransit : null });
});

await run.step("hidden tab resumes, then compare", async () => {
  await sleep(1500);
  const hid = riders.find((r) => r.name === "Rhid");
  if (hid) {
    await hid.p.page.evaluate(() => {
      const h = window.__rafHeld;
      if (!h) return;
      window.requestAnimationFrame = h.orig;
      window.__rafHeld = null;
      for (const cb of h.queue) h.orig(cb);
    });
  }
  await sleep(3000);
  // the longest stretch (ms) a reading disagreed with the server's truth
  const longestDetail = (rows, bad) => {
    let best = 0;
    let from = null;
    let at = null;
    for (const r of rows) {
      if (bad(r) && from === null) from = r;
      if (!bad(r)) from = null;
      if (from !== null && r.t - from.t >= best) {
        best = r.t - from.t;
        at = { from: from.t, to: r.t, truth: r.truth, own: r.own };
      }
    }
    return { best, at };
  };
  const longest = (rows, bad) => longestDetail(rows, bad).best;
  const LIM = 1000;
  for (const r of riders) {
    const rows = samples.filter((x) => x.rider === r.name);
    const lat = r.delay ? 400 : 0; // the rider's own 300 ms round trip is not a disagreement
    const ownD = longestDetail(rows, (x) => x.own !== null && x.own !== x.truth);
    const ownBad = ownD.best;
    run.check(`${r.name}: its own state never disagreed with the server for more than ${LIM + lat} ms`, ownBad <= LIM + lat, { longestMs: ownBad, at: ownD.at });
    for (const v of viewers) {
      const vl = v.delay ? 400 : 0;
      const bad = longest(rows, (x) => x.views[v.name] !== null && x.views[v.name].aboard !== x.truth);
      run.check(`${r.name} / ${v.name}: its rendering never disagreed with the server for more than ${LIM + lat + vl} ms`, bad <= LIM + lat + vl, { longestMs: bad });
    }
    // 3 s on: the rider's own position and every viewer's rendering of it agree, standing
    const me = await pos(r.p);
    for (const v of viewers) {
      const w = await viewOf(v.p, r.sid);
      run.check(`${r.name} / ${v.name}: standing at the rider's own position afterwards`, w.v && w.v.y < 0.3 && dist(w.v, me) < 0.8, { v: w.v, me });
    }
    const b = await busOf(r.p);
    run.check(`${r.name}: its own state is off the bus (slot < 0, not boarded)`, b.slot < 0 && !b.boarded, b);
    run.check(`${r.name}: it rode (the server had it aboard during the lap)`, rows.some((x) => x.truth), {});
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
