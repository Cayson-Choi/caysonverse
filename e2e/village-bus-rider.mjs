/**
 * e2e/village-bus-rider.mjs — the bus's riders are in the bus, and the bus stops for avatars on the road (owner
 * 2026-11-15: "버스에 탑승했는데 캐릭터는 버스안에 있지 않고 밖에 그대로 서있어", "도로에 캐릭터가 서 있으면 버스가 통과해버려").
 *
 * Two players in one room. A boards in the boarding window; B, a second client, watches from the pad:
 *  - A is drawn in the bus on both screens (B: its remote probe says "bus-seated", inside the bus's body), the stop's
 *    pill is gone on A's screen and the ride panel says "출발 대기 중 · N 뒤 출발"; screenshots of A's own view and B's;
 *  - B walks onto the bus's lane ahead of the stop; the bus leaves, slows and stands short of B (never overlapping B's
 *    body), with A still in it; screenshots from B (on the road) and A (in the bus); A's leave on the lap is refused;
 *  - B steps onto the pavement: the bus drives on, round the lap, back to the stop: A is put down at the middle door,
 *    on both screens.
 *  - phone: the stop's pill never covers the left HUD column, and its line names no E key.
 *
 * Start the server with its clock ~150 s before a departure (DEV offset), e.g. in Git Bash:
 *   OFF=$(node -e 'const n=Date.now()+150000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=2871 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:2871 npx vite --port 5471 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5471 node e2e/village-bus-rider.mjs --out=<folder> [--phone]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, setOrbit } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const run = createRun(phone ? "village-bus-rider-phone" : "village-bus-rider");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const tag = phone ? "phone" : "pc";
const device = phone ? PHONE : DESKTOP;

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${tag}`, device });
const B = await openPlayer(browser, run, { tag: `B-${tag}`, device });
const shot = (p, name) => p.page.screenshot({ path: join(OUT, name) });
const sid = (p) => p.page.evaluate(() => window.__cv.getSessionId());
const bus = (p) =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const pose = sync.getTransitRenderPose();
    const now = sync.transitNowMs();
    const trip = sync.transitTripAt(now);
    const snap = sync.getTransitState().snapshot;
    return { x: pose.x, z: pose.z, yaw: pose.yaw, now, status: trip.status, startMs: trip.startMs, nextStartMs: trip.nextStartMs, boarded: sync.getTransitState().boarded, blocked: snap?.blocked ?? false, departMs: snap?.drive?.departMs ?? null, notice: sync.getTransitState().notice };
  });
/** A point in the bus's frame: m ahead of its centre and m to its right. */
const local = (b, q) => {
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  const dx = q.x - b.x;
  const dz = q.z - b.z;
  return { ahead: dx * fx + dz * fz, right: -dx * fz + dz * fx };
};
/** Clearance (m) between the bus body (9 x 2.5 m) at `b` and a 0.4 m avatar body at `q` (< 0: overlap). */
const clearance = (b, q) => {
  const l = local(b, q);
  const ex = Math.max(0, Math.abs(l.ahead) - 4.5);
  const ez = Math.max(0, Math.abs(l.right) - 1.25);
  return Math.hypot(ex, ez) - 0.4;
};
const pillText = (p) => p.page.evaluate(() => document.querySelector(".cv-bus-hint")?.textContent ?? "");
const hudText = (p) => p.page.evaluate(() => document.body.innerText);

await run.step("join A and B", async () => {
  await joinVillage(A, "탑승");
  await joinVillage(B, "구경");
  await A.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null, null, { timeout: 30000 });
  const b = await bus(A);
  run.check("boarding is open (server clock set before a departure)", b.status === "boarding", { leftS: Math.round((b.startMs - b.now) / 1000), status: b.status });
});
const sidA = await sid(A);
const sidB = await sid(B);

await run.step("to the stop: A at the doors, B on the pad", async () => {
  await Promise.all([
    (async () => {
      await walkAndWait(A, 38.5, -0.5, 40000, 1);
      await walkAndWait(A, 36.9, -6.0, 30000, 0.4);
    })(),
    (async () => {
      await walkAndWait(B, 38.5, -0.5, 40000, 1);
      await walkAndWait(B, 37.7, -8.9, 30000, 0.5);
    })(),
  ]);
  await sleep(1200);
  const text = await pillText(A);
  run.check("A's pill: board now", text.includes("지금 탈 수 있어요"), text);
  if (phone) {
    run.check("phone: the pill names no E key", !/\bE\b/.test(text), text);
    const overlap = await A.page.evaluate(() => {
      const pill = document.querySelector(".cv-bus-hint")?.getBoundingClientRect();
      if (!pill) return { pill: null };
      const hits = [];
      for (const el of document.querySelectorAll("button, a, [role=button]")) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0 || r.left > 120) continue;
        if (getComputedStyle(el).visibility === "hidden") continue;
        if (r.right > pill.left && r.left < pill.right && r.bottom > pill.top && r.top < pill.bottom) hits.push({ text: el.textContent?.trim().slice(0, 20), left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
      return { pill: { left: pill.left, top: pill.top, right: pill.right, bottom: pill.bottom }, hits };
    });
    run.check("phone: the pill covers none of the left HUD buttons", overlap.pill !== null && overlap.hits.length === 0, overlap);
  }
  await shot(A, `rider-0-pill-${tag}.png`);
});

await run.step("A boards: in the bus on both screens", async () => {
  await act(A);
  const ok = await A.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().boarded, null, { timeout: 8000, polling: 200 }).then(() => true, () => false);
  run.check("boarded", ok, await pos(A));
  await sleep(1500);
  run.check("A's pill is gone once aboard", (await pillText(A)) === "", await pillText(A));
  const hud = await hudText(A);
  run.check("the ride panel says it waits to leave and when", /출발 대기 중 · .+ 뒤 출발/.test(hud) && !hud.includes("노선 운행 중"), hud.split("\n").filter((l) => l.includes("출발") || l.includes("운행")));
  const slot = await A.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot);
  run.check("A has a place in the bus", slot >= 0, { slot });
  const seen = (await B.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidA];
  const b = await bus(B);
  const l = seen ? local(b, seen) : null;
  run.check("B draws A seated in the bus", seen?.mode === "bus-seated" && l && Math.abs(l.ahead) < 4.3 && Math.abs(l.right) < 1.2 && seen.y > 0.3, { seen, local: l });
  await shot(A, `rider-1-self-boarded-${tag}.png`);
  // B looks at A's window from the pavement outside it, a little ahead of A so B's own body is not in the way
  const fx = Math.sin(b.yaw);
  const fz = Math.cos(b.yaw);
  const tx = seen.x + fx * 1.6;
  const tz = seen.z + fz * 1.6;
  await turnCameraTo(B, tx, tz);
  await setOrbit(B, phone ? null : 3.0, 0.1);
  await turnCameraTo(B, tx, tz);
  await sleep(800);
  await shot(B, `rider-1-seen-by-B-${tag}.png`);
  writeFileSync(join(OUT, `rider-boarded-${tag}.json`), JSON.stringify({ seen, bus: b, local: l, slot }, null, 2));
});

// B onto the bus's lane ahead of the stop (25 m along the lap: north of the stop, before any crossing)
const lane = await A.page.evaluate(async () => (await window.__imp("/shared/src/village/transit.ts")).routePoseAtDistance(28));
await run.step("B stands on the road ahead of the bus", async () => {
  await walkAndWait(B, 38.6, -11.5, 20000, 1);
  await walkAndWait(B, lane.x, lane.z, 30000, 0.5);
  const at = await pos(B);
  run.check("B is in the bus's lane", Math.hypot(at.x - lane.x, at.z - lane.z) < 0.8, { at, lane });
  await turnCameraTo(B, 34.8, -6.7);
});

const samples = [];
await run.step("the bus leaves, slows and stands short of B; A rides in it", async () => {
  const b0 = await bus(A);
  const wait = b0.startMs - b0.now;
  run.check("still before the departure", wait > 2000, { waitS: wait / 1000 });
  await sleep(Math.max(0, wait - 500));
  const t0 = Date.now();
  let stoodAt = null;
  while (Date.now() - t0 < 30000) {
    const b = await bus(B);
    const me = await pos(B);
    const a = (await B.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidA];
    samples.push({ t: Date.now() - t0, bus: b, B: { x: me.x, z: me.z }, A: a, clear: clearance(b, me), aLocal: a ? local(b, a) : null });
    if (b.blocked && !stoodAt && samples.length > 3 && Math.hypot(b.x - samples[samples.length - 3].bus.x, b.z - samples[samples.length - 3].bus.z) < 0.01) {
      stoodAt = Date.now() - t0;
      await sleep(600);
      await shot(B, `rider-2-bus-stopped-for-B-${tag}.png`);
      await shot(A, `rider-2-bus-stopped-A-inside-${tag}.png`);
      await A.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).sendBusRide("leave"));
      await sleep(800);
      const n = await bus(A);
      run.check("A's leave on the lap is refused, A stays aboard", n.boarded && (n.notice ?? "").includes("달리는 중"), n);
      break;
    }
    await sleep(120);
  }
  run.check("the bus stood for B", stoodAt !== null, { last: samples.at(-1) });
  const minClear = Math.min(...samples.map((s) => s.clear));
  run.check("the bus never overlapped B (clearance > 0.5 m)", minClear > 0.5, { minClear });
  const out = samples.filter((s) => s.A && s.bus.status === "inTransit").filter((s) => !(Math.abs(s.aLocal.ahead) < 4.3 && Math.abs(s.aLocal.right) < 1.2));
  run.check("B drew A inside the moving bus on every sample", out.length === 0 && samples.some((s) => s.bus.status === "inTransit"), { outside: out.slice(0, 3) });
  const b = await bus(B);
  run.check("the countdown follows the held bus (next departure on the 10-minute grid, after the bus can be back)", b.departMs !== null && b.departMs % 600000 === 0 && b.departMs > b.now, { departMs: b.departMs, now: b.now });
});

await run.step("B steps onto the pavement: the bus drives on, round the lap, and A gets off at the door", async () => {
  await walkAndWait(B, lane.x + (lane.x / Math.hypot(lane.x, lane.z)) * 3.4, lane.z + (lane.z / Math.hypot(lane.x, lane.z)) * 3.4, 15000, 0.8);
  const t0 = Date.now();
  let moved = false;
  const from = await bus(B);
  while (Date.now() - t0 < 15000) {
    const b = await bus(B);
    if (Math.hypot(b.x - from.x, b.z - from.z) > 3) {
      moved = true;
      break;
    }
    await sleep(200);
  }
  run.check("the bus drove on once the way was clear", moved);
  await turnCameraTo(B, 34.8, -6.7);
  const lap = [];
  let off = false;
  for (const t1 = Date.now(); Date.now() - t1 < 180000; ) {
    const a = await bus(A);
    const seat = await A.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot);
    lap.push({ t: Date.now() - t1, status: a.status, boarded: a.boarded, seat, x: a.x, z: a.z, screen: await A.page.evaluate(() => window.__cv.getScreen()) });
    if (!a.boarded) {
      off = true;
      break;
    }
    await sleep(500);
  }
  writeFileSync(join(OUT, `rider-lap-${tag}.json`), JSON.stringify(lap, null, 1));
  const endAt = await bus(A);
  run.check("the ride ended back at the stop", off && endAt.status !== "inTransit", { endAt, sid: await sid(A), sidA });
  await sleep(2500);
  const me = await pos(A);
  // busSeats.ts busDismountSpot(0): outside the middle door, 0.6 m back of the parked bus's centre and 2.55 m to its right
  const spot = await A.page.evaluate(async () => {
    const b = (await window.__imp("/shared/src/village/transit.ts")).TRANSIT.parked;
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    return { x: b.x - fx * 0.6 - fz * 2.55, z: b.z - fz * 0.6 + fx * 2.55 };
  });
  run.check("A is put down outside the middle door", Math.hypot(me.x - spot.x, me.z - spot.z) < 0.3, { me, spot });
  const seen = (await B.page.evaluate(() => window.__cv.getRemoteDrawn()))[sidA];
  run.check("B sees A standing at the door", seen && seen.mode === "up" && Math.hypot(seen.x - spot.x, seen.z - spot.z) < 0.5, seen);
  await shot(A, `rider-3-off-at-door-${tag}.png`);
  await walkAndWait(B, 37.9, -3.6, 30000, 0.8);
  await turnCameraTo(B, spot.x, spot.z);
  await sleep(600);
  await shot(B, `rider-3-off-seen-by-B-${tag}.png`);
});

writeFileSync(join(OUT, `rider-samples-${tag}.json`), JSON.stringify(samples, null, 1));
void sidB;
const code = run.finish();
await browser.close();
process.exit(code);
