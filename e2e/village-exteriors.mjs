/**
 * e2e/village-exteriors.mjs — 집 외관 A8 X3 (the houses' own model in the game): photo-camera street views of all ten houses, an
 * aerial of each, by day / sunset / night, PC and phone, with the houses' numbers (draw calls, triangles, the detail shown, FPS).
 * The DEV photo camera (`window.__cvShot`, CameraRig) frames the shots; the avatar stays where it joined. `--old` shows the old
 * houses (`?houses=old`: the A7 houses baked into village.glb) for the before sheet.
 *
 *   server:  PORT=3100 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3100 npx vite --port 5700 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5700 node e2e/village-exteriors.mjs [--out=<dir>] [--tag=after] [--old]
 *        [--times=12:30,17:20,21:30] [--devices=desktop,phone] [--houses=1,..,10] [--views=street,aerial]
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("village-exteriors");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OLD = args.includes("--old");
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DATE = opt("date", "2026-11-16");
const TAG = opt("tag", OLD ? "before" : "after");
const TIMES = opt("times", "12:30,17:20,21:30").split(",");
const DEVICES = opt("devices", "desktop").split(",");
const HOUSES = opt("houses", "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
const VIEWS = opt("views", "street,aerial").split(",");

let nickSeq = 0;
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}${OLD ? "&houses=old" : ""}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`집${++nickSeq}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  if (!OLD) await p.page.waitForFunction(() => window.__cvHouses?.()?.ready === true, null, { timeout: 90000 }).catch(() => {});
  await sleep(4000);
}
const hideHud = (p) =>
  p.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
  });

/** A house's local point (x right of the door, z out of it) in the world (houseExterior.ts houseLocalToWorld). */
function local(h, lx, lz) {
  const { x: cx, z: cz } = h.centre;
  switch (h.doorSide) {
    case "s": return [cx + lx, cz + lz];
    case "n": return [cx - lx, cz - lz];
    case "e": return [cx + lz, cz - lx];
    case "w": return [cx - lz, cz + lx];
  }
}
const ZF = 3.125;
const ZC = -1.075;
/** Houses with a neighbour close in front of them: a nearer street view (as the look-dev). */
const NEAR = { 7: 5.5, 9: 5.5, 8: 6.5 };
function shotFor(h, n, view) {
  if (view === "aerial") {
    const [x, z] = local(h, -14, ZF + 16);
    const [tx, tz] = local(h, 0, 0);
    return { x, y: 17, z, tx, ty: 2.5, tz, fov: 50 };
  }
  const d = NEAR[n];
  const [x, z] = d ? local(h, -0.45 * d, ZF + d) : local(h, -7.5, ZF + 13.5);
  const [tx, tz] = local(h, 0.3, ZC + 1.0);
  return { x, y: 1.6, z, tx, ty: d ? 4.6 : 4.9, tz, fov: d ? 70 : 50 };
}

const all = {};
const browser = await launchBrowser();
try {
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const P = await openPlayer(browser, run, { tag: dev, device: dev === "phone" ? PHONE : DESKTOP, settings: { graphics: dev === "phone" ? "low" : "high" } });
      await run.step(`${dev} ${time}`, async () => {
        await joinVillage(P, time);
        await hideHud(P);
        const houses = await P.page.evaluate(async () => (await window.__imp("/shared/src/village/villageLayout.ts")).VILLAGE_LAYOUT.sceneryHouses.filter((h) => h.kind === "house"));
        const key = `${dev}-${time.replace(":", "")}`;
        all[key] = {};
        for (const n of HOUSES) {
          const h = houses.find((x) => x.id === `house_${n}`);
          for (const view of VIEWS) {
            const shot = shotFor(h, n, view);
            await P.page.evaluate((s) => (window.__cvShot = s), shot);
            await sleep(1400);
            const file = join(OUT, `${TAG}-${key}-house${n}-${view}.png`);
            await P.page.screenshot({ path: file });
            const stats = await P.page.evaluate(() => {
              const gl = window.__cvThree().gl;
              return { calls: gl.info.render.calls, tris: gl.info.render.triangles, houses: window.__cvHouses?.() ?? null };
            });
            all[key][`house${n}-${view}`] = { file, ...stats };
          }
        }
        await P.page.evaluate(() => (window.__cvShot = null));
      });
      await P.ctx?.close?.().catch(() => {});
    }
  }
} finally {
  writeFileSync(join(OUT, `${TAG}-exteriors.json`), JSON.stringify(all, null, 1));
  await browser.close();
  process.exitCode = run.finish();
}
