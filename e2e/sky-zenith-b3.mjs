/**
 * e2e/sky-zenith-b3.mjs — star finder open: the view is free all the way up. Mid-August 21:00, Lyra stands ~83 deg high.
 *   node e2e/sky-zenith-b3.mjs [--out=<dir>] [--device=desktop|phone|both]
 * Pick 거문고자리 (the turn goes straight up, not round), then from the horizon drag straight up past 80 deg (mouse / touch):
 * the pitch passes 80 deg, ends within 1 deg of the zenith, the yaw stays put (no flip), and closing restores the normal limit.
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, touchDown, touchMoveTo, touchUp } from "./lib/common.mjs";

const run = createRun("sky-zenith-b3");
const args = process.argv.slice(2);
const opt = (n, f) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${f}`).slice(n.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
const DEVICES = opt("device", "both") === "both" ? ["desktop", "phone"] : [opt("device", "both")];
run.allow("D3D X3595", /X3595/);
const vs = (p) => p.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); return { yaw: v.viewState.fpYaw, pitch: v.viewState.fpPitch, mode: v.viewState.mode, sky: v.viewState.skyLook }; });
const browser = await launchBrowser();
try {
  for (const dev of DEVICES) {
    const phone = dev === "phone";
    const P = await openPlayer(browser, run, { tag: dev, device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
    await run.step(`zenith ${dev}`, async () => {
      await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-08-15T21:00")}`, { waitUntil: "domcontentloaded" });
      await entryReady(P);
      await P.page.locator("input.cv-input").first().fill(`천정${dev}`);
      await press(P, P.page.locator(".cv-submit"));
      await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
      await P.page.waitForFunction(() => window.__cvSky?.().loaded && window.__cvSky().visible, null, { timeout: 90000 });
      await sleep(2000);
      await press(P, P.page.getByRole("button", { name: "별자리 찾기", exact: true }));
      await sleep(1500);
      run.check("sky-look is on while the finder is open", (await vs(P)).sky === true);
      // look at the horizon in the opposite direction of nothing in particular, then pick Lyra
      await P.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpYaw = 0.4; v.viewState.fpPitch = 0; });
      await sleep(500);
      await press(P, P.page.locator(".cv-sky-row", { hasText: "거문고자리" }));
      await P.page.waitForFunction(async () => { const v = await window.__imp("/src/game/viewState.ts"); return v.viewState.fpPitch < -1.2; }, null, { timeout: 30000 }).catch(() => {});
      await sleep(1500);
      const after = await vs(P);
      run.check("the turn to a near-zenith figure goes up (pitch beyond 70 deg)", after.pitch < -1.22, after);
      await run.shot(P, `${dev}-1-picked-lyra.png`);
      // from the horizon, drag straight up past 80 deg
      await P.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpYaw = 1.0; v.viewState.fpPitch = 0; });
      await sleep(600);
      const vp = P.page.viewportSize();
      const x = Math.round(vp.width * (phone ? 0.82 : 0.7));
      let maxUp = 0;
      let yawDrift = 0;
      for (let rep = 0; rep < 6; rep++) {
        if (phone) {
          await touchDown(P, x, Math.round(vp.height * 0.56));
          for (let k = 1; k <= 12; k++) await touchMoveTo(P, x, Math.round(vp.height * 0.56) + k * 14);
          await touchUp(P);
        } else {
          await P.page.mouse.move(x, 300);
          await P.page.mouse.down();
          for (let k = 1; k <= 12; k++) await P.page.mouse.move(x, 300 + k * 22, { steps: 2 });
          await P.page.mouse.up();
        }
        await sleep(200);
        const s = await vs(P);
        maxUp = Math.max(maxUp, -s.pitch);
        yawDrift = Math.max(yawDrift, Math.abs(s.yaw - 1.0));
      }
      run.check("dragging straight up passes 80 deg and reaches the zenith (within 1 deg)", maxUp > (80 * Math.PI) / 180 && maxUp > Math.PI / 2 - 0.0175, { maxUpDeg: (maxUp * 180) / Math.PI });
      run.check("no flip at the top: the yaw did not move", yawDrift < 0.02, { yawDrift });
      await sleep(400);
      await run.shot(P, `${dev}-2-zenith.png`);
      // and straight down again to the horizon
      await P.page.evaluate(async () => { const v = await window.__imp("/src/game/viewState.ts"); v.viewState.fpPitch = -1.55; });
      await sleep(600);
      await press(P, P.page.locator('.cv-sky-card [aria-label="별자리 찾기 닫기"]'));
      await sleep(500);
      if (await P.page.locator('.cv-sky-card').count()) await press(P, P.page.locator('.cv-sky-card [aria-label="별자리 찾기 닫기"]'));
      await sleep(900);
      console.log("TOP", await P.page.evaluate(() => { const b = document.querySelector(".cv-sky-card [aria-label=\"별자리 찾기 닫기\"]"); if (!b) return "nobtn"; const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return [e && e.className, e === b, r.x, r.y]; }));
      const cardStill = await P.page.locator(".cv-sky-card").count();
      const closed = { ...(await vs(P)), cardStill };
      run.check("closing restores the normal limit and view mode", closed.sky === false && closed.pitch >= -1.5 - 1e-6, closed);
    });
    await P.ctx.close();
  }
} finally {
  await browser.close();
}
