/**
 * e2e/gate-park-look.mjs - lookdev shots of the Caysonland gate lot (village) and the park (fix/gate-fountain-park): a fixed
 * photo camera (window.__cvShot) per view, the HUD hidden, the renderer's draw calls and triangles written next to each shot.
 *
 *   CV_CLIENT_URL=http://localhost:5949 node e2e/gate-park-look.mjs <views.json> <outDir> <tag> [desktop|phone] [time]
 *
 * views.json: [{ name, walk?: [x, z], cam: [x, y, z], look: [x, y, z], fov?, park?: true }]; village views first (the park is
 * entered once through the gate lot's door, as e2e/ground-look.mjs does).
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const [viewsFile, OUT, TAG, DEV = "desktop", TIME = "2026-11-16T12:30"] = process.argv.slice(2);
const views = JSON.parse(readFileSync(viewsFile, "utf8"));
mkdirSync(OUT, { recursive: true });
const run = createRun("gate-park-look");
run.evidence = OUT;
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}${process.env.CV_QS || ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("shot");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
await sleep(3000);
const hideHud = (on) =>
  P.page.evaluate((on) => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = on ? "hidden" : "";
  }, on);
const areaOf = () => P.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function goTo(x, z) {
  await P.page.evaluate(async ([x, z]) => {
    const plan = await window.__imp("/src/game/clickPlan.ts");
    const move = await window.__imp("/src/game/clickMove.ts");
    const am = await window.__imp("/src/game/activeMap.ts");
    const me = window.__cv.getPos();
    const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
    move.setClickTarget(x, z, 0, via ?? undefined);
  }, [x, z]);
  await sleep(400);
  for (let i = 0; i < 480; i++) {
    if ((await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) break;
    await sleep(250);
  }
}
async function enterPark() {
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 4; attempt++) {
    await goTo(g.x, g.z - 0.5);
    const at = await P.page.evaluate(() => window.__cv.getPos());
    if (Math.hypot(at.x - g.x, at.z - (g.z - 0.5)) < 1.2) break;
  }
  for (let i = 0; i < 3 && (await areaOf()) !== "park"; i++) {
    await act(P);
    await sleep(5000);
  }
  await sleep(6000);
}
const stats = {};
for (const v of views) {
  if (v.park && (await areaOf()) !== "park") {
    await P.page.evaluate(() => (window.__cvShot = null));
    await hideHud(false);
    await enterPark();
  }
  if (v.walk) {
    await P.page.evaluate(() => (window.__cvShot = null));
    await goTo(v.walk[0], v.walk[1]).catch(() => walkAndWait(P, v.walk[0], v.walk[1], 60000, 1.5));
  }
  await hideHud(true);
  await P.page.evaluate(([c, l, fov]) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov }), [v.cam, v.look, v.fov ?? 50]);
  await sleep(v.wait ?? 2500);
  // every render of a frame (shadow maps, the scene, the post chain), averaged over 10 frames
  const info = await P.page.evaluate(async () => {
    const gl = window.__cvThree().gl;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    await raf();
    gl.info.autoReset = false;
    gl.info.reset();
    for (let i = 0; i < 10; i++) await raf();
    const out = { calls: Math.round(gl.info.render.calls / 10), triangles: Math.round(gl.info.render.triangles / 10) };
    gl.info.autoReset = true;
    return out;
  });
  stats[v.name] = info;
  await run.shot(P, `${TAG}-${DEV}-${v.name}.png`);
  console.log(v.name, JSON.stringify(info));
}
writeFileSync(join(OUT, `${TAG}-${DEV}-stats.json`), JSON.stringify(stats, null, 2));
const code = run.finish();
await browser.close();
process.exit(code);
