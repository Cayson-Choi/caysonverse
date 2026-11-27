/**
 * e2e/rides-outside-shots.mjs — every Caysonland ride from outside (the photo camera), and from straight above with the colliders drawn
 * (?debug=colliders), to see that each railing, fence, flight of steps and name board has its box and each pad is open. Evidence only.
 *   CV_CLIENT_URL=http://localhost:5661 CV_E2E_SLOW=6 node e2e/rides-outside-shots.mjs --out=<folder> [--no-colliders]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const colliders = !process.argv.includes("--no-colliders");
const run = createRun("rides-outside");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = "2026-11-03T12:30";

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
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const photo = async (p, name, cam, wait = 1300) => {
  await p.page.evaluate((c) => {
    window.__cvShot = c;
  }, cam);
  await sleep(wait);
  await run.shot(p, name);
};

const b = await launchBrowser();
const P = await openPlayer(b, run, { tag: "pc", device: DESKTOP });
await run.step("shots", async () => {
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}${colliders ? "&debug=colliders" : ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill(`Os${Math.floor(Math.random() * 9000 + 1000)}`);
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await P.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 5 && (await areaOf(P)) !== "park"; attempt++) {
    await goTo(P, g.x, g.z - 0.5, 1.0);
    await sleep(800);
    await act(P);
    await until(async () => (await areaOf(P)) === "park", 8000);
  }
  await P.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 60000 * SLOW }).catch(() => undefined);
  await sleep(3000);
  run.check("in the park", (await areaOf(P)) === "park");
  // [name, where the visitor stands (the park draws round the player), the shots]
  const D = { x: -75, z: -88 };
  const M = { x: -95, z: -140 };
  const C = { x: 110, z: -135 };
  const W = { x: 205, z: -140 };
  await goTo(P, D.x + 22, D.z + 6, 3);
  await photo(P, "drop-whole-tower.png", { x: D.x + 120, y: 12, z: D.z + 20, tx: D.x, ty: 48, tz: D.z, fov: 62 });
  await photo(P, "drop-platform.png", { x: D.x + 19, y: 5.5, z: D.z + 9, tx: D.x + 4, ty: 2.2, tz: D.z, fov: 62 });
  await photo(P, "drop-crown.png", { x: D.x - 30, y: 70, z: D.z - 20, tx: D.x, ty: 92, tz: D.z, fov: 50 });
  await photo(P, "drop-top-down.png", { x: D.x + 4, y: 34, z: D.z + 0.01, tx: D.x + 4, ty: 0, tz: D.z, fov: 50 });
  await goTo(P, M.x + 20, M.z + 8, 3);
  await photo(P, "moon-whole.png", { x: M.x + 34, y: 9, z: M.z + 16, tx: M.x, ty: 6, tz: M.z, fov: 60 });
  await photo(P, "moon-platform.png", { x: M.x + 19, y: 5.5, z: M.z + 8, tx: M.x + 6, ty: 2.2, tz: M.z, fov: 62 });
  await photo(P, "moon-top-down.png", { x: M.x + 6, y: 36, z: M.z + 0.01, tx: M.x + 6, ty: 0, tz: M.z, fov: 50 });
  await goTo(P, C.x + 4, C.z + 19, 3);
  await photo(P, "carousel-gate.png", { x: C.x + 6, y: 4, z: C.z + 22, tx: C.x, ty: 1.5, tz: C.z + 12, fov: 62 });
  await photo(P, "carousel-top-down.png", { x: C.x, y: 46, z: C.z + 0.01, tx: C.x, ty: 0, tz: C.z, fov: 50 });
  await goTo(P, W.x + 6, W.z + 15, 3);
  await photo(P, "wheel-platform.png", { x: W.x + 12, y: 5, z: W.z + 18, tx: W.x + 2, ty: 1.6, tz: W.z + 8, fov: 62 });
  await photo(P, "wheel-top-down.png", { x: W.x, y: 40, z: W.z + 4.01, tx: W.x, ty: 0, tz: W.z + 4, fov: 50 });
  await goTo(P, 8, -16, 3);
  await photo(P, "coaster-station.png", { x: 14, y: 5, z: -20, tx: 2, ty: 1.6, tz: -6, fov: 62 });
  await photo(P, "coaster-top-down.png", { x: 2, y: 34, z: -8.01, tx: 2, ty: 0, tz: -8, fov: 50 });
  await P.page.evaluate(() => {
    window.__cvShot = null;
  });
});
await b.close();
process.exit(run.finish());
