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
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { hideHud, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const tag = arg("tag", "before");
const OUT = arg("out", "D:/ClaudeCode/tmpshots/glass");
const KEYS = arg("keys", "day,dusk,night").split(",");
const ONLY = arg("only", "").split(",").filter(Boolean);
const TIMES = { day: "2026-11-16T12:30", dusk: "2026-11-16T17:00", night: "2026-11-16T22:30" };
mkdirSync(OUT, { recursive: true });

/** Cameras: eye (x, y, z) → target (tx, ty, tz); `door` holds that lot door open. */
const SHOTS = [
  { id: "school_door", door: "lot_school_main", x: 51, y: 1.7, z: 15, tx: 60.5, ty: 2.2, tz: 15 },
  { id: "school_win", x: 52, y: 1.8, z: 4, tx: 60.5, ty: 2.6, tz: 12 },
  { id: "library_door", door: "lot_library_main", x: -44, y: 1.7, z: 12, tx: -53, ty: 2.2, tz: 12 },
  { id: "library_win", x: -45, y: 1.8, z: 3, tx: -53, ty: 2.6, tz: 9 },
  { id: "temple_door", door: "lot_temple_main", x: -47, y: 1.7, z: -37, tx: -55, ty: 2.4, tz: -37 },
  { id: "temple_close", door: "lot_temple_main", x: -51.5, y: 1.6, z: -37, tx: -56, ty: 2.2, tz: -37 },
  { id: "church_door", door: "lot_church_main", x: 0, y: 1.7, z: 46, tx: 0, ty: 2.4, tz: 55 },
  { id: "chapel_door", door: "lot_chapel_main", x: 35, y: 1.7, z: -37, tx: 43, ty: 2.4, tz: -37 },
  { id: "memorial_door", x: 0, y: 1.7, z: -44, tx: 0, ty: 1.8, tz: -53 },
  { id: "house1", x: 18, y: 1.7, z: -30, tx: 21, ty: 2.6, tz: -38 },
  { id: "house4", x: -29, y: 1.7, z: 28, tx: -32.4, ty: 2.6, tz: 35.2 },
  { id: "house5", x: -33, y: 1.7, z: -11, tx: -41.2, ty: 2.6, tz: -8 },
  { id: "cafe", x: 42, y: 1.7, z: -18, tx: 47.8, ty: 2.0, tz: -15 },
  { id: "bus_out" },
  { id: "bus_seat" },
];

const run = createRun("glass-shots");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: phone ? "ph" : "pc", device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
const page = P.page;
const report = {};

for (const key of KEYS) {
  await joinVillage(P, "gls", TIMES[key]);
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
          const p = at(0.3, 0.5), t = at(-3, 1.5);
          return { x: p[0], y: 1.75, z: p[1], tx: t[0], ty: 1.6, tz: t[1], fov: 60 };
        }
        const p = at(-7, -2.5), t = at(0, 0);
        return { x: p[0], y: 1.8, z: p[1], tx: t[0], ty: 1.6, tz: t[1] };
      }, s.id === "bus_seat");
    }
    if (s.door) await page.evaluate((d) => window.__cvLotsDoor?.(d, 1), s.door);
    await page.evaluate((c) => (window.__cvShot = { x: c.x, y: c.y, z: c.z, tx: c.tx, ty: c.ty, tz: c.tz, fov: c.fov }), cam);
    await sleep(4000);
    const file = join(OUT, `${tag}_${phone ? "phone" : "pc"}_${s.id}_${key}.png`);
    await page.screenshot({ path: file });
    report[`${s.id}_${key}`] = await page.evaluate(() => {
      const r = window.__cvThree?.().gl?.info?.render;
      return r ? { calls: r.calls, tris: r.triangles } : null;
    });
    if (s.door) await page.evaluate((d) => window.__cvLotsDoor?.(d, null), s.door);
    console.log("shot", file, JSON.stringify(report[`${s.id}_${key}`]));
  }
  await page.evaluate(() => (window.__cvShot = null));
}
writeFileSync(join(OUT, `${tag}_${phone ? "phone" : "pc"}_stats.json`), JSON.stringify(report, null, 1));
await browser.close();
run.finish?.();
