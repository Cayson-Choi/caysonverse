/**
 * e2e/rides-seat-facing.mjs — how ANOTHER client sees seated riders (owner 2026-11-21: "달배의 의자 방향이 반대잖아. 바이킹을 봐봐"). An observer O and two riders
 * G and H in the real game (three small pages):
 *  - the 달배: G takes the default seat (the bow end), H the next one (the stern end). On O's own page both are remote riders: each is turned toward the
 *    MIDDLE of the boat (the bow half faces the stern, the stern half the bow), so the two face each other along the boat's length; photographed from O
 *    at rest and in mid swing;
 *  - the 구름 낙하탑: G is seen facing OUT, back to the column.
 * The facing is read from the pose every remote rider is drawn with on O's page (rideSeats.ts rideSeatPose: the avatar's own forward is +z of its root).
 *   CV_CLIENT_URL=http://localhost:5661 CV_E2E_SLOW=6 node e2e/rides-seat-facing.mjs [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun("rides-seat-facing");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const TIME = "2026-11-03T12:30";
const r2 = (v) => Math.round(v * 100) / 100;

async function joinLand(p, prefix) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(TIME)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  const nick = `${prefix}${Math.floor(Math.random() * 900 + 100)}`; // five characters: the game keeps no more of a nickname
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
const slotOf = (p) => p.page.evaluate(async () => (await window.__imp("/land/coasterRide.ts")).selfRide.slot);
const statusOf = (p, key) =>
  p.page.evaluate(async (key) => {
    const r = await window.__imp("/land/rides.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    return r.rideByKey(key).statusAt(clock.villageClock.liveMs()).status;
  }, key);
/** On the observer's page: each named remote rider's ride, seat, and the pose it is drawn with (position, forward, up). */
const seen = (p, nicks) =>
  p.page.evaluate(async (nicks) => {
    const store = await window.__imp("/src/game/remoteStore.ts");
    const seats = await window.__imp("/src/land/rideSeats.ts");
    const out = [];
    for (const r of store.getRemotes()) {
      if (!nicks.includes(r.nickname)) continue;
      const row = { nick: r.nickname, rideId: r.rideId ?? 0, rideSeat: r.rideSeat ?? -1 };
      // the same pose RemotePlayer draws this rider with each frame (rideSeatPose), as plain numbers
      if (row.rideSeat >= 0) row.pose = seats.rideSeatFacing(row.rideId, row.rideSeat);
      out.push(row);
    }
    return out;
  }, nicks);
const photo = async (p, name, cam, wait = 1200) => {
  await p.page.evaluate((c) => {
    window.__cvShot = c;
  }, cam);
  await sleep(wait);
  await run.shot(p, name);
};

/** A photo camera beside the swinging boat, aimed where the boat will be `aheadMs` from now (the boat moves metres a second): from the east, level with the benches. */
const boatPhoto = async (p, name, aheadMs = 400) => {
  await p.page.evaluate(async (aheadMs) => {
    const w = await window.__imp("/land/moonBoat.ts");
    const clock = await window.__imp("/src/village/villageClock.ts");
    const st = w.moonBoatAt(clock.villageClock.liveMs() + aheadMs);
    const c = w.moonToWorld(0, -w.MOON_ARM_L + 1.2, 0, st.angle);
    window.__cvShot = { x: c.x + 12, y: c.y + 2.5, z: c.z, tx: c.x, ty: c.y, tz: c.z, fov: 58 };
  }, aheadMs);
  await sleep(aheadMs);
  await run.shot(p, name);
  await p.page.evaluate(() => {
    window.__cvShot = null;
  });
};
const b = await launchBrowser();
const small = { viewport: { width: 960, height: 600 } };
const tiny = { viewport: { width: 480, height: 320 } };
const O = await openPlayer(b, run, { tag: "O", device: small });
const G = await openPlayer(b, run, { tag: "G", device: tiny });
const H = await openPlayer(b, run, { tag: "H", device: tiny });
await run.step("join", async () => {
  for (const [p, n] of [[O, "Fo"], [G, "Fg"], [H, "Fh"]]) {
    await joinLand(p, n);
    run.check(`${p.tag} enters the park`, await enterPark(p));
  }
});

const M = { x: -95, z: -140 };
await run.step("달배: two riders, seen by a third", async () => {
  await goTo(O, M.x + 16, M.z + 7, 3);
  await goTo(G, -82.1, -140, 1.5);
  await goTo(H, -82.1, -139, 1.8);
  await until(async () => (await statusOf(G, "moonboat")) === "boarding", 200000 * SLOW);
  await act(G);
  run.check("G is seated", await until(async () => (await slotOf(G)) >= 0, 10000), { slot: await slotOf(G) });
  await act(H);
  run.check("H is seated", await until(async () => (await slotOf(H)) >= 0, 10000), { slot: await slotOf(H) });
  await sleep(2500);
  const rows = await seen(O, [G.nick, H.nick]);
  const g = rows.find((r) => r.nick === G.nick);
  const h = rows.find((r) => r.nick === H.nick);
  run.check("O sees both on the 달배 (rideId 4)", !!g && !!h && g.rideId === 4 && h.rideId === 4 && g.rideSeat >= 0 && h.rideSeat >= 0, { g: g && { seat: g.rideSeat }, h: h && { seat: h.rideSeat } });
  if (g?.pose && h?.pose) {
    const toMid = (r) => Math.sign(M.z - r.pose.pos[2]) * r.pose.fwd[2];
    run.check("G (the bow end) is drawn facing the middle of the boat: toward the stern", g.pose.pos[2] > M.z && toMid(g) > 0.99, { z: r2(g.pose.pos[2]), fwd: g.pose.fwd.map(r2) });
    run.check("H (the stern end) is drawn facing the middle of the boat: toward the bow", h.pose.pos[2] < M.z && toMid(h) > 0.99, { z: r2(h.pose.pos[2]), fwd: h.pose.fwd.map(r2) });
    run.check("the two face each other along the boat's length (not across it, not outward)", g.pose.fwd[2] * h.pose.fwd[2] < -0.99 && Math.abs(g.pose.fwd[0]) < 0.01 && Math.abs(h.pose.fwd[0]) < 0.01, {});
    run.check("both sit upright at rest", g.pose.up[1] > 0.999 && h.pose.up[1] > 0.999, {});
    // photographs on O's page: the whole boat from the side, then each rider seen from the middle of the boat (the FACE shows, not the back of the head)
    const y = g.pose.pos[1];
    await photo(O, "f01-moon-both-from-the-side.png", { x: M.x + 13, y: y + 2.2, z: M.z, tx: M.x, ty: y + 0.5, tz: M.z, fov: 58 });
    await photo(O, "f02-moon-bow-rider-from-the-middle.png", { x: g.pose.pos[0] + 0.2, y: y + 0.9, z: M.z + 1.2, tx: g.pose.pos[0], ty: y + 0.6, tz: g.pose.pos[2], fov: 40 });
    await photo(O, "f03-moon-stern-rider-from-the-middle.png", { x: h.pose.pos[0] + 0.2, y: y + 0.9, z: M.z - 1.2, tx: h.pose.pos[0], ty: y + 0.6, tz: h.pose.pos[2], fov: 40 });
    await photo(O, "f04-moon-from-above.png", { x: M.x + 0.5, y: y + 11, z: M.z + 0.01, tx: M.x, ty: y, tz: M.z, fov: 60 });
  }
  // mid swing: still toward the middle, tipping with the hull
  const swinging = await until(async () => {
    const a = await O.page.evaluate(async () => {
      const w = await window.__imp("/land/moonBoat.ts");
      const clock = await window.__imp("/src/village/villageClock.ts");
      const n = w.moonBoatAt(clock.villageClock.liveMs());
      return n.status === "riding" && n.rideT > 45 && Math.abs(n.angle) > 0.7;
    });
    return a;
  }, 120000 * SLOW);
  if (swinging) {
    await boatPhoto(O, "f05-moon-mid-swing-from-the-side.png");
    const rows2 = await seen(O, [G.nick, H.nick]);
    const g2 = rows2.find((r) => r.nick === G.nick);
    const h2 = rows2.find((r) => r.nick === H.nick);
    run.check("mid swing both are still turned toward the middle (opposite facings along the hull)", !!g2?.pose && !!h2?.pose && g2.pose.fwd[0] ** 2 < 1e-4 && g2.pose.fwd[1] * h2.pose.fwd[1] + g2.pose.fwd[2] * h2.pose.fwd[2] < -0.99, { g: g2?.pose?.fwd.map(r2), h: h2?.pose?.fwd.map(r2) });
  }
  await O.page.evaluate(() => {
    window.__cvShot = null;
  });
  // off when the swing ends
  run.check("G and H are put off at the end", await until(async () => (await slotOf(G)) < 0 && (await slotOf(H)) < 0, 200000 * SLOW));
});

const D = { x: -75, z: -88 };
await run.step("구름 낙하탑: a rider seen by another", async () => {
  await goTo(O, D.x + 18, D.z - 6, 3);
  await goTo(G, -61, -88, 1.5);
  await until(async () => (await statusOf(G, "droptower")) === "boarding", 200000 * SLOW);
  await act(G);
  run.check("G is seated", await until(async () => (await slotOf(G)) >= 0, 10000), { slot: await slotOf(G) });
  await sleep(2500);
  const g = (await seen(O, [G.nick])).find((r) => r.nick === G.nick);
  run.check("O sees G on the tower (rideId 5)", !!g && g.rideId === 5 && g.rideSeat >= 0, { seat: g?.rideSeat });
  if (g?.pose) {
    const out = [g.pose.pos[0] - D.x, g.pose.pos[2] - D.z];
    const len = Math.hypot(out[0], out[1]);
    // the seats of a face sit side by side: the facing is the face's own outward direction (east for the first face)
    run.check("G is drawn facing OUT from the tower (back to the column), upright", (g.pose.fwd[0] * out[0] + g.pose.fwd[2] * out[1]) / len > 0.9 && Math.abs(g.pose.fwd[0]) + Math.abs(g.pose.fwd[2]) > 0.99 && g.pose.up[1] > 0.999, { fwd: g.pose.fwd.map(r2), out: out.map(r2) });
    await photo(O, "f06-drop-rider-from-the-front.png", { x: g.pose.pos[0] + g.pose.fwd[0] * 4.5, y: g.pose.pos[1] + 1.1, z: g.pose.pos[2] + g.pose.fwd[2] * 4.5 + 1.0, tx: g.pose.pos[0], ty: g.pose.pos[1] + 0.5, tz: g.pose.pos[2], fov: 40 });
    await photo(O, "f07-drop-rider-from-the-side.png", { x: g.pose.pos[0] + g.pose.fwd[0] * 1.0, y: g.pose.pos[1] + 0.9, z: g.pose.pos[2] - 5, tx: g.pose.pos[0], ty: g.pose.pos[1] + 0.4, tz: g.pose.pos[2], fov: 40 });
  }
  await O.page.evaluate(() => {
    window.__cvShot = null;
  });
});
await b.close();
process.exit(run.finish());
