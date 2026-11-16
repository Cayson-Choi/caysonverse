/**
 * e2e/sky-finder-b3.mjs — B3: the real night sky and the new star finder, on PC and phone.
 *
 *   node e2e/sky-finder-b3.mjs --out=<dir> [--device=desktop|phone] [--times=2026-11-16T22:00,...] [--looks=E:30,S:35]
 *                              [--pick=0] [--tag=x]
 *
 * Per time: join the village at the pinned Korean time, (1) the bare sky (HUD hidden) toward each look "AZ:ALT" (az: N/E/S/W or
 * degrees), (2) the 🔭 card (the list), (3) tap the first (or --pick=N) row and look at the sky 3 s later (lines, name, card).
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("sky-finder-b3");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DEVICE = opt("device", "desktop");
const TIMES = opt("times", "2026-11-16T22:00").split(",");
const LOOKS = opt("looks", "E:30,S:35").split(",").filter(Boolean);
const PICK = Number(opt("pick", "0"));
const TAG = opt("tag", DEVICE);
run.allow("D3D X3595", /X3595/);
const AZ = { N: 0, E: 90, S: 180, W: 270 };
let seq = 0;
const result = {};

async function joinVillage(p, time) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`별${++seq}${Math.floor(Math.random() * 90 + 10)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvSky, null, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await p.page.waitForFunction(() => window.__cvSky?.().loaded && window.__cvSky().visible, null, { timeout: 40000 });
  await sleep(1500);
}
const lookAt = async (p, az, alt) => {
  await p.page.evaluate(
    async ([a, h]) => {
      const v = await window.__imp("/src/game/viewState.ts");
      if (v.viewState.mode !== "fp") v.enterFp(0);
      v.viewState.fpYaw = (-a * Math.PI) / 180;
      v.viewState.fpPitch = (-h * Math.PI) / 180;
    },
    [az, alt],
  );
  await sleep(1600);
};
const hud = (p, on) =>
  p.page.evaluate((show) => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el) || el.closest(".cv-sky-layer")) continue;
      el.style.visibility = show ? "" : "hidden";
    }
  }, on);

const browser = await launchBrowser();
try {
  const P = await openPlayer(browser, run, { tag: TAG, device: DEVICE === "phone" ? PHONE : DESKTOP, settings: { graphics: DEVICE === "phone" ? "low" : "high" } });
  for (const time of TIMES) {
    const key = time.replace(/[:]/g, "");
    await run.step(`${DEVICE} ${time}`, async () => {
      await joinVillage(P, time);
      const probe = await P.page.evaluate(() => window.__cvSky());
      const fov = await P.page.evaluate(() => window.__cvThree().camera.fov);
      result[time] = { fov, stars: probe.stars, planets: probe.planets, moon: probe.moon, limit: probe.limit };
      await hud(P, false);
      for (const look of LOOKS) {
        const [d, h] = look.split(":");
        const az = d in AZ ? AZ[d] : Number(d);
        await lookAt(P, az, Number(h));
        await P.page.screenshot({ path: join(OUT, `${TAG}-${key}-sky-${d}${h}.png`) });
      }
      await hud(P, true);
      // the card
      const btn = P.page.locator('button[aria-label="별자리 찾기"]').first();
      await press(P, btn);
      await sleep(1800);
      await P.page.screenshot({ path: join(OUT, `${TAG}-${key}-card-list.png`) });
      const rows = P.page.locator(".cv-sky-row");
      const n = await rows.count();
      result[time].rows = await rows.evaluateAll((els) => els.map((e) => e.innerText.replace(/\n/g, " / ")));
      if (n > 0) {
        await press(P, rows.nth(Math.min(PICK, n - 1)));
        await sleep(3500);
        await P.page.screenshot({ path: join(OUT, `${TAG}-${key}-card-pick.png`) });
        const fin = await P.page.evaluate(() => window.__cvSky().finder);
        result[time].picked = { target: fin.targetId, alt: fin.targetAlt, az: fin.targetAz };
        const look = await P.page.evaluate(async () => {
          const v = await window.__imp("/src/game/viewState.ts");
          return { yaw: v.viewState.fpYaw, pitch: v.viewState.fpPitch };
        });
        result[time].look = look;
        // the sky alone, with the lines and name on it
        await hud(P, false);
        await P.page.screenshot({ path: join(OUT, `${TAG}-${key}-pick-sky.png`) });
        await hud(P, true);
      }
      await P.page.locator(".cv-sky-card .cv-sky-btn[aria-label='별자리 찾기 닫기']").first().click().catch(() => {});
    });
  }
} finally {
  writeFileSync(join(OUT, `${TAG}-result.json`), JSON.stringify(result, null, 2));
  await browser.close();
  await run.finish?.();
}
