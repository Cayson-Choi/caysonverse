/**
 * e2e/park-banner-shots.mjs — 케이슨랜드 산책로 가로등 깃발이 쫙 펴져 있는지 (주인님 11-27: "케이슨랜드 깃발을 쫙 펴"). 깃발 둘을 정면·옆에서 찍어요.
 *   CV_CLIENT_URL=http://localhost:<port> node e2e/park-banner-shots.mjs [--out=dir]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos, turnCameraTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const OUT = (process.argv.find((a) => a.startsWith("--out=")) || "--out=D:/ClaudeCode/tmpshots/banner").slice(6);
mkdirSync(OUT, { recursive: true });
const run = createRun("park-banner-shots");
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
}
const idle = (p, ms = 120000) => until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, ms);
/** The planned walk (the game's own way round the colliders) to a free spot; the final position. */
async function goTo(p, x, z, tol = 0.6) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 8, slack: 60, margin: 60 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(150);
    await idle(p);
    await sleep(100);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function enter(p, nick) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`${nick}${Math.floor(Math.random() * 900 + 100)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(12000);
  await until(async () => await p.page.evaluate(() => !!window.__cvLots?.()?.ready), 120000 * SLOW);
  await sleep(3000);
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const inPark = await until(async () => (await areaOf(p)) === "park", 30000 * SLOW);
  await sleep(12000);
  return inPark;
}

const b = await launchBrowser();
try {
  const A = await openPlayer(b, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
  console.log("in park", await enter(A, "Bn"));
  const posts = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).PARK_LAMPS.filter((l) => l.x > 30 && l.x < 50 && l.z < -138));
  console.log("posts", posts.length);
  let n = 0;
  for (const post of posts.slice(0, 2)) {
    const bx = post.x + (post.x < 40 ? 0.9 : -0.9);
    for (const [dx, dz, tag] of [[0, 5, "front"], [4, 3, "side"]]) {
      await goTo(A, bx + dx, post.z + dz, 1.2);
      await turnCameraTo(A, bx, post.z);
      await A.page.evaluate(() => { const o = window.__cv.getOrbit(); o.pitch = -0.25; o.distance = 3.5; }).catch(() => {});
      await sleep(1500);
      await A.page.screenshot({ path: `${OUT}/banner-${n}-${tag}.png` });
    }
    n++;
  }
} finally {
  await b.close();
}
