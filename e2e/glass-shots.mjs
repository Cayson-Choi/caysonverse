/**
 * e2e/glass-shots.mjs — the village's windows and open doorways from OUTSIDE (clear glass, feat/clear-glass): fixed photo cameras
 * (window.__cvShot) before the school, library, temple, church, chapel, memorial, three houses, the café and the bus, with the
 * lots' doors held open (`__cvLotsDoor`) and their detail forced, at the day, the evening's golden hour and the night.
 * Also a seat-height camera inside the parked bus looking out of its side window.
 *
 *   server:  PORT=3001 npx tsx src/index.ts   (server/)      client: VITE_SERVER_URL=http://localhost:3001 npx vite --port 5601 --strictPort (client/)
 *   CV_CLIENT_URL=http://localhost:5601 node e2e/glass-shots.mjs [--phone] [--out=<dir>] [--tag=before] [--keys=day,dusk,night] [--only=temple,bus]
 *   Prints the frame's numbers per shot (draw calls, triangles) from window.__cvStats when present.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { hideHud } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const tag = arg("tag", "before");
const OUT = arg("out", "D:/ClaudeCode/tmpshots/glass");
const KEYS = arg("keys", "day,dusk,night").split(",");
const ONLY = arg("only", "").split(",").filter(Boolean);
/** Extra DEV query (`--q=rooms=off`: no room drawn behind the glass — the "before" cost). */
const Q = arg("q", "");
const TIMES = { day: "2026-11-16T12:30", dusk: "2026-11-16T17:00", night: "2026-11-16T22:30" };
mkdirSync(OUT, { recursive: true });

/** Cameras: eye (x, y, z) → target (tx, ty, tz); `door` holds that lot door open. */
const SHOTS = [
  { room: "lot_school_class", id: "school_door", door: "lot_school_main", x: 51, y: 1.7, z: 15, tx: 60.5, ty: 2.2, tz: 15 },
  { room: "lot_school_class", id: "school_win", x: 52, y: 1.8, z: 4, tx: 60.5, ty: 2.6, tz: 12 },
  { room: "lot_library_reading", id: "library_door", door: "lot_library_main", x: -44, y: 1.7, z: 12, tx: -53, ty: 2.2, tz: 12 },
  { room: "lot_library_reading", id: "library_win", x: -45, y: 1.8, z: 3, tx: -53, ty: 2.6, tz: 9 },
  { room: "lot_temple_hall", id: "temple_door", door: "lot_temple_main", x: -47, y: 1.7, z: -37, tx: -55, ty: 2.4, tz: -37 },
  { room: "lot_temple_hall", id: "temple_close", door: "lot_temple_main", x: -51.5, y: 1.6, z: -37, tx: -56, ty: 2.2, tz: -37 },
  { room: "lot_church_nave", id: "church_door", door: "lot_church_main", x: 0, y: 1.7, z: 46, tx: 0, ty: 2.4, tz: 55 },
  { room: "lot_chapel_nave", id: "chapel_door", door: "lot_chapel_main", x: 35, y: 1.7, z: -37, tx: 43, ty: 2.4, tz: -37 },
  { hall: true, id: "memorial_door", x: 0, y: 1.7, z: -44, tx: 0, ty: 1.8, tz: -53 },
  { hall: true, id: "memorial_close", x: 1.2, y: 1.6, z: -50, tx: -0.5, ty: 1.5, tz: -60 },
  { house: 1, id: "house1", x: 18, y: 1.7, z: -30, tx: 21, ty: 2.6, tz: -38 },
  { house: 4, id: "house4", x: -27, y: 1.7, z: 30, tx: -32.4, ty: 2.6, tz: 35.2 },
  { house: 5, id: "house5", x: -33, y: 1.7, z: -11, tx: -41.2, ty: 2.6, tz: -8 },
  { id: "cafe", x: 42, y: 1.7, z: -18, tx: 47.8, ty: 2.0, tz: -15 },
  { id: "bus_out" },
  { id: "bus_seat" },
];

const run = createRun("glass-shots");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: phone ? "ph" : "pc", device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
const page = P.page;
const report = {};

async function enterVillage(time) {
  await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}${Q ? "&" + Q : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(P);
  await page.locator("input.cv-input").first().fill(`gls${Math.floor(Math.random() * 9000 + 1000)}`);
  await press(P, page.locator(".cv-submit"));
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(1500);
}

for (const key of KEYS) {
  await enterVillage(TIMES[key]);
  await page.waitForFunction(() => window.__cvLots?.()?.ready && window.__cvBus, null, { timeout: 120000 }).catch(() => {});
  await hideHud(P);
  for (const s of SHOTS) {
    if (ONLY.length && !ONLY.some((o) => s.id.startsWith(o))) continue;
    let cam = s;
    if (s.id.startsWith("bus")) {
      cam = await page.evaluate((seat) => {
        const n = window.__cvBus();
        const r = n.root;
        r.updateWorldMatrix(true, false);
        const e = r.matrixWorld.elements;
        // the bus's frame: its local +z is the nose (prepared nose north = -z? use the matrix's columns)
        const ax = [e[0], e[2]], az = [e[8], e[10]];
        const o = [e[12], e[14]];
        const at = (lx, lz) => [o[0] + ax[0] * lx + az[0] * lz, o[1] + ax[1] * lx + az[1] * lz];
        if (seat) {
          // a seated rider's eye by the aisle, looking out of the kerb-side windows (local −x)
          const p = at(0.5, 1.0), t = at(-4, 1.4);
          return { x: p[0], y: 1.6, z: p[1], tx: t[0], ty: 1.45, tz: t[1], fov: 65 };
        }
        const p = at(-7, -2.5), t = at(0, 0);
        return { x: p[0], y: 1.8, z: p[1], tx: t[0], ty: 1.6, tz: t[1] };
      }, s.id === "bus_seat");
    }
    if (s.door) await page.evaluate((d) => window.__cvLotsDoor?.(d, 1), s.door);
    await page.evaluate((c) => (window.__cvShot = { x: c.x, y: c.y, z: c.z, tx: c.tx, ty: c.ty, tz: c.tz, fov: c.fov }), cam);
    await sleep(2500);
    // the room behind the glass (portal/RoomShowcase.tsx): wait until it is drawn
    const wantRooms = !Q.includes("rooms=off");
    if (wantRooms && s.room) await page.waitForFunction((r) => window.__cvRoomShowcase?.()?.shown.includes(r), s.room, { timeout: 150000 }).catch(() => console.log("room not drawn", s.room));
    if (wantRooms && s.house) await page.waitForFunction((n) => window.__cvHouseShowcase?.()?.shown === n, s.house, { timeout: 150000 }).catch(() => console.log("house not drawn", s.house));
    if (wantRooms && s.hall) await page.waitForFunction(() => window.__cvMemorialShown === true, null, { timeout: 150000 }).catch(() => console.log("hall not drawn"));
    await sleep(2500);
    const file = join(OUT, `${tag}_${phone ? "phone" : "pc"}_${s.id}_${key}.png`);
    await page.screenshot({ path: file });
    // the frame's cost here: the renderer's counters and the frame time over 2 s (dev build, this machine: compare before / after only)
    report[`${s.id}_${key}`] = await page.evaluate(async () => {
      const r = window.__cvRenderInfo?.();
      const ft = await new Promise((done) => {
        const t = [];
        let last = performance.now();
        const step = (now) => {
          t.push(now - last);
          last = now;
          if (t.length < 120) requestAnimationFrame(step);
          else done(t.slice(10).sort((a, b) => a - b));
        };
        requestAnimationFrame(step);
      });
      return r ? { calls: r.calls, tris: r.triangles, textures: r.textures, geometries: r.geometries, p50ms: +ft[Math.floor(ft.length / 2)].toFixed(1), p95ms: +ft[Math.floor(ft.length * 0.95)].toFixed(1) } : null;
    });
    if (s.door) await page.evaluate((d) => window.__cvLotsDoor?.(d, null), s.door);
    console.log("shot", file, JSON.stringify(report[`${s.id}_${key}`]));
  }
  await page.evaluate(() => (window.__cvShot = null));
}
writeFileSync(join(OUT, `${tag}_${phone ? "phone" : "pc"}_stats.json`), JSON.stringify(report, null, 1));
await browser.close();
run.finish?.();
