/**
 * Ad-hoc: node e2e/zz-shot.mjs <views.json> <outDir> <tag> [desktop|phone]   (env CV_QS = extra query, CV_OLD_FILE_ROUTES = json {urlSubstring: file})
 * views.json: [{name, at:[x,z], look:[x,y,z]} | {name, ov:[cx,cz,height]}], `"park": true` on a view: in Caysonland (entered once through the gate lot's door)
 */
import { readFileSync, mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const [viewsFile, OUT, TAG, DEV = "desktop"] = process.argv.slice(2);
const views = JSON.parse(readFileSync(viewsFile, "utf8"));
mkdirSync(OUT, { recursive: true });
const run = createRun("zz-shot");
run.evidence = OUT;
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
const routes = JSON.parse(process.env.CV_OLD_FILE_ROUTES || "{}");
for (const [sub, file] of Object.entries(routes)) await P.page.route(`**/*${sub}*`, (r) => r.fulfill({ status: 200, contentType: "application/json", body: readFileSync(file, "utf8") }));
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30${process.env.CV_QS || ""}`, { waitUntil: "domcontentloaded" });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("shot");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 90000 });
await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
await sleep(3000);
const hideHud = () =>
  P.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
  });
await hideHud();
const areaOf = () => P.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function enterPark() {
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 4; attempt++) {
    await P.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const me = window.__cv.getPos();
      const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [g.x, g.z - 0.5]);
    await sleep(500);
    for (let i = 0; i < 400; i++) {
      if ((await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) break;
      await sleep(250);
    }
    const at = await P.page.evaluate(() => window.__cv.getPos());
    if (Math.hypot(at.x - g.x, at.z - (g.z - 0.5)) < 1.2) break;
  }
  for (let i = 0; i < 3 && (await areaOf()) !== "park"; i++) {
    await P.page.evaluate(() => {
      for (const el of document.querySelectorAll("body *")) if (el.style.visibility === "hidden") el.style.visibility = "";
    });
    await act(P);
    await sleep(5000);
  }
  await sleep(4000);
  await hideHud();
}
for (const v of views) {
  if (v.park && (await areaOf()) !== "park") await enterPark();
  if (!v.park && (await areaOf()) === "park") throw new Error("view order: village views first");
  if (v.ov) {
    await P.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).enterOverview());
    await sleep(2000);
    await P.page.evaluate(async ([cx, cz, h]) => {
      const vs = await window.__imp("/src/game/viewState.ts");
      vs.viewState.ovCenterX = cx;
      vs.viewState.ovCenterZ = cz;
      vs.viewState.ovHeight = h;
    }, v.ov);
    await sleep(3000);
    await run.shot(P, `${TAG}-${DEV}-${v.name}.png`);
    await P.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).dropOverview());
    await sleep(800);
    continue;
  }
  const me = await walkAndWait(P, v.at[0], v.at[1], 90000, 0.9);
  await P.page.evaluate(async ([look, me]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    if (vs.viewState.mode !== "fp") vs.enterFp(0);
    const cam = window.__cvThree().camera.position;
    const dx = look[0] - me.x;
    const dz = look[2] - me.z;
    vs.viewState.fpYaw = -Math.atan2(dx, -dz);
    vs.viewState.fpPitch = -Math.atan2(look[1] - (cam.y || 1.5), Math.hypot(dx, dz));
  }, [v.look, me]);
  await P.page.waitForFunction(() => window.__cv.getView().blend >= 0.995, null, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  await P.page.evaluate(async ([look]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    const c = window.__cvThree().camera.position;
    vs.viewState.fpPitch = -Math.atan2(look[1] - c.y, Math.hypot(look[0] - c.x, look[2] - c.z));
  }, [v.look]);
  await sleep(1500);
  await run.shot(P, `${TAG}-${DEV}-${v.name}.png`);
}
void SLOW;
await browser.close();
process.exit(0);
