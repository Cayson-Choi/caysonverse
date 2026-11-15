/**
 * e2e/light-spots.mjs — fixed camera spots, luminance histogram per spot (B7: daytime brightness).
 *
 *   node e2e/light-spots.mjs [--out=<dir>] [--phases=noon,golden,dusk,night] [--tiers=high,low] [--date=2026-11-03] [--tag=before]
 *
 * Spots: plaza, street, cafe, field, busstop. HUD hidden, frame PNG per spot named `<tag>-<tier>-<phase>-<spot>.png`.
 * Prints gamma-luma mean, p5, p50, p95 and the share of pixels with luma >= 0.98 (clipped highlights).
 */
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { decodePng, gammaLuma, percentile } from "./luma-check.mjs";

const run = createRun("light-spots");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const TIERS = opt("tiers", "high,low").split(",");
const DATE = opt("date", "2026-11-03");
const TAG = opt("tag", "shot");
const PHASES = { noon: "12:30", golden: "17:06", dusk: "17:37", night: "21:00", dawn: "06:49" };
const WANT = opt("phases", "noon").split(",").filter((p) => p in PHASES);
// [name, walk to, look at, orbit distance, pitch]
const SPOTS = [
  ["plaza", [0, 14], [0, -20], 7, 0.3],
  ["street", [-20, 5], [-14, -30], 7, 0.25],
  ["field", [-10, 42], [-10, 80], 8, 0.25],
  ["busstop", [38, -2], [42, -20], 7, 0.25],
  ["cafe", [41, -13], [60, -15], 7, 0.25],
];

let nickSeq = 0;
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`빛${++nickSeq}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(3000);
}
async function setOrbit(p, distance, pitch) {
  const vp = p.page.viewportSize();
  const cx = vp.width / 2, cy = vp.height / 2;
  await p.page.mouse.move(cx, cy);
  for (let k = 0; k < 12; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.abs(o.distance - distance) < 0.6) break;
    await p.page.mouse.wheel(0, (distance - o.distance) * 100);
    await sleep(250);
  }
  for (let k = 0; k < 10; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const diff = pitch - o.pitch;
    if (Math.abs(diff) < 0.05) break;
    const dy = Math.max(-260, Math.min(260, diff * 220));
    await p.page.mouse.move(cx, cy);
    await p.page.mouse.down();
    for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy + (dy * s) / 8);
    await p.page.mouse.up();
    await sleep(300);
    const after = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.sign(after.pitch - o.pitch) !== Math.sign(diff) && Math.abs(after.pitch - o.pitch) > 0.01) {
      await p.page.mouse.move(cx, cy);
      await p.page.mouse.down();
      for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy - (2 * dy * s) / 8);
      await p.page.mouse.up();
      await sleep(300);
    }
  }
  await sleep(1200);
}
const hideHud = (p) => p.page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const keep = new Set();
  for (let e = canvas; e; e = e.parentElement) keep.add(e);
  for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
});
const r3 = (n) => Math.round(n * 1000) / 1000;
const all = {};
const browser = await launchBrowser();
try {
  for (const tier of TIERS) {
    for (const phase of WANT) {
      const P = await openPlayer(browser, run, { tag: tier, device: tier === "high" ? DESKTOP : PHONE, settings: { graphics: tier } });
      await run.step(`${tier} ${phase}`, async () => {
        await joinVillage(P, PHASES[phase]);
        for (const [name, [wx, wz], [lx, lz], dist, pitch] of SPOTS) {
          await walkAndWait(P, wx, wz, 60000, 1.5);
          await turnCameraTo(P, lx, lz);
          await setOrbit(P, dist, pitch);
          await hideHud(P);
          await sleep(400);
          const base = `${TAG}-${tier}-${phase}-${name}`;
          await run.shot(P, `${base}.png`);
          const { rgba } = decodePng(readFileSync(join(OUT, `${base}.png`)));
          const n = rgba.length / 4;
          const ys = new Float64Array(n);
          let sum = 0, clip = 0, dark = 0;
          for (let i = 0; i < n; i++) {
            const y = gammaLuma(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
            ys[i] = y; sum += y; if (y >= 0.98) clip++; if (y < 0.1) dark++;
          }
          ys.sort();
          const row = { mean: r3(sum / n), p5: r3(percentile(ys, 5)), p50: r3(percentile(ys, 50)), p95: r3(percentile(ys, 95)), clip: r3(clip / n), dark: r3(dark / n) };
          all[base] = row;
          console.log(`   ${base}: ${JSON.stringify(row)}`);
        }
      });
      await P.ctx.close();
    }
  }
} finally {
  await browser.close();
}
writeFileSync(join(OUT, `${TAG}-stats.json`), JSON.stringify(all, null, 2));
process.exit(run.finish({ all }));
