/**
 * e2e/sky-glow.mjs — night-sky glow check (owner 2026-11-20 "별 테두리가 네모나게 빛나냐고"): looks at a bright star / planet / the
 * moon at a pinned village time and saves the frame (HUD hidden) plus the aim point, for contrast-boosted crops (tools: see docs).
 *
 *   CV_CLIENT_URL=http://localhost:5963 node e2e/sky-glow.mjs --out=<dir> --tag=before --shots=sirius@2027-01-15T21:00,moon@2026-11-24T21:00 --devices=desktop-high,desktop-low,phone
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("sky-glow");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const TAG = opt("tag", "shot");
const SHOTS = opt("shots", "sirius@2027-01-15T21:00,moon@2026-11-24T21:00").split(",");
const DEVICES = opt("devices", "desktop-high").split(",");
run.allow("D3D X3595", /X3595/);
let seq = 0;
const browser = await launchBrowser();
const meta = {};
try {
  for (const dev of DEVICES) {
    const phone = dev === "phone";
    const gfx = dev.endsWith("low") || phone ? "low" : "high";
    for (const shot of SHOTS) {
      const [target, time] = shot.split("@");
      const P = await openPlayer(browser, run, { tag: dev, device: phone ? PHONE : DESKTOP, settings: { graphics: gfx } });
      await run.step(`${dev} ${shot}`, async () => {
        await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
        await entryReady(P);
        await P.page.locator("input.cv-input").first().fill(`글로${++seq}${Math.floor(Math.random() * 90 + 10)}`);
        await press(P, P.page.locator(".cv-submit"));
        await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
        await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvSky, null, { timeout: 90000 });
        await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
        await P.page.waitForFunction(() => window.__cvSky?.().loaded && window.__cvSky().visible, null, { timeout: 30000 }).catch(() => {});
        const aim = await P.page.evaluate(async (target) => {
          const s = window.__cvSky();
          let az, alt;
          if (target === "moon") {
            const m = await window.__imp("/src/village/sky/StarSkyExtras.tsx");
            const mo = m.currentMoon(s.utcMs);
            const d = m.moonDirection(mo, [0, 0, 0]);
            alt = (Math.asin(d[1]) * 180) / Math.PI;
            az = ((Math.atan2(d[0], -d[2]) * 180) / Math.PI + 360) % 360;
            return { az, alt, illuminated: mo.illuminated, waxing: mo.waxing, elong: mo.elongationDeg };
          }
          const st = s.stars[target] ?? s.planets.find((p) => p.id === target);
          return { az: st.az, alt: st.alt, planets: s.planets.map((p) => p.id + ":" + Math.round(p.alt)) };
        }, target);
        await P.page.evaluate(
          async ([az, alt]) => {
            const v = await window.__imp("/src/game/viewState.ts");
            if (v.viewState.mode !== "fp") v.enterFp(0);
            v.viewState.fpYaw = (-az * Math.PI) / 180;
            v.viewState.fpPitch = (-alt * Math.PI) / 180;
            const canvas = document.querySelector("canvas");
            const keep = new Set();
            for (let e = canvas; e; e = e.parentElement) keep.add(e);
            const layer = document.querySelector(".cv-sky-layer");
            for (let e = layer; e; e = e.parentElement) keep.add(e);
            for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el) && !(layer && layer.contains(el))) el.style.visibility = "hidden";
          },
          [aim.az, aim.alt],
        );
        await sleep(2500);
        const name = `${TAG}-${dev}-${target}-${time.replace(/[:]/g, "")}`;
        await P.page.screenshot({ path: join(OUT, name + ".png") });
        meta[name] = aim;
        console.log(name, JSON.stringify(aim));
      });
      await P.ctx.close().catch(() => {});
    }
  }
} finally {
  writeFileSync(join(OUT, `${TAG}-meta.json`), JSON.stringify(meta, null, 1));
  await browser.close();
}
process.exit(run.finish());
