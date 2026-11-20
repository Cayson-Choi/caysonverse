/**
 * e2e/stairs-flicker.mjs - ride staircases: a short camera pan (N small steps) per view, every frame saved, then the frame-to-frame
 * high-frequency change on the step region is measured by tools/analyze-flicker.py (z-fighting / shimmer crawls, a clean surface only drifts).
 *
 *   CV_CLIENT_URL=http://localhost:5641 node e2e/stairs-flicker.mjs <outDir> <tag> [desktop|phone]
 */
import { mkdirSync } from "node:fs";

import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const [OUT, TAG, DEV = "desktop"] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const run = createRun("stairs-flicker");
run.evidence = OUT;
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("shot");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
await sleep(3000);
const hideHud = () => P.page.evaluate(() => {
  const canvas = document.querySelector("canvas");
  const keep = new Set();
  for (let e = canvas; e; e = e.parentElement) keep.add(e);
  for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = "hidden";
});
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
const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
for (let a = 0; a < 4; a++) {
  await goTo(g.x, g.z - 0.5);
  const at = await P.page.evaluate(() => window.__cv.getPos());
  if (Math.hypot(at.x - g.x, at.z - (g.z - 0.5)) < 1.2) break;
}
for (let i = 0; i < 3 && (await areaOf()) !== "park"; i++) {
  await act(P);
  await sleep(5000);
}
await sleep(6000);
await hideHud();
const VIEWS = {
  coaster: { cam: [2, 1.7, -16], look: [2, 1.2, -9.5], fov: 55 },
  coasterSide: { cam: [-2.5, 1.2, -13], look: [1.5, 0.8, -9.5], fov: 55 },
  drop: { cam: [-54, 1.7, -88], look: [-63.5, 0.8, -88], fov: 55 },
  moon: { cam: [-75, 1.7, -140], look: [-84, 0.8, -140], fov: 55 },
  wheel: { cam: [205, 1.7, -121], look: [205, 1.0, -131], fov: 55 },
  carousel: { cam: [110, 1.7, -112], look: [110, 0.8, -121], fov: 55 },
};
for (const [name, v] of Object.entries(VIEWS)) {
  for (let i = 0; i < 12; i++) {
    const dx = i * 0.012; // a 1.2 cm sideways pan per frame, the view stays on the steps
    await P.page.evaluate(([c, l, fov]) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov }), [[v.cam[0] + dx, v.cam[1], v.cam[2]], [v.look[0] + dx, v.look[1], v.look[2]], v.fov]);
    await sleep(i === 0 ? 2500 : 450);
    await run.shot(P, `${TAG}-${DEV}-${name}-${String(i).padStart(2, "0")}.png`);
  }
}
const code = run.finish();
await browser.close();
process.exit(code);
