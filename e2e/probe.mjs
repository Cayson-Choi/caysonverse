/**
 * e2e/probe.mjs - a small harness for look / geometry probes: joins the village (optionally walks through the gate into the park) and
 * hands the tab to a probe module, which takes photos (window.__cvShot) or reads the scene.
 *
 *   CV_CLIENT_URL=http://localhost:5641 node e2e/probe.mjs <probe.mjs> <outDir> [desktop|phone] [time] [-- probe args]
 *
 * The probe module's default export: async ({ P, run, OUT, DEV, args, enterPark, leavePark, goTo, areaOf, hideHud, cam, shot, stats, sleep }) => void.
 * Env: CV_QS (extra query string, "&x=1"), CV_GFX (graphics setting), CV_VIEW ("1500x900" window).
 */
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const argv = process.argv.slice(2);
const cut = argv.indexOf("--");
const [probeFile, OUT, DEV = "desktop", TIME = "2026-11-16T12:30"] = cut < 0 ? argv : argv.slice(0, cut);
const args = cut < 0 ? [] : argv.slice(cut + 1);
mkdirSync(OUT, { recursive: true });
const run = createRun("probe");
run.evidence = OUT;
const browser = await launchBrowser();
let device = DEV === "phone" ? PHONE : DESKTOP;
if (process.env.CV_VIEW) {
  const [w, h] = process.env.CV_VIEW.split("x").map(Number);
  device = { ...device, viewport: { width: w, height: h } };
}
const P = await openPlayer(browser, run, { tag: DEV, device, settings: { graphics: process.env.CV_GFX || (DEV === "phone" ? "low" : "high") } });
await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}${process.env.CV_QS || ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("probe");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
await sleep(3000);
const hideHud = (on = true) =>
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
  return P.page.evaluate(() => window.__cv.getPos());
}
async function enterPark() {
  if ((await areaOf()) === "park") return;
  await P.page.evaluate(() => (window.__cvShot = null));
  await hideHud(false);
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
async function leavePark() {
  if ((await areaOf()) !== "park") return;
  await P.page.evaluate(() => (window.__cvShot = null));
  await hideHud(false);
  const e = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).PARK_EXIT_PAD);
  await goTo(e.x, e.z + 0.5);
  for (let i = 0; i < 3 && (await areaOf()) === "park"; i++) {
    await act(P);
    await sleep(5000);
  }
  await sleep(5000);
}
/** The fixed photo camera: cam(null) hands the view back to the rig. */
const cam = (c, l, fov = 50) => P.page.evaluate(([c, l, fov]) => (window.__cvShot = c ? { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov } : null), [c, l, fov]);
const shot = (name) => run.shot(P, `${name}.png`);
/** Draw calls and triangles of a frame (every pass), averaged over 10 frames, and the renderer's memory counters. */
const stats = () =>
  P.page.evaluate(async () => {
    const gl = window.__cvThree().gl;
    const raf = () => new Promise((r) => requestAnimationFrame(r));
    await raf();
    gl.info.autoReset = false;
    gl.info.reset();
    for (let i = 0; i < 10; i++) await raf();
    const out = { calls: Math.round(gl.info.render.calls / 10), triangles: Math.round(gl.info.render.triangles / 10), geometries: gl.info.memory.geometries, textures: gl.info.memory.textures };
    gl.info.autoReset = true;
    return out;
  });
const probe = (await import(pathToFileURL(resolve(probeFile)).href)).default;
try {
  await probe({ P, run, OUT, DEV, args, enterPark, leavePark, goTo, areaOf, hideHud, cam, shot, stats, sleep, act, walkAndWait });
} catch (e) {
  run.check("probe ran to the end", false, String(e?.stack ?? e).slice(0, 900));
}
const code = run.finish();
await browser.close();
process.exit(code);
