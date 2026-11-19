/**
 * e2e/sky-moon-phase.mjs — the moon's phase in the village sky against an independent ephemeris (astronomy-engine, run outside the repo):
 * for each pinned KST time the game's lit fraction, waxing/waning and bright-limb angle (from the zenith, clockwise: + = lit side to the
 * viewer's right) are printed next to the reference values and a close crop of the moon is saved.
 *
 *   CV_CLIENT_URL=http://localhost:5963 node e2e/sky-moon-phase.mjs --out=<dir> --pins=2026-02-24T18:58:0.4893:139,...   (time:illum:chi)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("sky-moon-phase");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const PINS = opt("pins", "").split(",").filter(Boolean).map((s) => {
  const m = s.match(/^(\d{4}-\d\d-\d\dT\d\d:\d\d):([\d.]+):(-?[\d.]+)$/);
  return { kst: m[1], illum: +m[2], chi: +m[3] };
});
run.allow("D3D X3595", /X3595/);
const browser = await launchBrowser();
const rows = [];
try {
  const P = await openPlayer(browser, run, { tag: "moon", device: DESKTOP, settings: { graphics: "high" } });
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(PINS[0].kst)}`, { waitUntil: "domcontentloaded" });
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill(`달${Math.floor(Math.random() * 900 + 100)}`);
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvSky && !!window.__cvThree, null, { timeout: 90000 });
  await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await P.page.waitForFunction(() => window.__cvSky?.().loaded, null, { timeout: 30000 });
  for (const pin of PINS) {
    await run.step(pin.kst, async () => {
      const utc = Date.parse(pin.kst + ":00+09:00");
      const g = await P.page.evaluate(async (utc) => {
        const c = await window.__imp("/src/village/villageClock.ts");
        c.villageClock.pin(utc);
        await new Promise((r) => setTimeout(r, 1800));
        const m = await window.__imp("/src/village/sky/StarSkyExtras.tsx");
        const mo = m.currentMoon(window.__cvSky().utcMs);
        const d = m.moonDirection(mo, [0, 0, 0]);
        const alt = (Math.asin(d[1]) * 180) / Math.PI;
        const az = ((Math.atan2(d[0], -d[2]) * 180) / Math.PI + 360) % 360;
        let mesh;
        window.__cvThree().scene.traverse((o) => { if (o.name === "village_moon") mesh = o; });
        const u = mesh.material.uniforms;
        const chi = (Math.atan2(u.uSun.value.x, u.uSun.value.y) * 180) / Math.PI;
        return { utcMs: window.__cvSky().utcMs, illum: mo.illuminated, waxing: mo.waxing, alt, az, chi, cosElong: u.uCosElong.value, visible: mesh.visible, w: u.uWeight.value };
      }, utc);
      // look straight at the moon, hide the HUD, crop
      await P.page.evaluate(async ([az, alt]) => {
        const v = await window.__imp("/src/game/viewState.ts");
        if (v.viewState.mode !== "fp") v.enterFp(0);
        v.viewState.fpYaw = (-az * Math.PI) / 180;
        v.viewState.fpPitch = (-alt * Math.PI) / 180;
        const canvas = document.querySelector("canvas");
        const keep = new Set();
        for (let e = canvas; e; e = e.parentElement) keep.add(e);
        for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
      }, [g.az, g.alt]);
      await sleep(1500);
      const vp = DESKTOP.viewport;
      await P.page.screenshot({ path: join(OUT, `moon-${pin.kst.replace(/[:]/g, "")}.png`), clip: { x: vp.width / 2 - 100, y: vp.height / 2 - 100, width: 200, height: 200 } });
      const row = { kst: pin.kst, refIllum: pin.illum, gameIllum: +g.illum.toFixed(4), refChi: pin.chi, gameChi: +g.chi.toFixed(1), waxing: g.waxing, alt: +g.alt.toFixed(1), az: +g.az.toFixed(1), visible: g.visible };
      rows.push(row);
      console.log(JSON.stringify(row));
      run.check(`${pin.kst} illuminated fraction within 0.01`, Math.abs(row.gameIllum - pin.illum) < 0.01, row);
      const dChi = Math.abs(((row.gameChi - pin.chi + 540) % 360) - 180);
      run.check(`${pin.kst} bright-limb angle within 5 deg`, pin.illum > 0.97 || dChi < 5, row);
    });
  }
} finally {
  writeFileSync(join(OUT, "moon-phase-rows.json"), JSON.stringify(rows, null, 1));
  await browser.close();
}
process.exit(run.finish());
