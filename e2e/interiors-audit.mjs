/**
 * e2e/interiors-audit.mjs — photo audit of the interiors (houses 1-10 floors 1+2, the lot rooms, the fishing shop, the bus cabin):
 * walks in by the real doors, then shoots a fixed set of photo cameras (window.__cvShot) in each room's own frame.
 *   server:  PORT=2993 npx tsx src/index.ts   (server/)      client: VITE_SERVER_URL=http://localhost:2993 npx vite --port 5993 --strictPort (client/)
 *   CV_CLIENT_URL=http://localhost:5993 node e2e/interiors-audit.mjs --what=houses [--houses=2,3] [--phone] [--night] [--out=<dir>] [--tag=before]
 *   --what=houses|lots|shop   (lots: --rooms=lot_school_class,lot_library_reading)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, areaOf, hideHud } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const what = arg("what", "houses");
const tag = arg("tag", "a");
const run = createRun(`interiors-audit-${what}`);
const OUT = arg("out", join(run.evidence, "audit"));
mkdirSync(OUT, { recursive: true });
const device = phone ? PHONE : DESKTOP;
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "audit", device });
const page = p.page;
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";
const imp = (path) => page.evaluate((x) => window.__imp(x).then(() => true), path);

await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("audit" + Math.floor(Math.random() * 900 + 100));
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await sleep(2500);

async function planned(x, z, tol = 0.6) {
  for (let a = 0; a < 3; a++) {
    const plan = await page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return { ok: plan.why === "here", at: await pos(p), why: plan.why };
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 25000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}
async function walkWay(placeId, x, z) {
  const here = await pos(p);
  if (Math.hypot(here.x, here.z - 14) > 25) await planned(0, 14, 2);
  const h2 = await pos(p);
  const way = await page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [placeId, h2.x, h2.z]);
  for (const w of way) await planned(w.x, w.z, 1.2);
  return planned(x, z, 0.8);
}
const HITCH = process.argv.includes("--hitch");
const startFrames = () => page.evaluate(() => { window.__fr = []; let last = performance.now(); const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__fr) window.__frId = requestAnimationFrame(tick); }; window.__frId = requestAnimationFrame(tick); });
const stopFrames = async (label) => { const f = await page.evaluate(() => { cancelAnimationFrame(window.__frId); const a = window.__fr ?? []; window.__fr = null; return a; }); const s2 = [...f].sort((x, y) => x - y); console.log("HITCH", label, JSON.stringify({ frames: f.length, p50: +s2[Math.floor(s2.length / 2)]?.toFixed(1), max: +Math.max(...f).toFixed(1), over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length })); };
async function waitArea(a, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await areaOf(p)) === a) break; await sleep(150); }
  await page.waitForFunction(() => { const c = document.querySelector(".cv-house-cover"); const f = document.querySelector(".cv-door-fade"); return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0"); }, null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  return (await areaOf(p)) === a;
}
/** shoot named cameras: views = { name: [x,y,z,tx,ty,tz,fov] } in world coords */
async function shoot(prefix, views) {
  await hideHud(p);
  for (const [name, [x, y, z, tx, ty, tz, fov]] of Object.entries(views)) {
    await page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
    await sleep(900);
    await page.screenshot({ path: join(OUT, `${tag}_${prefix}_${name}_${phone ? "ph" : "pc"}.png`) });
  }
  await page.evaluate(() => { window.__cvShot = null; });
  await page.evaluate(() => { for (const e of window.__hidden ?? []) e.style.visibility = ""; });
}
/** a room-frame camera set: frame(lx,lz) -> world; w,d room size; h = ceiling */
function roomViews(frame, w, d, h, fov) {
  const V = {};
  const c = (lx, ly, lz) => { const q = frame(lx, lz); return [q.x, ly, q.z]; };
  const view = (a, b) => [...c(...a), ...c(...b), fov];
  V.c1 = view([0.8, 1.55, 0.8], [w * 0.75, 1.0, d * 0.8]);
  V.c2 = view([w - 0.8, 1.55, 0.8], [w * 0.25, 1.0, d * 0.8]);
  V.c3 = view([0.8, 1.55, d - 0.8], [w * 0.75, 1.0, d * 0.2]);
  V.c4 = view([w - 0.8, 1.55, d - 0.8], [w * 0.25, 1.0, d * 0.2]);
  V.up = view([w / 2, 1.5, d * 0.25], [w / 2, h - 0.2, d * 0.8]);
  V.dn = view([w / 2, 2.2, d * 0.2], [w / 2, 0, d * 0.65]);
  V.fw = view([w / 2, 1.55, 0.6], [w / 2, 1.3, d]);
  V.bw = view([w / 2, 1.55, d - 0.6], [w / 2, 1.3, 0]);
  return V;
}

if (what === "houses") {
  const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntries());
  const places = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES);
  const only = arg("houses", "2,3,4,5,6,7,8,9").split(",").map(Number);
  for (const n of only) {
    const kp = keypads.find((k) => k.buildingId === `house_${n}`);
    const P = places[n];
    const at = await planned(kp.pad.x, kp.pad.z, 0.9);
    console.log(`house ${n} at pad`, at.ok);
    await act(p);
    await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const ch of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${ch}"]`));
    if (HITCH) await startFrames();
    await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
    const inside = await waitArea(`house:house_${n}:1`);
    if (HITCH) await stopFrames(`house_${n}_enter`);
    console.log(`house ${n} inside`, inside);
    const ox = P.exitPad.x - 5.3;
    const fr1 = (lx, lz) => ({ x: ox + lx, z: 0 - lz });
    await shoot(`h${n}f1`, roomViews(fr1, 10.6, 7.8, 3.7, phone ? 80 : 70));
    // up
    const upAt = await planned(P.upPad.x, P.upPad.z, 0.7);
    await act(p);
    const up = await waitArea(`house:house_${n}:2`, 15000);
    console.log(`house ${n} up`, up, upAt.ok);
    if (up) {
      const fr2 = (lx, lz) => ({ x: ox + lx, z: 30 - lz });
      await shoot(`h${n}f2`, roomViews(fr2, 10.6, 7.8, 3.7, phone ? 80 : 70));
      // back down + out
      const t = await targets(p);
      await act(p);
      await waitArea(`house:house_${n}:1`, 15000);
    }
    await planned(P.exitPad.x, P.exitPad.z, 0.7);
    await act(p);
    await waitArea("village", 15000);
  }
}

if (what === "lots") {
  const rooms = arg("rooms", "lot_school_class,lot_library_reading").split(",");
  for (const unit of rooms) {
    const info = await page.evaluate(async (unit) => {
      const L = await window.__imp("/shared/src/village/villageLots.ts");
      const r = L.LOT_ROOMS.find((x) => x.unit.id === unit);
      const d = L.lotDoorPoint(r.lot, r.door);
      return { lot: r.lot.id, area: r.area, door: r.door.id, pad: d.pad, arrival: d.arrival, inside: L.lotRoomDoor(r), bounds: r.bounds, ceiling: r.ceiling, origin: r.origin };
    }, unit);
    await walkWay(info.lot, info.arrival.x, info.arrival.z);
    await planned(info.pad.x, info.pad.z, 0.6);
    await sleep(1800);
    if (HITCH) await startFrames();
    await act(p);
    const ok = await waitArea(info.area, 25000);
    if (HITCH) await stopFrames(`${unit}_enter`);
    console.log(unit, "inside", ok, JSON.stringify(info.bounds), info.ceiling);
    const b = info.bounds;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const fr = (lx, lz) => ({ x: b.minX + lx, z: b.minZ + lz });
    await shoot(unit, roomViews(fr, w, d, info.ceiling ?? 3.5, phone ? 80 : 70));
    await planned(info.inside.exitPad.x, info.inside.exitPad.z, 0.7);
    await act(p);
    await waitArea("village", 25000);
  }
}

if (what === "shop") {
  await walkWay("lake", 101, -16);
  await sleep(6000);
  const fr = (lx, lz) => ({ x: 98.4 + lx, z: -24.6 + lz });
  await shoot("shop", roomViews(fr, 7.2, 4.7, 2.9, phone ? 80 : 72));
}

if (what === "cafe") {
  await walkWay("cafe", 40, -14);
  await sleep(4000);
  // cafe 20 x 15 centred (50.6,-15.1): shoot the inside from near the glass front looking in and from inside corners
  const V = {
    a: [52, 1.6, -9.5, 50, 1.2, -18, 70],
    b: [44, 1.6, -10, 56, 1.2, -19, 70],
    c: [57, 1.6, -10, 45, 1.2, -19, 70],
    d: [50.6, 1.6, -20, 50.6, 1.2, -10, 70],
    e: [50, 1.3, -14, 50, 3.0, -17, 80],
    f: [44.5, 1.6, -13, 56, 1.3, -14, 70],
  };
  await shoot("cafe", V);
}
console.log("errors", JSON.stringify(run.errors).slice(0, 500));
await browser.close();
