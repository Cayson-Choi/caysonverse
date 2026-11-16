/**
 * e2e/sky-glare.mjs — sky brightness check (2026-11-16 owner report: the daytime sky was a blown-out milky haze).
 *
 *   node e2e/sky-glare.mjs [--out=<dir>] [--tag=before] [--date=2026-11-16] [--times=08:00,11:30,...] [--devices=desktop,phone]
 *                          [--spots=plaza,street] [--dirs=N,E,S,W] [--pitches=15,35]
 *
 * First-person camera at a spot, pitched up toward the sky and turned to each compass direction. HUD hidden.
 * Per frame: stats over the UPPER HALF of the image (the sky when pitched up): gamma-luma mean / p95, clipped share (luma >= 0.98),
 * near-white share (luma >= 0.9 and saturation < 0.12) and mean saturation (a blue sky has colour, a white wall has none).
 */
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { decodePng, gammaLuma, percentile } from "./luma-check.mjs";

const run = createRun("sky-glare");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DATE = opt("date", "2026-11-16");
const TAG = opt("tag", "shot");
const TIMES = opt("times", "08:00,11:30,14:00,16:45,17:20,17:50,21:00").split(",");
const DEVICES = opt("devices", "desktop").split(",");
const SPOT_ALL = { plaza: [0, 14], street: [-20, 5] };
const SPOTS = opt("spots", "plaza").split(",").filter((s) => s in SPOT_ALL);
const AZ = { N: 0, E: 90, S: 180, W: 270 };
const DIRS = opt("dirs", "N,E,S,W").split(",");
const PITCHES = opt("pitches", "15,35").split(",").map(Number);

let nickSeq = 0;
let first = true;
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`하늘${++nickSeq}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(3000);
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
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const P = await openPlayer(browser, run, { tag: dev, device: dev === "phone" ? PHONE : DESKTOP, settings: { graphics: dev === "phone" ? "low" : "high" } });
      await run.step(`${dev} ${time}`, async () => {
        await joinVillage(P, time);
        for (const spot of SPOTS) {
          const [wx, wz] = SPOT_ALL[spot];
          await walkAndWait(P, wx, wz, 60000, 1.5);
          first = true;
          await hideHud(P);
          for (const d of DIRS) {
            for (const pitch of PITCHES) {
              await P.page.evaluate(async ([az, pt]) => {
                const v = await window.__imp("/src/game/viewState.ts");
                if (v.viewState.mode !== "fp") v.enterFp(0);
                v.viewState.fpYaw = (-az * Math.PI) / 180;
                v.viewState.fpPitch = (-pt * Math.PI) / 180;
              }, [AZ[d], pitch]);
              await sleep(first ? 3500 : 1800); first = false;
              const base = `${TAG}-${dev}-${time.replace(":", "")}-${spot}-${d}${pitch}`;
              await run.shot(P, `${base}.png`);
              const { rgba, width, height } = decodePng(readFileSync(join(OUT, `${base}.png`)));
              const rows = Math.floor(height / 2);
              const n = width * rows;
              const ys = new Float64Array(n);
              let sum = 0, clip = 0, white = 0, sat = 0;
              for (let i = 0; i < n; i++) {
                const r = rgba[i * 4], g = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
                const y = gammaLuma(r, g, b);
                const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
                const s = mx ? (mx - mn) / mx : 0;
                ys[i] = y; sum += y; sat += s;
                if (y >= 0.98) clip++;
                if (y >= 0.9 && s < 0.12) white++;
              }
              ys.sort();
              const row = { mean: r3(sum / n), p95: r3(percentile(ys, 95)), clip: r3(clip / n), white: r3(white / n), sat: r3(sat / n) };
              all[base] = row;
              console.log(`   ${base}: ${JSON.stringify(row)}`);
            }
          }
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
