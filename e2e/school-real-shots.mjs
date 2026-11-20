/**
 * e2e/school-real-shots.mjs — the classroom (lot_school_class) up close: walks in by the real door, then shoots fixed photo
 * cameras (window.__cvShot) at the player's eye level and close up (the shelves, a book row, the tables, the bay window, the globe,
 * the fireplace, the desk, the ceiling), and prints the room's numbers (__cvLotRoom: triangles, draws, texture MB).
 *   server:  PORT=2951 npx tsx src/index.ts   (server/)      client: VITE_SERVER_URL=http://localhost:2951 npx vite --port 5951 --strictPort (client/)
 *   CV_CLIENT_URL=http://localhost:5951 node e2e/school-real-shots.mjs [--phone] [--night] [--out=<dir>] [--tag=before]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, waitIdle, walkTo } from "./lib/common.mjs";
import { act, areaOf, hideHud } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const tag = arg("tag", "a");
const run = createRun("school-real-shots");
const OUT = arg("out", join(run.evidence, "school"));
mkdirSync(OUT, { recursive: true });
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "sch", device: phone ? PHONE : DESKTOP });
const page = p.page;
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";

await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("sch" + Math.floor(Math.random() * 900 + 100));
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
async function waitArea(a, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await areaOf(p)) === a) break; await sleep(150); }
  await page.waitForFunction(() => { const c = document.querySelector(".cv-house-cover"); const f = document.querySelector(".cv-door-fade"); return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0"); }, null, { timeout: 30000 }).catch(() => {});
  await sleep(3000);
  return (await areaOf(p)) === a;
}

const unit = "lot_school_class";
const info = await page.evaluate(async (unit) => {
  const L = await window.__imp("/shared/src/village/villageLots.ts");
  const r = L.LOT_ROOMS.find((x) => x.unit.id === unit);
  const d = L.lotDoorPoint(r.lot, r.door);
  return { lot: r.lot.id, area: r.area, pad: d.pad, arrival: d.arrival, inside: L.lotRoomDoor(r), bounds: r.bounds, ceiling: r.ceiling };
}, unit);
const here = await pos(p);
if (Math.hypot(here.x, here.z - 14) > 25) await planned(0, 14, 2);
const h2 = await pos(p);
const way = await page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id), x, z); }, [info.lot, h2.x, h2.z]);
for (const w of way) await planned(w.x, w.z, 1.2);
await planned(info.arrival.x, info.arrival.z, 0.8);
await planned(info.pad.x, info.pad.z, 0.6);
await sleep(1800);
await act(p);
const inside = await waitArea(info.area, 25000);
run.check("inside the classroom", inside, info.area);
await sleep(4000);
const stats = await page.evaluate(() => window.__cvLotRoom?.() ?? null);
console.log("ROOM", JSON.stringify(stats));
const dpr = await page.evaluate(() => ({ dpr: window.devicePixelRatio, canvas: [document.querySelector("canvas")?.width, document.querySelector("canvas")?.height] }));
console.log("CANVAS", JSON.stringify(dpr));

const b = info.bounds;
const c = (lx, ly, lz) => [b.minX + lx, ly, b.minZ + lz];
const view = (a, t, fov) => [...c(...a), ...c(...t), fov];
const F = phone ? 70 : 60;
const V = {
  // the player's eye level (1.55 m), whole room
  eye_entry: view([7.7, 1.55, 1.2], [6.0, 1.3, 6.0], F + 10),
  eye_board: view([12.0, 1.55, 4.8], [0.0, 1.4, 5.0], F + 10),
  eye_back: view([2.5, 1.55, 3.0], [12.0, 1.5, 7.4], F + 10),
  eye_reading: view([9.0, 1.55, 3.2], [15.4, 1.3, 6.0], F + 10),
  wide: view([14.9, 2.3, 2.7], [2.0, 0.9, 6.6], F + 15),
  // close up (about 1 m)
  art_back: view([13.4, 1.75, 6.3], [13.4, 1.85, 7.4], 50),
  art_mid: view([9.35, 1.9, 6.3], [9.35, 2.0, 7.4], 50),
  cork: view([1.15, 1.5, 1.25], [0.0, 1.5, 1.25], 55),
  desks: view([3.0, 1.3, 3.2], [4.4, 0.7, 4.4], 45),
  desk_top: view([4.6, 1.2, 4.3], [4.0, 0.72, 3.6], 45),
  chair: view([5.6, 0.9, 2.9], [5.0, 0.4, 3.6], 45),
  board: view([2.6, 1.5, 5.0], [0.0, 1.5, 5.0], 55),
  teacher: view([3.2, 1.5, 6.6], [1.6, 0.9, 5.2], F),
  shelf_back: view([7.7, 1.2, 5.7], [7.7, 0.6, 7.4], F),
  reading: view([11.6, 1.4, 4.6], [15.0, 0.6, 5.0], F),
  lockers: view([7.7, 1.5, 1.6], [3.0, 1.0, 0.2], F),
  ceiling: view([7.7, 1.5, 3.0], [7.7, 3.7, 6.0], F + 10),
  pendant: view([8.4, 2.0, 4.9], [8.4, 2.65, 3.9], 50),
  bunting: view([3.4, 2.1, 4.0], [2.2, 2.9, 5.6], 55),
  books_close: view([13.9, 1.0, 4.4], [15.0, 0.55, 5.0], 45),
  curtains: view([10.6, 1.7, 6.0], [12.2, 2.0, 7.4], 50),
};
await hideHud(p);
for (const [name, [x, y, z, tx, ty, tz, fov]] of Object.entries(V)) {
  await page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
  await sleep(1100);
  await page.screenshot({ path: join(OUT, `${tag}_${name}_${phone ? "ph" : "pc"}_${night ? "night" : "day"}.png`) });
}
await page.evaluate(() => { window.__cvShot = null; });
console.log("errors", JSON.stringify(run.errors).slice(0, 800));
await browser.close();
