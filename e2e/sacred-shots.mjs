/**
 * e2e/sacred-shots.mjs — before/after photo shots inside the 성당 and 교회 (same cameras every run) + room-entry hitch.
 *   server PORT=2971 (server/), client VITE_SERVER_URL=http://localhost:2971 npx vite --port 5971 --strictPort (client/)
 *   CV_CLIENT_URL=http://localhost:5971 node e2e/sacred-shots.mjs --out=<dir> --device=pc|phone [--rooms=lot_chapel_nave,lot_church_nave]
 * Views are in the room frame (see client/dev/chapelLookdev.ts VIEWS); the world position = room origin + local.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SLOW, CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = arg("out", "shots");
const DEVICE = arg("device", "pc");
const ROOMS = arg("rooms", "lot_chapel_nave,lot_church_nave").split(",").filter((r) => r !== "none");
mkdirSync(OUT, { recursive: true });
const run = createRun("sacred-shots");

// [eye x,y,z (room frame), target x,y,z, fov]
const VIEWS = {
  lot_chapel_nave: {
    wide: [4.7, 1.62, 0.9, 4.7, 2.7, 12.5, 62], altar: [4.7, 1.6, 9.0, 4.7, 2.6, 13.2, 52],
    mary: [2.3, 1.55, 8.3, 0.6, 1.85, 9.9, 45], maryface: [1.4, 1.75, 8.6, 0.6, 1.9, 9.9, 28],
    crucifix: [4.7, 1.9, 10.3, 4.7, 3.4, 13.1, 45], jesusclose: [4.7, 2.9, 11.4, 4.7, 3.55, 13.1, 26], altarclose: [4.7, 1.7, 9.6, 4.7, 1.45, 11.9, 40], flowers: [4.7, 1.75, 10.6, 4.7, 1.5, 12.85, 30], urnflowers: [4.2, 1.8, 9.6, 2.75, 1.6, 12.55, 34],  glass: [6.9, 2.3, 4.3, 9.4, 4.3, 5.1, 55], rose: [4.7, 1.7, 9.6, 4.7, 6.0, 0, 60],
    station: [4.0, 1.7, 4.0, 0.2, 2.0, 4.5, 50], stationclose: [2.4, 1.65, 6.7, 0, 1.65, 6.7, 34],
  },
  lot_church_nave: {
    wide: [3.9, 1.62, 0.8, 3.9, 2.4, 10.4, 62], altar: [3.9, 1.6, 6.9, 3.9, 2.6, 10.4, 52],
    cross: [3.9, 1.7, 8.2, 3.9, 3.4, 10.4, 45], window: [5.2, 1.7, 4.6, 7.8, 3.0, 5.7, 52], ceiling: [3.9, 1.6, 1.2, 3.9, 6.8, 7, 65],
    pulpit: [3.0, 1.6, 5.5, 1.2, 1.4, 9.0, 45], bloch: [2.6, 1.55, 4.3, 0, 1.75, 4.325, 46], rembrandt: [5.2, 1.55, 4.3, 7.8, 1.75, 4.325, 46],
    crossclose: [3.9, 2.4, 7.6, 3.9, 3.2, 10.4, 40], pewback: [3.9, 1.35, 6.8, 1.8, 0.8, 3.9, 55], organ: [4.4, 1.6, 8.0, 7.4, 1.5, 8.0, 42], pews: [1.0, 1.35, 1.0, 3.2, 0.9, 4.0, 60],
    sidewall: [6.6, 1.65, 1.2, 0.5, 1.6, 6.2, 66],
  },
};

const shared = (p, code, a) => p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); ${code} })()`), a);
async function walkPlanned(p, x, z, tol = 0.5) {
  const t0 = Date.now();
  for (let attempt = 0; attempt < 3 && Date.now() - t0 < 90000; attempt++) {
    const plan = await p.page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts"); const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap(); const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return { ok: plan.why === "here", at: await pos(p) };
    for (const w of plan.pts) { await walkTo(p, w.x, w.z); await sleep(300); await waitIdle(p, 20000); }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p); return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}
async function walkWay(p, lotId, x, z) {
  const start = await pos(p);
  if (Math.hypot(start.x, start.z - 14) > 25) await walkPlanned(p, 0, 14, 2);
  const here = await pos(p);
  const way = await p.page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [lotId, here.x, here.z]);
  for (const w of way) await walkPlanned(p, w.x, w.z, 1.2);
  return walkPlanned(p, x, z, 0.8);
}

const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "s", device: DEVICE === "phone" ? PHONE : DESKTOP });
if (process.env.CV_SHOT_LOG) { P.page.on("console", (m) => { if (["error", "warning"].includes(m.type())) console.log("CONSOLE", m.type(), m.text().slice(0, 300)); }); P.page.on("pageerror", (e) => console.log("PAGEERROR", (e.stack || String(e)).slice(0, 900))); }
await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("sh" + Math.floor(Math.random() * 90000 + 10000));
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 * SLOW });
await P.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 });
await P.page.waitForFunction(() => !!window.__cvLots, null, { timeout: 180000 * SLOW });
await sleep(2500);
if (process.env.CV_PLAZA) {
  await P.page.waitForFunction(() => !document.body.innerText.includes("케이슨 마을로 가는 중"), null, { timeout: 120000 * SLOW }).catch(() => {});
  await sleep(3000);
  for (const [name, v] of Object.entries({ plaza: [0, 38, 52, 18, 0, -18, 62], chapel_street: [30, 2.2, -12, 48.5, 7, -37, 55], church_street: [-30, 2.2, -12, -48, 7, -37, 55] })) {
    await P.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, v);
    await sleep(2500);
    await P.page.screenshot({ path: join(OUT, `${DEVICE}_${name}.png`) });
  }
  await P.page.evaluate(() => { window.__cvShot = null; });
}
const numbers = {};
for (const unit of ROOMS) {
  const info = await shared(P, `const r = L.LOT_ROOMS.find((x) => x.unit.id === a); const d = L.lotDoorPoint(r.lot, r.door); return { lot: r.lot.id, area: r.area, door: r.door.id, pad: d.pad, arrival: d.arrival, origin: r.origin, name: r.lot.name };`, unit);
  await walkWay(P, info.lot, info.arrival.x, info.arrival.z);
  await walkPlanned(P, info.pad.x, info.pad.z, 0.6);
  await sleep(1800);
  await P.page.evaluate(() => { window.__fr = []; let l = performance.now(); const t = (n) => { window.__fr.push(n - l); l = n; if (window.__fr) requestAnimationFrame(t); }; requestAnimationFrame(t); });
  await act(P);
  await P.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 90000 * SLOW });
  await P.page.waitForFunction(() => document.querySelector(".cv-house-cover")?.getAttribute("data-phase") !== "loading", null, { timeout: 30000 }).catch(() => {});
  await sleep(3000);
  const fr = await P.page.evaluate(() => { const a = window.__fr; window.__fr = null; return a; });
  const s = [...fr].sort((a, b) => a - b);
  numbers[unit] = { frames: fr.length, p50: r2(s[Math.floor(s.length / 2)]), p99: r2(s[Math.floor(s.length * 0.99)]), max: r2(s[s.length - 1]), over50: fr.filter((x) => x > 50).length,
    room: await P.page.evaluate(() => window.__cvLotRoom?.() ?? null) };
  console.log(unit, JSON.stringify({ ...numbers[unit], room: undefined }));
  await P.page.evaluate(() => document.querySelectorAll(".cv-hud, .cv-chat, [class*=hud]").forEach((e) => (e.style.visibility = "hidden")));
  if (process.env.CV_HIDE) {
    const names = process.env.CV_HIDE.split(",");
    const set = [ox0 => 0];
    for (const nm of ["none", ...names]) {
      await P.page.evaluate((nm) => { const { scene } = window.__cvThree(); scene.traverse((o) => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; if (window.__hid && ms.some((m) => m && window.__hid.split("+").includes(m.name))) o.visible = true; if (nm !== "none" && ms.some((m) => m && nm.split("+").includes(m.name))) o.visible = false; } }); window.__hid = nm; }, nm);
      await P.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [info.origin.x + 4.7, 1.62, info.origin.z + 0.9, info.origin.x + 4.7, 2.7, info.origin.z + 12.5, 62]);
      await sleep(1500);
      await P.page.screenshot({ path: join(OUT, `hide_${nm}.png`) });
    }
  }
  const [ox, oz] = [info.origin.x, info.origin.z];
  for (const [name, v] of Object.entries(VIEWS[unit])) {
    await P.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [ox + v[0], v[1], oz + v[2], ox + v[3], v[4], oz + v[5], v[6]]);
    await sleep(1800);
    await P.page.screenshot({ path: join(OUT, `${DEVICE}_${unit}_${name}.png`) });
  }
  await P.page.evaluate(() => { window.__cvShot = null; });
  // out: the room's own exit action (E)
  await act(P).catch(() => {});
  await sleep(3500);
}
writeFileSync(join(OUT, `numbers_${DEVICE}.json`), JSON.stringify(numbers, null, 1));
await browser.close();
process.exit(0);
