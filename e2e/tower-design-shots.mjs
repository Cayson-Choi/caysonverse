/**
 * e2e/tower-design-shots.mjs — the 구름 낙하탑 as a landmark: photos from the village's skyline view, from the plaza (afar), from mid distance, and up close
 * (PC, or a phone with --phone; --night for the night look). One player only (a single page: several full-size software-GL pages crash the tab).
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/tower-design-shots.mjs [--phone] [--night] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(`tower-shots-${phone ? "phone" : "pc"}${night ? "-night" : ""}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const TIME = night ? "2026-11-03T21:30" : "2026-11-03T12:30";
const SITE = { x: -75, z: -88 };
const skipTower = process.argv.includes("--moon-only");
const skipVillage = process.argv.includes("--no-village");

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
const shotFrom = async (p, name, x, y, z, tx, ty, tz, fov) => {
  await p.page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
  await sleep(1600);
  await run.shot(p, name);
};

const b = await launchBrowser();
const P = await openPlayer(b, run, { tag: phone ? "S-phone" : "S-pc", device: phone ? PHONE : DESKTOP });
P.page.on("pageerror", (e) => console.log("PAGEERROR", String(e.message).slice(0, 400)));
P.page.on("console", (m) => { if (m.type() === "error") console.log("CONSOLE", m.text().slice(0, 300)); });
await run.step("village skyline view", async () => {
  void 0;
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill(`Sh${Math.floor(Math.random() * 9000 + 1000)}`);
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 120000 * SLOW });
  await P.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await P.page.waitForFunction(() => !document.body.innerText.includes("마을로 가는 중"), null, { timeout: 120000 * SLOW }).catch(() => undefined);
  await sleep(5000);
  // the tower's place in the village's world (the skyline's park frame -> world)
  const at = await P.page.evaluate(async () => {
    const m = await window.__imp("/src/village/skyline/skylinePlacement.ts");
    const x = m.OX + -75 * 0.4;
    const z = m.OZ + -88 * 0.4;
    return { x, z };
  });
  console.log("tower in the village", JSON.stringify(at));
  if (!skipTower && !skipVillage) await shotFrom(P, "v1-skyline-from-the-gate.png", at.x, 6, 84, at.x, 22, at.z, phone ? 46 : 38);
  if (!skipTower && !skipVillage) await shotFrom(P, "v2-skyline-from-the-street.png", -30, 4.5, 90, at.x, 22, at.z, phone ? 46 : 36);
});
if (process.argv.includes("--village-only")) {
  await b.close();
  process.exit(run.finish());
}
await run.step("enter the park", async () => {
  run.check("enters the park", await enterPark(P), { area: await areaOf(P) });
  await goTo(P, 38, -108, 4);
});
await run.step("plaza and mid distance", async () => {
  if (skipTower) return;
  await shotFrom(P, "t1-from-the-plaza.png", 40, 2.4, -112, SITE.x, 28, SITE.z, phone ? 38 : 40);
  await shotFrom(P, "t2-far-field.png", SITE.x + 70, 3, SITE.z + 22, SITE.x, 28, SITE.z, phone ? 55 : 44);
  await shotFrom(P, "t3-mid-distance.png", SITE.x + 36, 5, SITE.z + 18, SITE.x, 30, SITE.z, phone ? 62 : 52);
  await shotFrom(P, "t4-mid-from-the-west.png", SITE.x - 34, 5, SITE.z - 16, SITE.x, 30, SITE.z, phone ? 62 : 52);
});
await run.step("close", async () => {
  if (skipTower) return;
  await shotFrom(P, "t5-up-close-base.png", SITE.x + 15, 2.2, SITE.z + 7, SITE.x, 9, SITE.z, phone ? 70 : 62);
  await shotFrom(P, "t6-frame-and-arches.png", SITE.x + 16, 6, SITE.z + 2, SITE.x, 24, SITE.z, phone ? 66 : 56);
  await shotFrom(P, "t7-crown.png", SITE.x - 20, 34, SITE.z - 14, SITE.x, 52, SITE.z, phone ? 56 : 50);
  await shotFrom(P, "t8-platform-lamps.png", SITE.x + 19, 3.6, SITE.z + 11, SITE.x + 2, 2.5, SITE.z, phone ? 70 : 60);
  await P.page.evaluate(() => { window.__cvShot = null; });
});
await run.step("moon boat seated view", async () => {
  // the camera sits at three seats' eyes (the boat at rest, bow toward +z): the bench rows ahead, the dividers and posts beside
  const eyes = await P.page.evaluate(async () => {
    const m = await window.__imp("/land/moonBoat.ts");
    return [0, 16, 28].map((seat) => {
      const l = m.moonSeatLocal(seat);
      const w = m.moonToWorld(l[0], l[1] + m.MOON_SEAT.eye, l[2], 0);
      return { x: w.x, y: w.y, z: w.z };
    });
  });
  await goTo(P, -82.1, -140, 3);
  // the boat only hangs still while it loads: wait for its boarding window, then photograph at once
  await until(async () => (await P.page.evaluate(async () => { const m = await window.__imp("/land/moonBoat.ts"); const c = await window.__imp("/src/village/villageClock.ts"); const n = m.moonBoatAt(c.villageClock.liveMs()); return n.status === "boarding" && Math.abs(n.angle) < 0.01; })), 300000);
  const names = ["s1-seat-front-row", "s2-seat-middle", "s3-seat-back"];
  for (let i = 0; i < 3; i++) {
    const e = eyes[i];
    await shotFrom(P, `${names[i]}.png`, e.x, e.y, e.z, e.x, e.y - 0.15, e.z + 8, phone ? 78 : 70);
  }
  const e = eyes[1];
  await shotFrom(P, "s4-seat-looking-down-left.png", e.x, e.y, e.z, e.x - 1.6, e.y - 0.9, e.z + 1.2, phone ? 78 : 70);
  await shotFrom(P, "s5-seat-looking-down-right.png", e.x, e.y, e.z, e.x + 1.6, e.y - 0.9, e.z + 1.2, phone ? 78 : 70);
  await P.page.evaluate(() => { window.__cvShot = null; });
});
await b.close();
process.exit(run.finish());
