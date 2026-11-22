/**
 * e2e/park-altitude-photo.mjs (a quick look at the altitude look from fixed photo cameras, no ride) — owner 2026-11-20: "급행을 타고 천천히 위로 올라가는데 하늘이 전혀 변화가 없이 그대로야".
 *
 * Boards the coaster and photographs the 66 m chain lift at its bottom, middle and top, each looking forward and looking down-left, so the
 * sense of height can be compared before and after the altitude look (land/parkAltitude.ts). Also logs the eye height and the altitude factor.
 *
 *   CV_CLIENT_URL=http://localhost:5945 node e2e/coaster-lift-height-shots.mjs [--phone] --out=<folder> [--tag=before|after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tag = arg("tag", "shot");
const run = createRun(`coaster-lift-height-${phone ? "phone" : "pc"}`);
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const NOON = "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
  p.nick = nick;
}

/** Walk to (x, z) the way the game would: its own detour search round the colliders (e2e/seat-front.mjs goTo). */
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

/** Walk to the gate lot's door in the village and use it: the curtain, then the park (area "park"). */
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  // the gate is on the south bank: a route through the village (plaza, the footbridge) to its pad
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const ok = await until(async () => (await areaOf(p)) === "park", 15000);
  await sleep(4000);
  return ok;
}

/** Poll `fn` (node side) until it is truthy (waitForFunction does not await an async page function). */
async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}


const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
await run.step("photos", async () => {
  await joinLand(A, "Ph");
  run.check("A in the park", await enterPark(A));
  await A.page.waitForSelector("[data-testid=park-loading]", { state: "detached", timeout: 90000 }).catch(() => {});
  await sleep(2500);
  const views = [
    ["ground-fwd", 1.7, [0, 4, -250], 62],
    ["h35-fwd", 35, [0, 20, -250], 62],
    ["h68-fwd", 68, [0, 40, -250], 62],
    ["h68-up", 68, [200, 160, -120], 62],
    ["h68-downleft", 68, [-20, 0, -20], 62],
    ["h68-far-south", 68, [40, 5, 400], 62],
  ];
  for (const [name, y, [tx, ty, tz], fov] of views) {
    await A.page.evaluate(([y, tx, ty, tz, fov]) => { window.__cvShot = { x: 40, y, z: -60, tx, ty, tz, fov }; }, [y, tx, ty, tz, fov]);
    await sleep(900);
    await run.shot(A, `${tag}-${name}.png`);
  }
});
const code = run.finish({});
await b.close();
process.exit(code);
