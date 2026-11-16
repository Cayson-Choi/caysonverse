/**
 * e2e/mountains-look.mjs — the distant mountains (B6, 2026-11-16): first-person views toward the horizon at several
 * hours, from the plaza and from the east (lake) and west (waterfall) edges of the walk area. HUD hidden.
 *
 *   node e2e/mountains-look.mjs [--out=<dir>] [--tag=after] [--date=2026-11-16] [--times=08:00,12:30,16:30,17:15,21:00]
 *                               [--devices=desktop,phone] [--spots=plaza,lake,falls] [--pitch=4]
 *
 * Each spot has its own list of compass directions (° clockwise from north). Writes PNGs and a JSON with, per frame,
 * the share of the image the mountains take (`__cvMountains` stats when the runtime asset is loaded).
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";

const run = createRun("mountains-look");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DATE = opt("date", "2026-11-16");
const TAG = opt("tag", "shot");
const TIMES = opt("times", "08:00,12:30,16:30,17:15,21:00").split(",");
const DEVICES = opt("devices", "desktop").split(",");
const PITCH = Number(opt("pitch", "4"));
const SPOT_ALL = {
  plaza: { at: [0, 14], dirs: [0, 90, 180, 270] },
  lake: { at: [78, 8], dirs: [80, 110] },
  falls: { at: [-40, -30], dirs: [280, 310] },
};
const SPOTS = opt("spots", "plaza,lake,falls").split(",").filter((s) => s in SPOT_ALL);

let nickSeq = 0;
async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`산${++nickSeq}`);
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
const all = {};
const browser = await launchBrowser();
try {
  for (const dev of DEVICES) {
    for (const time of TIMES) {
      const P = await openPlayer(browser, run, { tag: dev, device: dev === "phone" ? PHONE : DESKTOP, settings: { graphics: dev === "phone" ? "low" : "high" } });
      await run.step(`${dev} ${time}`, async () => {
        await joinVillage(P, time);
        for (const spot of SPOTS) {
          const { at, dirs } = SPOT_ALL[spot];
          await walkAndWait(P, at[0], at[1], 90000, 2.0);
          await hideHud(P);
          let first = true;
          for (const az of dirs) {
            await P.page.evaluate(async ([az, pt]) => {
              const v = await window.__imp("/src/game/viewState.ts");
              if (v.viewState.mode !== "fp") v.enterFp(0);
              v.viewState.fpYaw = (-az * Math.PI) / 180;
              v.viewState.fpPitch = (-pt * Math.PI) / 180;
            }, [az, PITCH]);
            await P.page.waitForFunction(() => window.__cv.getView().blend >= 0.995, null, { timeout: 15000 }).catch(() => {});
            await sleep(first ? 3500 : 1800);
            first = false;
            await P.page.evaluate(() => { const t = window.__cvThree(); const c = t.camera.position; t.scene.traverse((o) => { if (o.isMesh && o.getWorldPosition(c.clone()).distanceTo(c) < 3) o.visible = false; }); });
            await sleep(300);
            const base = `${TAG}-${dev}-${time.replace(":", "")}-${spot}-${az}`;
            await run.shot(P, `${base}.png`);
            all[base] = await P.page.evaluate(() => ({ mountains: window.__cvMountains?.() ?? null, errors: window.__cvErrors?.length ?? 0 }));
            console.log(`   ${base}: ${JSON.stringify(all[base])}`);
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
