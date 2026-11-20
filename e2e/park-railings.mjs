/**
 * e2e/park-railings.mjs — Caysonland's ride railings and fences are SOLID (owner 2026-11-21: "달배 난간을 캐릭터가 그냥 막 통과해버려", "구름탑에 탑승하기
 * 앞에 난간도 캐릭터가 그냥 통과해버려"). A visitor walks straight at each railing from BOTH sides (the moon boat's queue fence and platform rail, the drop
 * tower's queue fence, the carousel's round fence, the wheel's steps): clicking the far side must stop at the railing (sampled every 120 ms: never across).
 *   CV_CLIENT_URL=http://localhost:5661 CV_E2E_SLOW=6 node e2e/park-railings.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`park-railings-${phone ? "phone" : "pc"}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
  p.nick = nick;
}
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
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 5 && (await areaOf(p)) !== "park"; attempt++) {
    await goTo(p, g.x, g.z - 0.5, 1.0);
    await sleep(800);
    if (await p.page.locator(".cv-action-btn").count()) await act(p);
    await until(async () => (await areaOf(p)) === "park", 8000);
  }
  await p.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 60000 * SLOW }).catch(() => undefined);
  await sleep(2500);
  return (await areaOf(p)) === "park";
}

const M = { x: -95, z: -140 };
const D = { x: -75, z: -88 };
const C = { x: 110, z: -135 };
const W = { x: 205, z: -140 };
const R = 0.3;
// [name, start, target, rule: every sample must satisfy it (the barrier not crossed)]
const CASES = [];
for (const sz of [-1, 1]) {
  CASES.push([`moon queue fence z${sz} in`, [M.x + 13, M.z + sz * 4.5], [M.x + 13, M.z], (x, z) => (z - M.z) * sz > 2.2]);
  CASES.push([`moon queue fence z${sz} out`, [M.x + 13, M.z], [M.x + 13, M.z + sz * 4.5], (x, z) => (z - M.z) * sz < 2.5]);
  CASES.push([`moon platform rail z${sz} in`, [M.x + 5.5, M.z + sz * 7], [M.x + 5.5, M.z], (x, z) => (z - M.z) * sz > 4.3]);
  CASES.push([`drop queue fence z${sz} in`, [D.x + 11, D.z + sz * 4.5], [D.x + 11, D.z], (x, z) => (z - D.z) * sz > 1.9]);
  CASES.push([`drop queue fence z${sz} out`, [D.x + 11, D.z], [D.x + 11, D.z + sz * 4.5], (x, z) => (z - D.z) * sz < 2.1]);
}
CASES.push(["moon steps from the pad", [M.x + 13, M.z], [M.x + 8.5, M.z], (x) => x > M.x + 11.4]);
CASES.push(["carousel fence from the east", [C.x + 20, C.z], [C.x, C.z], (x) => x > C.x + 13.3]);
CASES.push(["carousel fence from the north", [C.x, C.z - 20], [C.x, C.z], (x, z) => z < C.z - 13.3]);
CASES.push(["wheel steps from the pad", [W.x, W.z + 14], [W.x, W.z + 8], (x, z) => z > W.z + 11.3]);

const b = await launchBrowser();
const P = await openPlayer(b, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
await run.step("railings", async () => {
  await joinLand(P, "Ra");
  run.check("enters the park", await enterPark(P), { area: await areaOf(P) });
  await sleep(3000);
  for (const [name, start, target, ok] of CASES) {
    const at = await goTo(P, start[0], start[1], 1.5);
    const sampled = [];
    await P.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z, 0), target);
    const t0 = Date.now();
    let last = await pos(P);
    let still = 0;
    while (Date.now() - t0 < 25000 * SLOW && still < 8) {
      await sleep(120);
      const q = await pos(P);
      sampled.push([q.x, q.z]);
      still = Math.hypot(q.x - last.x, q.z - last.z) < 0.02 ? still + 1 : 0;
      last = q;
    }
    const bad = sampled.filter(([x, z]) => !ok(x, z));
    run.check(`${name}: stopped at the railing (never across)`, bad.length === 0 && Math.hypot(at.x - start[0], at.z - start[1]) < 2.5, { start: [at.x, at.z], end: [last.x, last.z], across: bad.slice(0, 3) });
  }
});
await b.close();
process.exit(run.finish({}));
