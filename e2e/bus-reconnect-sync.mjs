/**
 * e2e/bus-reconnect-sync.mjs — a rider whose network is cut for a few seconds mid-lap: the rider's own screen and the viewer's
 * agree with the server about whether the rider is aboard (coordinator's lead, 2026-11-18). The server is authoritative
 * (`Player.busSeat`); the rider must never be drawn standing outside the bus while the server has them in it, and a viewer must
 * never see a second avatar of the rider (a ghost seated in the bus while the rider stands at the stop).
 *
 * R rides; V watches (a plain second client, the server's mirror). R's network is cut at ~20 s into the lap for CUT s (default 5),
 * once as a plain offline switch, once at the very end of the lap with --at-end. Each sample: the server's truth (V's mirror of R,
 * by R's session id, and by R's nickname: how many avatars of that nickname V sees), R's own slot / boarded / session id.
 *
 *   OFF=$(node -e 'const n=Date.now()+200000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2931 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2931 npx vite --port 5931 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5931 node e2e/bus-reconnect-sync.mjs [--cut=5] [--at-end]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (n, d) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? d;
const CUT = Number(arg("cut", "5"));
const AT_END = process.argv.includes("--at-end");
const run = createRun(AT_END ? "bus-reconnect-sync-end" : "bus-reconnect-sync");
run.allow("the cut network", /ERR_INTERNET_DISCONNECTED|Network offline|Room connection was closed|reconnect|WebSocket is already in CLOSING/i);
run.allow("AudioContext (headless audio device)", /AudioContext/);
const SMALL = { viewport: { width: 640, height: 400 } };
const browser = await launchBrowser();
const R = await openPlayer(browser, run, { tag: "R", device: SMALL });
const V = await openPlayer(browser, run, { tag: "V", device: SMALL });

const own = (p) =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const ride = await window.__imp("/src/game/busRide.ts");
    const trip = sync.transitTripAt(sync.transitNowMs());
    return { status: trip.status, progress: trip.progress, boarded: sync.getTransitState().boarded, slot: ride.selfBusRide.slot, sid: window.__cv.getSessionId() };
  });
const mirror = (p) => p.page.evaluate(() => window.__cv.getRemotes().map((r) => ({ sid: r.sessionId, nick: r.nickname, busSeat: r.busSeat, connected: r.connected })));
const viewOf = (p) => p.page.evaluate(() => Object.fromEntries(Object.entries(window.__cv.getRemoteView()).map(([k, v]) => [k, { y: v.y, kind: v.kind }])));

await run.step("join and board", async () => {
  await joinVillage(R, "탑승");
  await joinVillage(V, "구경");
  await walkAndWait(R, 38.5, -0.5, 60000, 1.5);
  await walkAndWait(R, 36.9, -6.0, 40000, 0.5);
  await walkAndWait(V, 36.0, -10.5, 60000, 3);
  for (let t0 = Date.now(); Date.now() - t0 < 300000 && (await own(R)).status !== "boarding"; ) await sleep(1000);
  await act(R);
  for (let t0 = Date.now(); Date.now() - t0 < 10000 && !(await own(R)).boarded; ) await sleep(200);
  run.check("R boarded", (await own(R)).boarded, await own(R));
});
const nick = R.nick;
const sid0 = (await own(R)).sid;

const rows = [];
await run.step("the lap with the cut", async () => {
  const t0 = Date.now();
  let firstTransit = null;
  let cutAt = null;
  let backAt = null;
  let offAt = null;
  while (Date.now() - t0 < 400000 && !(offAt && Date.now() - offAt > 10000)) {
    const o = await own(R).catch(() => null);
    if (o && o.status === "inTransit") firstTransit ??= Date.now();
    const lap = firstTransit ? Date.now() - firstTransit : -1;
    // the cut: 20 s into the lap, or (--at-end) when the bus is nearly back at the stop (progress > 0.93)
    if (cutAt === null && (AT_END ? o && o.status === "inTransit" && o.progress > 0.93 : lap > 20000)) {
      cutAt = Date.now();
      await R.ctx.setOffline(true);
      await R.page.evaluate(() => window.__cv.dropConnection()).catch(() => {});
      setTimeout(async () => {
        await R.ctx.setOffline(false);
        backAt = Date.now();
      }, CUT * 1000);
    }
    const m = await mirror(V).catch(() => []);
    const views = await viewOf(V).catch(() => ({}));
    const t = Date.now() - t0;
    const mine = m.filter((x) => x.nick === nick);
    rows.push({ t, cut: cutAt ? t - (cutAt - t0) : null, own: o, sameNick: mine.map((x) => ({ sid: x.sid.slice(0, 4), seat: x.busSeat, conn: x.connected, y: views[x.sid]?.y ?? null })) });
    if (firstTransit && mine.length > 0 && mine.every((x) => x.busSeat < 0) && o && !o.boarded && o.slot < 0 && lap > 30000) offAt ??= Date.now();
    await sleep(150);
  }
  mkdirSync(run.evidence, { recursive: true });
  writeFileSync(join(run.evidence, "reconnect-rows.json"), JSON.stringify(rows, null, 1));
  run.check("the lap ended with the rider off on every screen", !!offAt, rows.at(-1));
});

await run.step("compare", async () => {
  // 1) one avatar of R on V's screen at any time after the cut settled (no second, ghost avatar of the same nickname riding)
  const multi = rows.filter((r) => r.sameNick.length > 1);
  const aboardGhost = rows.filter((r) => r.sameNick.length > 1 && r.sameNick.some((x) => x.seat >= 0));
  run.check("V never saw two avatars of R", multi.length === 0, { n: multi.length, first: multi[0] });
  run.check("V never saw a ghost of R aboard while R stood elsewhere", aboardGhost.length === 0, { n: aboardGhost.length, first: aboardGhost[0] });
  // 2) own vs server: longest stretch the rider's own page disagreed with the server (V's mirror of R's session)
  let best = 0;
  let from = null;
  let worst = null;
  for (const r of rows) {
    const mine = r.sameNick[0];
    const bad = r.own && mine && (r.own.slot >= 0) !== (mine.seat >= 0);
    if (bad && from === null) from = r;
    if (!bad) from = null;
    if (from && r.t - from.t >= best) {
      best = r.t - from.t;
      worst = { from: from.t, to: r.t, own: r.own, mirror: mine };
    }
  }
  run.check(`R's own state never disagreed with the server for more than 1 s (longest ${best} ms)`, best <= 1000, worst);
  const last = rows.at(-1);
  const me = await pos(R);
  run.check("R ends standing off the bus on both screens", last.own.slot < 0 && last.sameNick.every((x) => x.seat < 0), last);
  void me;
  run.check("the session id of R", true, { before: sid0, after: (await own(R)).sid });
});

const code = run.finish();
await browser.close();
process.exit(code);
