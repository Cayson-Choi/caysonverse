/**
 * e2e/veg-shots.mjs — photographs for the "plants off the paving, props solid" work (owner 2026-11-21): a list of views, each a fixed
 * photo camera (window.__cvShot), optionally with the avatar walked to a spot first (so the picture shows where a walker ends up).
 *
 *   CV_CLIENT_URL=http://localhost:5581 node e2e/veg-shots.mjs <views.json> <prefix> [--park] [--phone] [--out=<folder>]
 *
 * views.json: [{ name, cam: [x, y, z, tx, ty, tz, fov?], walk?: [x, z], area?: "park" | "village" }]
 */
import { mkdirSync, readFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const views = JSON.parse(readFileSync(args[0], "utf8"));
const prefix = args[1] ?? "shot";
const park = process.argv.includes("--park");
const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`veg-shots-${prefix}`);
run.evidence = outArg ? outArg.slice("--out=".length) : "D:/ClaudeCode/tmpshots/vegpath";
mkdirSync(run.evidence, { recursive: true });

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
async function goTo(p, x, z, tol = 1.2) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(400);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 90000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "high" } });
await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(A);
await A.page.locator("input.cv-input").first().fill(`Sh${Math.floor(Math.random() * 900 + 100)}`);
await press(A, A.page.locator(".cv-submit"));
await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
await A.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
await sleep(15000);
await until(async () => await A.page.evaluate(() => !!window.__cvLots?.()?.ready), 120000 * SLOW);
await until(async () => await A.page.evaluate(() => !!window.__cvVegDrawn?.()), 120000 * SLOW);
await sleep(6000);
if (park) {
  const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(A, g.x, g.z - 0.5, 1.0);
  await act(A);
  await until(async () => (await areaOf(A)) === "park", 30000 * SLOW);
  await sleep(20000);
}
// the HUD out of the pictures
await A.page.addStyleTag({ content: ".cv-hud, .cv-chat, .cv-minimap, .cv-topbar, .cv-joystick, .cv-action-btn, .cv-coach { opacity: 0 !important; }" }).catch(() => {});
for (const v of views) {
  if (v.walk) {
    const at = await goTo(A, v.walk[0], v.walk[1], v.tol ?? 1.2);
    console.log(`${v.name}: walked to (${at.x.toFixed(2)}, ${at.z.toFixed(2)}) for (${v.walk[0]}, ${v.walk[1]})`);
  }
  const [x, y, z, tx, ty, tz, fov] = v.cam;
  await A.page.evaluate((c) => { window.__cvShot = c; }, { x, y, z, tx, ty, tz, fov: fov ?? 55 });
  await sleep(v.wait ?? 2500);
  await run.shot(A, `${prefix}-${phone ? "phone" : "pc"}-${v.name}.png`);
  console.log(`shot ${prefix}-${phone ? "phone" : "pc"}-${v.name}.png`);
}
await A.page.evaluate(() => { window.__cvShot = null; });
await b.close();
process.exit(0);
