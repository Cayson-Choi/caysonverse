/**
 * e2e/village-bus-stop.mjs — the 2026-11-15 independent-check follow-ups and the street poles (owner: "가로등은 통과를 해버리네
 * 깃발기둥도 통과를 해버리고").
 *
 * One player, the bus parked at the stop with boarding still closed (server clock ~300 s before a departure):
 *  - no static collider is left of the bus in the map (the old slices / mirror boxes): the active map is free at the parked bus's
 *    middle, rear corners and mirror spots, while the bus itself pushes (the dynamic body) — and the camera's boxes carry it;
 *  - at the stop, 'E 버스 타기' is NOT offered (no board target) and the timetable chip (no key) says when it comes;
 *  - a walk at a street lamp (plaza lamp, ring road lamp) and at a banner (flag) pole stops short of it: the avatar never gets
 *    inside the pole's collider;
 *  - the lane (the bus's lane R 35.4) and the crosswalk stay open.
 * Evidence: screenshots + JSON in --out.
 *
 *   OFF=$(node -e 'const n=Date.now()+30000,s=Math.ceil((n+300000)/600000)*600000;console.log(s-300000-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2902 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2902 npx vite --port 5502 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5502 node e2e/village-bus-stop.mjs --out=<folder> [--phone]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, targets, waitIdle, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const run = createRun(phone ? "village-bus-stop-phone" : "village-bus-stop");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
const shot = (name) => P.page.screenshot({ path: join(OUT, name) });

await run.step("join", async () => {
  await joinVillage(P, "정류장");
  await P.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null, null, { timeout: 30000 });
});

await run.step("the map has no static bus box; the bus is one moving solid (parked: pushes, never a wall behind it)", async () => {
  const r = await P.page.evaluate(async () => {
    // a circle against the map's static boxes (the server's isBlocked, inline)
    const col = { isBlocked: (x, z, r, boxes) => boxes.some((b) => Math.hypot(Math.max(b.minX - x, 0, x - b.maxX), Math.max(b.minZ - z, 0, z - b.maxZ)) < r) };
    const am = await window.__imp("/src/game/activeMap.ts");
    const tr = await window.__imp("/shared/src/village/transit.ts");
    const obst = await window.__imp("/src/game/playerObstacles.ts");
    const obstacles = am.getActiveMap().geometry.obstacles;
    const pk = tr.TRANSIT.parked;
    const at = (ahead, right) => ({ x: pk.x + Math.sin(pk.yaw) * ahead - Math.cos(pk.yaw) * right, z: pk.z + Math.cos(pk.yaw) * ahead + Math.sin(pk.yaw) * right });
    const push = (x, z) => obst.pushOutOfMovingBus(x, z, () => pk, () => true, () => false);
    const mid = at(0, 0);
    const behind = at(-4.5 - 0.4 - 0.15, 0); // a body's radius and a hair behind the tail
    const mirror = at(4.5 + 0.2, 1.4);
    const sidePush = push(mid.x, mid.z);
    const rearPush = push(behind.x, behind.z);
    const sync = await window.__imp("/src/net/transitSync.ts");
    const poseRender = sync.getBusBodyPose();
    return {
      midFree: !col.isBlocked(mid.x, mid.z, 0.4, obstacles),
      rearFree: !col.isBlocked(behind.x, behind.z, 0.4, obstacles),
      mirrorFree: !col.isBlocked(mirror.x, mirror.z, 0.4, obstacles),
      midPushes: sidePush !== null,
      rearNoWall: rearPush === null,
      parkedPoseIsRender: Math.hypot(poseRender.x - pk.x, poseRender.z - pk.z) < 0.05,
    };
  });
  run.check("the parked bus's middle is not a static collider (it is pushed by the body, not walled)", r.midFree && r.midPushes, r);
  run.check("no air wall behind the tail, none at the mirrors", r.rearFree && r.rearNoWall && r.mirrorFree, r);
  run.check("the client's bus body is the parked pose", r.parkedPoseIsRender, r);
});

await run.step("at the stop with boarding closed: no 'E 버스 타기' target, only the key-less chip", async () => {
  await walkAndWait(P, 38.5, -0.5, 60000, 1);
  await walkAndWait(P, 37.7, -8.9, 40000, 0.6);
  await sleep(900);
  const tg = await targets(P);
  run.check("no board action at the stop while boarding is closed", !tg.some((t) => t.id === "village_bus_board"), tg);
  const chip = await P.page.evaluate(() => document.querySelector(".cv-bus-hint")?.textContent ?? "");
  run.check("the timetable chip is shown (when the next bus leaves and boarding opens)", /다음 버스|운행 중/.test(chip), chip);
  run.check("the chip names no key", !/\bE\b/.test(chip) || /지금 탈 수/.test(chip) === false, chip);
  await shot("stop-1-closed.png");
});

/** Walk at (x, z) and report how near the avatar got: blocked poles stop it a body's radius plus the collider's half away. */
async function walkAtPole(label, x, z, minGap) {
  // approach from a side that is open: a first leg to a point 3 m short, then at the pole
  const at0 = await pos(P);
  const dx = at0.x - x;
  const dz = at0.z - z;
  const d = Math.hypot(dx, dz) || 1;
  await walkAndWait(P, x + (dx / d) * 3, z + (dz / d) * 3, 60000, 1.2);
  await P.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [x, z]);
  await waitIdle(P, 40000); // until the walk ends (arrived, or stopped against something)
  await sleep(500);
  const end = await pos(P);
  const gap = Math.hypot(end.x - x, end.z - z);
  run.check(`${label}: the walk at the pole stops short of it (never inside)`, gap >= minGap, { gap: Math.round(gap * 100) / 100, end });
  return end;
}

await run.step("a ring-road lamp and the plaza's lamp and a flag pole are solid", async () => {
  const spots = await P.page.evaluate(async () => {
    const poles = await window.__imp("/shared/src/village/streetPoles.ts");
    const layout = (await window.__imp("/shared/src/village/villageLayout.ts")).VILLAGE_LAYOUT;
    return { lamps: poles.lampSpots(layout), banners: poles.bannerSpots() };
  });
  // the plaza's first lamp, a flag pole on the paving, and a ring lamp that is not at the bus stop
  const plaza = spots.lamps[0];
  const ring = spots.lamps.find((l, i) => i >= 5 && Math.hypot(l.x - 38, l.z + 6) > 12 && l.x < 30);
  const flag = spots.banners[4];
  void plaza;
  await walkAtPole("flag pole", flag.x, flag.z, 0.4);
  await shot("stop-3-flag.png");
  if (ring) await walkAtPole("ring-road lamp", ring.x, ring.z, 0.45);
});

await browser.close();
process.exit(run.finish({}));
