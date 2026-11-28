/**
 * e2e/walk-lamp-shots.mjs — before/after shots of what stood on a new front walk or at its mouth (owner 2026-11-28: every path
 * straight on its door; the house 5 sidewalk lamp stood at the mouth of its new walk). Per spot: the player's view (the avatar
 * walked onto the walk, the camera turned behind it toward the door) and a top-down view over the walk's mouth.
 *   CV_CLIENT_URL=http://localhost:5635 node e2e/walk-lamp-shots.mjs --tag=before [--out=<folder>] [--only=house_5,house_8]
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tag = arg("tag", "x");
const only = (arg("only", "") ?? "").split(",").filter(Boolean);
const run = createRun("walk-lamp-shots");
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

/** stand: where the avatar waits on the walk (or the sidewalk in front of it); door: what it faces; top: the top-down centre. */
const VILLAGE_SPOTS = [
  { id: "house_5", stand: [-35.2, -8], door: [-41.6, -8], top: [-38.4, -7], topH: 16 },
  { id: "house_8", stand: [-34.2, 33.6], door: [-40.6, 33.6], top: [-38.5, 35.5], topH: 20 },
];
/** 케이슨랜드's shop walks (shared parkArea.ts PARK_SHOP_WALKS): from the promenade's middle, facing the door. */
const PARK_SPOTS = [
  { id: "bakery", stand: [38.5, -171.5], door: [21, -171.5], top: [29, -171.5], topH: 18 },
  { id: "toys", stand: [38.5, -153.25], door: [21, -153.25], top: [29, -153.25], topH: 18 },
  { id: "tea", stand: [38.5, -136], door: [21, -136], top: [29, -136], topH: 18 },
  { id: "souvenir", stand: [41.5, -171.5], door: [59, -171.5], top: [51, -171.5], topH: 18 },
  { id: "candy", stand: [41.5, -153.25], door: [59, -153.25], top: [51, -153.25], topH: 18 },
  { id: "photo", stand: [41.5, -136], door: [59, -136], top: [51, -136], topH: 18 },
];
const park = process.argv.includes("--park");
const SPOTS = park ? PARK_SPOTS : VILLAGE_SPOTS;
const idle = async (p, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) return;
    await sleep(150);
  }
};
/** The game's own planned walk (round the colliders) to (x, z). */
async function goTo(p, x, z, tol = 0.8) {
  for (let k = 0; k < 4; k++) {
    await p.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const P = window.__cv.getPos();
      const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 8, slack: 60, margin: 60 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(200);
    await idle(p);
    await sleep(200);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
await run.step("join", async () => { await joinVillage(A, "Wl", process.env.TIME ?? "2026-11-03T12:30"); });
await run.step("shots", async () => {
  await A.page.waitForFunction(() => { try { return !!window.__cvLots?.()?.ready; } catch { return false; } }, null, { timeout: 120000 }).catch(() => {});
  await A.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(6000);
  if (park) {
    const g = await A.page.evaluate(async () => (await window.__imp("/shared/src/village/parkArea.ts")).parkGateDoor().pad);
    await goTo(A, g.x, g.z - 0.5, 1.0);
    await act(A);
    await A.page.waitForFunction(() => !document.body.innerText.includes("케이슨랜드로 가는 중"), null, { timeout: 120000 }).catch(() => {});
    await sleep(15000);
    run.check("in the park", (await A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea())) === "park");
  }
  for (const s of SPOTS) {
    if (only.length && !only.includes(s.id)) continue;
    await goTo(A, s.stand[0], s.stand[1], 1.2);
    await turnCameraTo(A, s.door[0], s.door[1]);
    await sleep(2500);
    await run.shot(A, `${tag}-${s.id}-view.png`);
    const [mx, mz] = s.top;
    await A.page.evaluate(([x, y, z]) => { window.__cvShot = { x: x + 0.02, y, z, tx: x, ty: 0, tz: z, fov: 50 }; }, [mx, s.topH, mz]);
    await sleep(2500);
    await run.shot(A, `${tag}-${s.id}-top.png`);
    await A.page.evaluate(() => { window.__cvShot = null; });
    await sleep(800);
  }
});
const code = run.finish({});
await b.close();
process.exit(code);
