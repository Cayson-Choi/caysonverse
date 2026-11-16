/**
 * e2e/village-bus-spots.mjs — the full seat sweep of the village bus v3 (owner 2026-11-16: no grab handles; ten big seats, every
 * one sit-able by walking up to it or by tapping it). One rider boards, then for each seat in --places=a-b (index into BUS_SEATS):
 *  1. walk + E: walks the aisle with the keys to the seat's approach point (shared seatApproachPoint), turns until the UI
 *     offers THAT seat (the round button / E), takes it and checks the server agrees (busSeat); no message fallback;
 *  2. tap: stands up, walks to an aisle point 1.2-1.8 m away, turns the view towards the seat and taps (phone) / clicks (PC)
 *     its cushion on the screen; the rider walks there by itself and sits: busSeat = the seat within 15 s.
 * Screenshots: the view from each seat, then the left / right windows. Optional second rider (--other): a PC client that
 * boards first and sits in R2, so the sweep also shows another rider (and R2 is not offered: it is taken).
 *
 *   OFF=$(node -e 'const n=Date.now()+175000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=3081 npx tsx src/index.ts)
 *   CV_CLIENT_URL=http://localhost:5681 node e2e/village-bus-spots.mjs --out=<folder> [--phone] [--time=2026-11-03T21:30] [--places=0-9] [--other]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const other = process.argv.includes("--other");
const TIME = arg("time", NOON);
const [from, to] = arg("places", "0-9").split("-").map(Number);
const night = TIME !== NOON;
const tag = `${phone ? "phone" : "pc"}-${night ? "night" : "day"}`;
const run = createRun(`village-bus-spots-${tag}`);
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE : DESKTOP });
const O = other ? await openPlayer(browser, run, { tag: "O-pc", device: DESKTOP }) : null;
const ride = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/busRide.ts");
    return { slot: m.selfBusRide.slot, walk: { ahead: m.busWalk.ahead, right: m.busWalk.right, valid: m.busWalk.valid }, fp: m.busCamState.firstPerson };
  });
const targetsOf = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/interactTargets.ts");
    return m.getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label }));
  });
const status = (p) => p.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); const t = s.transitTripAt(s.transitNowMs()); return { status: t.status, boarded: s.getTransitState().boarded }; });
async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const view = async (p, name) => {
  const b = p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first();
  if (p.touch) await b.tap({ timeout: 4000 }).catch(() => {});
  else await b.click({ timeout: 4000 }).catch(() => {});
  await sleep(900);
};
async function walkBus(p, ahead, right, tol = 0.15, ms = 14000) {
  await view(p, "front");
  const t0 = Date.now();
  let held = null;
  const release = async () => { if (held) await p.page.keyboard.up(held); held = null; };
  while (Date.now() - t0 < ms) {
    const r = await ride(p);
    const da = ahead - r.walk.ahead;
    const dr = right - r.walk.right;
    if (Math.hypot(da, dr) < tol) break;
    const key = Math.abs(da) > Math.abs(dr) ? (da > 0 ? "KeyW" : "KeyS") : dr > 0 ? "KeyD" : "KeyA";
    if (key !== held) { await release(); await p.page.keyboard.down(key); held = key; }
    await sleep(70);
  }
  await release();
  await sleep(300);
}
const standUp = async (p) => {
  if ((await ride(p)).slot <= 0) return true;
  await p.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).sendBusStand());
  return pollUntil(async () => (await ride(p)).slot === 0, 4000);
};

await run.step("join and board", async () => {
  await joinVillage(A, "탑승", TIME);
  if (O) await joinVillage(O, "동승", TIME);
  await pollUntil(() => A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null), 30000);
  for (const p of [O, A]) {
    if (!p) continue;
    await walkAndWait(p, 38.5, -0.5, 40000, 1);
    await walkAndWait(p, 36.9, -6.0, 30000, 0.5);
    await pollUntil(async () => (await status(p)).status === "boarding", 420000, 500); // the server may be started before the window opens
    await sleep(600);
    await act(p);
    run.check(`${p.tag}: aboard and free`, await pollUntil(async () => (await ride(p)).slot === 0 && (await status(p)).boarded, 8000), await status(p));
    if (p === O) {
      const ap = await O.page.evaluate(async () => { const c = await window.__imp("/shared/src/village/busCabin.ts"); const i = c.BUS_SEATS.findIndex((s) => s.id === "R2"); return { ...c.seatApproachPoint(c.BUS_SEATS[i]), i }; });
      await walkBus(O, ap.ahead, ap.right, 0.12, 16000);
      await O.page.evaluate(async (i) => (await window.__imp("/src/net/transitSync.ts")).sendBusSit("seat", i), ap.i);
      run.check("the other rider sits in R2", await pollUntil(async () => (await ride(O)).slot === ap.i + 1, 5000), await ride(O));
    }
  }
  await sleep(1200);
});

const plan = await A.page.evaluate(async () => {
  const c = await window.__imp("/shared/src/village/busCabin.ts");
  return c.BUS_SEATS.map((s, i) => {
    const ap = c.seatApproachPoint(s);
    // where the tap is made from: an aisle point 1.2 - 1.8 m from the approach (behind it for the front seats, ahead of it for the rear ones)
    let start = null;
    for (const d of [1.4, 1.2, 1.8, -1.4, -1.2, -1.8]) {
      const a = ap.ahead + (ap.ahead > -1 ? -d : d);
      if (!c.cabinBlocked(a, 0)) { start = { ahead: a, right: 0 }; break; }
    }
    return { index: i, id: s.id, a: ap.ahead, r: ap.right, start };
  });
});
writeFileSync(join(OUT, "plan.json"), JSON.stringify(plan, null, 1));

const results = [];
for (const pl of plan.slice(from, Math.min(to, plan.length - 1) + 1)) {
  const label = `seat ${pl.id}`;
  if (!(await status(A)).boarded) { results.push({ label, skipped: "ride over" }); continue; }
  const otherHere = O && pl.id === "R2";
  // 1) walk + E (looking level again: the tap below looks down)
  await standUp(A);
  await A.page.evaluate(async () => { (await window.__imp("/src/game/viewState.ts")).viewState.fpPitch = 0; });
  await walkBus(A, pl.a, pl.r, 0.12, 16000);
  const want = `bus_sit:seat:${pl.index}`;
  let tg = await targetsOf(A);
  let offered = tg.some((t) => t.id === want);
  const tried = [];
  for (const v of offered ? [] : ["back", "left", "right", "front"]) {
    await view(A, v);
    await sleep(400);
    tg = await targetsOf(A);
    tried.push(`${v}:${tg.map((t) => t.id).join("+")}`);
    if (tg.some((t) => t.id === want)) { offered = true; break; }
  }
  if (otherHere) {
    run.check(`${label}: taken by the other rider, so it is not offered`, !offered, { tried });
    results.push({ label, walkE: "taken (not offered)" });
    continue;
  }
  if (offered) await act(A);
  const satE = offered && (await pollUntil(async () => (await ride(A)).slot === pl.index + 1, 4000));
  run.check(`${label}: walk + E (the UI offers it, the server seats the rider)`, satE, { offered, tried, label: tg.find((t) => t.id === want)?.label, at: (await ride(A)).walk });
  await sleep(700);
  await A.page.evaluate(async () => { (await window.__imp("/src/game/viewState.ts")).viewState.fpPitch = 0; });
  await view(A, "front");
  const n = String(pl.index).padStart(2, "0");
  await A.page.screenshot({ path: join(OUT, `${tag}-${n}-${pl.id}-view.png`) });
  for (const v of ["left", "right"]) {
    await view(A, v);
    await A.page.screenshot({ path: join(OUT, `${tag}-${n}-${pl.id}-${v}.png`) });
  }
  // 2) tap: from an aisle point a few metres away
  await standUp(A);
  let satTap = false;
  let tapInfo = null;
  if (pl.start) {
    await walkBus(A, pl.start.ahead, pl.start.right, 0.2, 16000);
    // turn towards the seat (the quick view) and look down at it as a player would (the first person's pitch: + looks down)
    const tries = [];
    outer: for (const v of [pl.a < pl.start.ahead ? "back" : "front", "left", "right"]) {
      await view(A, v);
      for (const pitch of [0.35, 0.6, 0.15, 0.85]) {
        await A.page.evaluate(async (pt) => { (await window.__imp("/src/game/viewState.ts")).viewState.fpPitch = pt; }, pitch);
        await sleep(350);
        const at = await A.page.evaluate((i) => window.__cvBusSeatScreen?.(i) ?? null, pl.index);
        tries.push({ v, pitch, at: at && { x: Math.round(at.x), y: Math.round(at.y), on: at.onScreen } });
        // on screen and clear of the HUD's corners (the ride panel top left, the buttons bottom right)
        if (!at || !at.onScreen || at.y < 120 || at.y > (A.touch ? 640 : 660) || (at.x < 260 && at.y < 260)) continue;
        tapInfo = { v, pitch, at };
        if (A.touch) await A.page.touchscreen.tap(at.x, at.y);
        else await A.page.mouse.click(at.x, at.y);
        satTap = await pollUntil(async () => (await ride(A)).slot === pl.index + 1, 15000);
        break outer;
      }
    }
    if (!tapInfo) tapInfo = { tries };
  }
  run.check(`${label}: a tap / click on it walks the rider there and sits`, satTap, { tapInfo, start: pl.start, now: await ride(A) });
  results.push({ label, walkE: satE, tap: satTap });
}
writeFileSync(join(OUT, `results-${tag}-${from}-${to}.json`), JSON.stringify(results, null, 1));
await browser.close();
process.exit(run.finish({ tag, from, to }));
