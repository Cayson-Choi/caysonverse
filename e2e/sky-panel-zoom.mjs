/**
 * e2e/sky-panel-zoom.mjs — the star finder's card (fold to a pill, remembered; the "찾은 별자리 선 항상 켜두기" box), the sky zoom
 * (wheel / buttons / tapping a name) and the fade while dragging, at night, on PC and phone.
 *
 *   node e2e/sky-panel-zoom.mjs [--device=desktop|phone] [--out=<dir>]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("sky-panel-zoom");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const DEVICE = opt("device", "desktop");
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595", /X3595/);
const phone = DEVICE === "phone";
const shot = (p, n) => p.page.screenshot({ path: join(OUT, `${DEVICE}-${n}.png`) });
const fin = (p) => p.page.evaluate(() => window.__cvSky().finder);
const lsGet = (p, k) => p.page.evaluate((key) => localStorage.getItem(key), k);
const ZOOM_IN = '.cv-sky-zoom button[aria-label="하늘 확대"]';

const browser = await launchBrowser();
try {
  const P = await openPlayer(browser, run, { tag: DEVICE, device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
  await run.step(`${DEVICE}: join at night`, async () => {
    await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-16T22:00")}`, { waitUntil: "domcontentloaded" });
    await entryReady(P);
    await P.page.locator("input.cv-input").first().fill(`별${Math.floor(Math.random() * 900 + 100)}`);
    await press(P, P.page.locator(".cv-submit"));
    await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
    await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvSky, null, { timeout: 90000 });
    await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
    await P.page.waitForFunction(() => window.__cvSky?.().loaded && window.__cvSky().visible, null, { timeout: 40000 });
    await sleep(1500);
    await P.page.evaluate(() => localStorage.clear());
  });

  await run.step(`${DEVICE}: open, fold to the pill, unfold, remembered`, async () => {
    await press(P, P.page.locator('button[aria-label="별자리 찾기"]').first());
    await P.page.waitForFunction(() => window.__cvSky().finder.phase === "night" && window.__cvSky().finder.firstPerson, null, { timeout: 20000 });
    await sleep(800);
    const pillFirst = (await P.page.locator(".cv-sky-card.is-pill").count()) === 1;
    run.check(phone ? "a phone starts folded (pill)" : "a PC starts unfolded", phone ? pillFirst : !pillFirst);
    if (!phone) {
      await shot(P, "1-expanded");
      const box = await P.page.locator(".cv-sky-card").boundingBox();
      run.check("card is narrow and at the left", box.width <= 270 && box.x >= 64 && box.x < 120, JSON.stringify(box));
      await press(P, P.page.locator('.cv-sky-card button[aria-label="카드 접기"]'));
      await sleep(300);
    }
    run.check("pill shows", (await P.page.locator(".cv-sky-card.is-pill").count()) === 1);
    const pillText = (await P.page.locator(".cv-sky-pill-btn").innerText()).replace(/\s+/g, " ");
    run.check("pill text", /🔭 별자리 \d\/\d ▸/.test(pillText), pillText);
    await shot(P, "2-pill");
    if (!phone) run.check("fold remembered (1)", (await lsGet(P, "cv-stars-panel-v1")) === "1");
    await press(P, P.page.locator(".cv-sky-pill-btn"));
    await sleep(400);
    run.check("card shows after the pill tap", (await P.page.locator(".cv-sky-card:not(.is-pill)").count()) === 1);
    run.check("unfold remembered (0)", (await lsGet(P, "cv-stars-panel-v1")) === "0");
    await shot(P, "3-list");
  });

  await run.step(`${DEVICE}: always-on lines box`, async () => {
    const label = await P.page.locator(".cv-sky-toggle-label").innerText();
    run.check("clear label", label === "찾은 별자리 선 항상 켜두기", label);
    for (const k of [0, 1]) {
      await press(P, P.page.locator(".cv-sky-row").nth(k));
      await sleep(900);
      await press(P, P.page.locator('.cv-sky-card button:has-text("다른 별자리")'));
      await sleep(500);
    }
    const f1 = await fin(P);
    run.check("two found", f1.found.length >= 2, f1.found.join());
    run.check("OFF: no found lines with nothing picked", f1.lines.length === 0, JSON.stringify(f1.lines));
    await press(P, P.page.locator(".cv-sky-row").nth(2));
    await sleep(1200);
    let f2 = await fin(P);
    run.check("OFF: only the picked figure is drawn", f2.lines.length === 1 && f2.lines[0].id === f2.targetId, JSON.stringify(f2.lines));
    await press(P, P.page.locator(".cv-sky-toggle input"));
    await sleep(700);
    f2 = await fin(P);
    run.check("ON: found figures drawn too", f2.lines.length >= 3, JSON.stringify(f2.lines));
    const stored = JSON.parse((await lsGet(P, "cv-stars-v1")) ?? "{}");
    run.check("ON persisted", stored.showFound === true);
    await shot(P, "4-lines-on");
    await press(P, P.page.locator('button[aria-label="별자리 찾기 닫기"]').first());
    await sleep(800);
    const f3 = await fin(P);
    run.check("ON: lines stay with the card closed", f3.lines.length >= 3, JSON.stringify(f3.lines));
    await press(P, P.page.locator('button[aria-label="별자리 찾기"]').first());
    await sleep(800);
    if ((await P.page.locator(".cv-sky-card.is-pill").count()) === 1) await press(P, P.page.locator(".cv-sky-pill-btn"));
    await sleep(400);
    await press(P, P.page.locator(".cv-sky-toggle input"));
    await sleep(700);
    const f4 = await fin(P);
    run.check("OFF again: found lines gone", f4.lines.length <= 1, JSON.stringify(f4.lines));
    run.check("OFF persisted", JSON.parse((await lsGet(P, "cv-stars-v1")) ?? "{}").showFound === false);
  });

  await run.step(`${DEVICE}: zoom (buttons, wheel, tap a name)`, async () => {
    await press(P, P.page.locator(".cv-sky-zoom-read"));
    await sleep(1500);
    const f0 = await fin(P);
    run.check("normal lens before zooming", f0.fov > 50, String(f0.fov));
    await press(P, P.page.locator(ZOOM_IN));
    await press(P, P.page.locator(ZOOM_IN));
    await sleep(1200);
    const f1 = await fin(P);
    run.check("+ narrows the lens", f1.fov < f0.fov - 8, `${f0.fov} -> ${f1.fov}`);
    const read = await P.page.locator(".cv-sky-zoom-read").innerText();
    run.check("readout > x1", /×[1-9]\.\d/.test(read) && read !== "×1.0", read);
    for (let i = 0; i < 12; i++) await press(P, P.page.locator(ZOOM_IN));
    await sleep(1500);
    const f2 = await fin(P);
    run.check("clamped at 20 deg", f2.fov >= 19.5 && f2.fov <= 20.6, String(f2.fov));
    await shot(P, "5-zoom-max");
    await press(P, P.page.locator(".cv-sky-zoom-read"));
    await sleep(1500);
    run.check("readout resets the lens", Math.abs((await fin(P)).fov - f0.fov) < 1.2, String((await fin(P)).fov));
    if (!phone) {
      await P.page.mouse.move(640, 500);
      for (let i = 0; i < 6; i++) await P.page.mouse.wheel(0, -120);
      await sleep(1400);
      const w = await fin(P);
      run.check("wheel narrows the lens", w.fov < f0.fov - 6, String(w.fov));
      for (let i = 0; i < 30; i++) await P.page.mouse.wheel(0, -120);
      await sleep(1400);
      const w2 = await fin(P);
      run.check("wheel clamps at 20 deg", w2.fov >= 19.5, String(w2.fov));
      for (let i = 0; i < 40; i++) await P.page.mouse.wheel(0, 120);
      await sleep(1500);
      const w3 = await fin(P);
      run.check("wheel out clamps at the normal view and stays first person", w3.fov <= f0.fov + 0.6 && w3.firstPerson, String(w3.fov));
    }
    const view = () =>
      P.page.evaluate(async () => {
        const v = await window.__imp("/src/game/viewState.ts");
        return { yaw: v.viewState.fpYaw, pitch: v.viewState.fpPitch, zoom: v.viewState.skyZoomGoal };
      });
    const before = await view();
    await press(P, P.page.locator(".cv-sky-row").nth(3));
    await sleep(3500);
    const after = await view();
    const moved = Math.abs(after.yaw - before.yaw) > 0.02 || Math.abs(after.pitch - before.pitch) > 0.02;
    run.check("tapping a name pans the view", moved, JSON.stringify({ before, after }));
    // a wide figure on a tall phone cannot be framed any tighter (its width decides): then the lens just stays as it is
    run.check("tapping a name sets the lens to frame it", phone ? after.zoom <= 1 : after.zoom < 0.99, String(after.zoom));
    await shot(P, "6-pick-zoom");
  });

  await run.step(`${DEVICE}: the card fades while dragging the sky`, async () => {
    const vp = P.page.viewportSize();
    const x = Math.round(vp.width * (phone ? 0.5 : 0.6));
    const y = Math.round(vp.height * 0.7);
    if (phone) {
      const cdp = await P.page.context().newCDPSession(P.page);
      await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      for (let i = 1; i <= 6; i++) await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x + i * 8, y }] });
      await sleep(150);
      run.check("card is faded during the drag", (await P.page.locator(".cv-sky-card.is-looking").count()) === 1);
      await shot(P, "7-drag-fade");
      await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await P.page.mouse.move(x, y);
      await P.page.mouse.down();
      for (let i = 1; i <= 6; i++) await P.page.mouse.move(x + i * 10, y);
      await sleep(150);
      run.check("card is faded during the drag", (await P.page.locator(".cv-sky-card.is-looking").count()) === 1);
      await shot(P, "7-drag-fade");
      await P.page.mouse.up();
    }
    await sleep(1200);
    run.check("card is back after the drag", (await P.page.locator(".cv-sky-card.is-looking").count()) === 0);
  });
} finally {
  await browser.close();
  await run.finish?.();
}
