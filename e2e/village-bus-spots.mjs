/**
 * e2e/village-bus-spots.mjs — the full place sweep of the village bus (HANDOFF rule 7: every seat / hold spot, PC and phone,
 * day and night). One rider boards, then for each place in --places=a-b (index 0..13 = BUS_SEATS, 14..20 = BUS_HOLDS) walks the
 * aisle with the keys to the aisle point nearest the place's front, takes the action the UI offers there (E / the round
 * button) and checks the server agrees (busSeat); a place the UI did not offer from there is taken with the message
 * directly and counted as "fallback" (reported). Screenshots: the view at the place, then the left / right windows.
 * Optional second rider (--other): a second PC client that boards first and takes a seat, so the sweep also shows another rider.
 *
 *   OFF=$(node -e 'const n=Date.now()+170000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2851 npx tsx src/index.ts)
 *   CV_CLIENT_URL=http://localhost:5451 node e2e/village-bus-spots.mjs --out=<folder> [--phone] [--time=2026-11-03T21:30] [--places=0-6] [--other]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, NOON } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const other = process.argv.includes("--other");
const TIME = arg("time", NOON);
const [from, to] = arg("places", "0-20").split("-").map(Number);
const night = TIME !== NOON;
const tag = `${phone ? "phone" : "pc"}-${night ? "night" : "day"}`;
const run = createRun(`village-bus-spots-${tag}`);
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });
const PHONE_390 = { ...PHONE, viewport: { width: 390, height: 844 } };

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device: phone ? PHONE_390 : DESKTOP });
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
  await p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first().click({ timeout: 4000 }).catch(() => p.page.locator(`[data-testid=bus-ride-views] button[data-view=${name}]`).first().tap({ timeout: 4000 })).catch(() => {}); // the ride may be over
  await sleep(900);
};
async function walkBus(p, ahead, right, tol = 0.2, ms = 12000) {
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
  await sleep(250);
}

// the aisle point to stand at for each place (the shared rules: reachable, approach ok, nearest to the front of a seat / the hold's own spot)

let plan;
await run.step("join and board", async () => {
  await joinVillage(A, "탑승", TIME);
  if (O) await joinVillage(O, "동승", TIME);
  await pollUntil(() => A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null), 30000);
  for (const [p, dx, dz] of [[O, 36.9, -6.0], [A, 37.7, -8.9]]) {
    if (!p) continue;
    await walkAndWait(p, 38.5, -0.5, 40000, 1);
    await walkAndWait(p, dx, dz, 30000, 0.5);
    await sleep(600);
    await act(p);
    run.check("aboard and free", await pollUntil(async () => (await ride(p)).slot === 0 && (await status(p)).boarded, 8000), await status(p));
    if (p === O) {
      // the other rider sits in a middle seat and stays there
      await O.page.evaluate(() => window.__imp("/src/net/transitSync.ts").then((m) => m.sendBusSit("seat", 4))); // seat R2 (a seat the sweep also takes later is skipped by the server: it is taken, so the sweep shows that too)
      await sleep(500);
    }
  }
  await sleep(1500);
});
plan = await A.page.evaluate(async () => {
  const c = await window.__imp("/shared/src/village/busCabin.ts");
  const out = [];
  c.BUS_SEATS.forEach((s, i) => {
    const f = c.seatFrontPoint(s);
    let best = null;
    for (const margin of [0.55, 0.45, 0.38, 0]) {
    if (best) break;
    for (let a = -3.6; a <= 3.4; a += 0.05) for (let r = -0.25; r <= 0.25; r += 0.05) {
      if (c.cabinBlocked(a, r, 0.32) || !c.seatApproachOk(s, a, r) || c.BUS_HOLDS.some((h) => Math.hypot(a - h.ahead, r - h.right) < margin)) continue; // not on a pole's spot (it would be offered first)
      // standing here, facing forward, the seat must be the offered one
      const o = c.nearestFreeSpot(a, r, new Set(), new Set(), undefined, 0);
      const d = Math.hypot(a - f.ahead, r - f.right) + (o && o.kind === "seat" && o.index === i ? 0 : 5);
      if (!best || d < best.d) best = { a, r, d, margin };
    }
    }
    out.push({ kind: "seat", index: i, id: s.id, a: best.a, r: best.r, uiFacingForward: best.d < 5 });
  });
  c.BUS_HOLDS.forEach((h, i) => out.push({ kind: "hold", index: i, id: `H${i + 1}`, a: h.ahead, r: h.right, uiFacingForward: true }));
  return out;
});
writeFileSync(join(OUT, "plan.json"), JSON.stringify(plan, null, 1));

const results = [];
for (const pl of plan.slice(from, Math.min(to, plan.length - 1) + 1)) {
  const label = `${pl.kind} ${pl.id}`;
  if (O && pl.kind === "seat" && pl.index === 4) { results.push({ label, skipped: "the other rider sits here" }); continue; }
  const st = await status(A);
  if (!st.boarded) { results.push({ label, skipped: "ride over" }); continue; }
  const before = await ride(A);
  if (before.slot !== 0) { await act(A); await pollUntil(async () => (await ride(A)).slot === 0, 4000); } // stand up first
  await walkBus(A, pl.a, pl.r, 0.2, 12000);
  let tg = await targetsOf(A);
  const want = `bus_sit:${pl.kind}:${pl.index}`;
  let offered = tg.some((t) => t.id === want);
  let method = "ui";
  // a rider turns to the place they want (the quick views turn the body too): try each way of looking until the UI offers it
  for (const v of offered ? [] : ["back", "left", "right", "front"]) {
    await view(A, v);
    await sleep(500);
    tg = await targetsOf(A);
    if (tg.some((t) => t.id === want)) { offered = true; method = `ui (looking ${v})`; break; }
  }
  if (offered) await act(A);
  else {
    method = "fallback-message";
    await A.page.evaluate(([k, i]) => window.__imp("/src/net/transitSync.ts").then((m) => m.sendBusSit(k, i)), [pl.kind, pl.index]);
  }
  const num = pl.kind === "seat" ? pl.index + 1 : 14 + 1 + pl.index;
  const ok = await pollUntil(async () => (await ride(A)).slot === num, 4000);
  run.check(`${label}: taken (busSeat ${num}) via ${method}`, ok, { offered, offeredNow: tg.map((t) => t.id), at: pl.a.toFixed(2) + "," + pl.r.toFixed(2) });
  results.push({ label, method, ok, offeredUI: offered, uiFacingForward: pl.uiFacingForward });
  await sleep(700);
  await A.page.screenshot({ path: join(OUT, `${tag}-${String(pl.kind === "seat" ? pl.index : 14 + pl.index).padStart(2, "0")}-${pl.id}-view.png`) });
  for (const v of ["left", "right"]) {
    await view(A, v);
    await A.page.screenshot({ path: join(OUT, `${tag}-${String(pl.kind === "seat" ? pl.index : 14 + pl.index).padStart(2, "0")}-${pl.id}-${v}.png`) });
  }
}
writeFileSync(join(OUT, `results-${tag}-${from}-${to}.json`), JSON.stringify(results, null, 1));
await browser.close();
process.exit(run.finish({ tag, from, to }));
