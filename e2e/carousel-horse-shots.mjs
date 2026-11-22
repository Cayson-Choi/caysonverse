/**
 * e2e/carousel-horse-shots.mjs - platform-level shots of the carousel horses at the LOWEST point of their bob (side and from behind), PC or phone (--phone).
 * Also checks in the live game that the hooves stay above the deck. CV_CLIENT_URL=http://localhost:3013 node e2e/carousel-horse-shots.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "carousel-horse-phone" : "carousel-horse-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const NOON = "2026-11-03T12:30";
let nickSeq = 0;
async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
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
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 90000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function enterPark(p) {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const ok = await until(async () => (await areaOf(p)) === "park", 15000);
  await sleep(4000);
  return ok;
}

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
await joinLand(A, "Ch");
run.check("enters the park", await enterPark(A), {});
await goTo(A, 110, -119, 1.5);
await run.step("wait for full speed", async () => {
  const ok = await until(
    () => A.page.evaluate(async () => {
      const c = await window.__imp("/land/carousel.ts");
      const clock = await window.__imp("/src/village/villageClock.ts");
      const n = c.carouselAt(clock.villageClock.liveMs());
      return n.status === "riding" && n.rideT > 22 && n.rideT < 70;
    }),
    400000 * SLOW,
  );
  run.check("the carousel is turning at speed", ok, {});
});
const SEAT = 1;
for (const view of ["side", "back"]) {
  // follow horse SEAT from platform level every frame; shoot when it is at the bottom of its bob
  await A.page.evaluate(async ([view, SEAT, PH]) => {
    const c = await window.__imp("/land/carousel.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const P = {};
    const tick = () => {
      if (window.__stopShot) return;
      const now = clock.villageClock.liveMs();
      c.carouselSeatPose(SEAT, now, P);
      const dist = view === "side" ? 2.5 : 4.6;
      const bx = view === "side" ? P.x + (P.x - c.CAROUSEL_CENTER.x) / 9.6 * dist * 1.0 : P.x - P.fx * dist;
      const bz = view === "side" ? P.z + (P.z - c.CAROUSEL_CENTER.z) / 9.6 * dist : P.z - P.fz * dist;
      window.__cvShot = { x: bx, y: c.CAROUSEL_DECK_Y + 0.55, z: bz, tx: P.x, ty: c.CAROUSEL_DECK_Y + 0.3, tz: P.z, fov: view === "side" ? (PH ? 92 : 62) : (PH ? 70 : 50) };
      requestAnimationFrame(tick);
    };
    window.__stopShot = false;
    tick();
  }, [view, SEAT, phone]);
  await until(
    () => A.page.evaluate(async (SEAT) => {
      const c = await window.__imp("/land/carousel.ts");
      const clock = await window.__imp("/src/village/villageClock.ts");
      const p = c.carouselSeatPose(SEAT, clock.villageClock.liveMs());
      return p.y - c.CAROUSEL_DECK_Y - c.CAROUSEL_SADDLE_Y < -c.HORSE_BOB.amp * 0.985;
    }, SEAT),
    20000,
  );
  const low = await A.page.evaluate(async (SEAT) => {
    const c = await window.__imp("/land/carousel.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const p = c.carouselSeatPose(SEAT, clock.villageClock.liveMs());
    return { hoofAboveDeck: p.y - 0.92 - c.CAROUSEL_DECK_Y };
  }, SEAT);
  await run.shot(A, `horse-${view}-lowest.png`);
  run.check(`${view}: hooves above the deck at the lowest bob`, low.hoofAboveDeck >= 0.05, low);
  await A.page.evaluate(() => { window.__stopShot = true; window.__cvShot = null; });
  await sleep(300);
}
const code = run.finish({});
await b.close();
process.exit(code);
