/**
 * e2e/wheel-platform-shots.mjs — the 하늘 등불 바퀴's boarding platform from the owner's angles (approaching at eye level, a slightly higher view, from the side),
 * with the bottom gondola at rest at the platform. Day or night (--night), PC or phone (--phone), into --out=<folder>.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/wheel-platform-shots.mjs [--night] [--phone] --out=<folder>
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const out = process.argv.find((a) => a.startsWith("--out="))?.slice(6) ?? "e2e/_evidence/wheel-platform";
const run = createRun("wheel-platform");
run.evidence = out;
mkdirSync(out, { recursive: true });
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: phone ? PHONE : DESKTOP });
await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(night ? "2026-11-03T21:30" : "2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(A);
await A.page.locator("input.cv-input").first().fill("Wp" + Math.floor(Math.random() * 900));
await press(A, A.page.locator(".cv-submit"));
await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 });
await sleep(3000);
const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
const areaOf = () => A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
for (let attempt = 0; attempt < 5 && (await areaOf()) !== "park"; attempt++) {
  await A.page.evaluate(async ([x, z]) => {
    const plan = await window.__imp("/src/game/clickPlan.ts"); const move = await window.__imp("/src/game/clickMove.ts"); const am = await window.__imp("/src/game/activeMap.ts");
    const P = window.__cv.getPos();
    const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
    move.setClickTarget(x, z, 0, via ?? undefined);
  }, [g.x, g.z - 0.5]);
  await sleep(500);
  for (let i = 0; i < 600; i++) { if ((await A.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) break; await sleep(200); }
  await sleep(1000);
  if (await A.page.locator(".cv-action-btn").count()) await act(A);
  for (let i = 0; i < 40 && (await areaOf()) !== "park"; i++) await sleep(250);
}
const inPark = await A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
console.log("area after the gate:", inPark);
await A.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 240000 }).catch(() => console.log("the park veil never lifted"));
console.log("veil gone:", !(await A.page.evaluate(() => !!document.querySelector("[data-testid=park-loading]"))));
await sleep(6000);
// wait for the loading position: the wheel standing with a gondola at the bottom (boarding phase)
await A.page.waitForFunction(async () => {
  const w = await window.__imp("/land/wheel.ts");
  const c = await window.__imp("/src/village/villageClock.ts");
  return w.wheelAt(c.villageClock.liveMs()).status === "boarding" && w.wheelAt(c.villageClock.liveMs()).phase > 2500 && w.wheelAt(c.villageClock.liveMs()).phase < 6000;
}, null, { timeout: 60000, polling: 100 }).catch(() => {});
const views = [
  ["a-eye-level-approach", 205, 1.7, -123, 205, 2.4, -136.5, 62],
  ["b-higher", 209, 5.0, -125, 205, 1.5, -136.5, 62],
  ["c-side-east", 217, 1.7, -136.5, 205, 2.2, -136.5, 62],
  ["d-close-door", 203, 1.7, -130.5, 205, 2.0, -136.5, 70],
  ["e-from-west", 194, 1.7, -131.5, 205.5, 2.0, -136.8, 62],
];
for (const [name, x, y, z, tx, ty, tz, fov] of views) {
  await A.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
  await sleep(1200);
  await run.shot(A, `${name}.png`);
}
await A.page.evaluate(() => { window.__cvShot = null; });
await b.close();
process.exit(0);
