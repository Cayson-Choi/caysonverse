/**
 * e2e/remote-sit.mjs — how ANOTHER player sitting down and getting up looks on my screen (fix: remote sit/stand).
 *
 * Tab A sits on a 케이슨 마을 bench (and, with --legacy, on a legacy classroom chair); tab B stands in front of it and
 * records, every frame, where it DRAWS A (`__cv.getRemoteDrawn`: x, z, yaw, and on the fixed build the lift y and the
 * seat mode) and which clip A's avatar plays (`__cvAvatars()`), while A records its own pose and seat (`__cv.getPos`).
 * Both on the epoch clock. Scenarios:
 *   walk-up-sit   A walks up to the bench and presses E the moment it arrives; 2 s later W gets it up and walks on;
 *   sit-then-W    A presses E, and holds W from the frame the seat is confirmed (gets up at once);
 *   still-sit     A stands 3 s facing the bench, then E (the facing turns onto the seat); E again gets up;
 *   chair         (--legacy) the same on a classroom chair, approached from the aisle (through the chair's back).
 * Measured on B's frames: where the sit-down clip starts (how far from where A stood, and how fast the drawn body was
 * still moving), the fastest frame while the clip plays (a "zip" onto the seat), the largest one-frame jump and turn
 * over the whole sit/stand, the lift's largest one-frame change, and for the chair the slide (the distance travelled in
 * frames that are not one-frame snaps).
 *
 *   PORT=2637 npx tsx src/index.ts        (in server/)
 *   node e2e/lib/jitterProxy.mjs 2638 2637 2639        (optional: --net=jitter needs it)
 *   VITE_SERVER_URL=http://localhost:2638 npx vite --port 5237 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5237 CV_PROXY_CONTROL=http://localhost:2639 node e2e/remote-sit.mjs --out=<folder> --label=after [--net=jitter] [--legacy]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { CLIENT_URL, DESKTOP, createRun, entryReady, openPlayer, pos, press, sleep, turnCameraTo, walkAndWait } from "./lib/escape.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const OUT = arg("out", join(process.cwd(), ".superpowers", "sdd", "evidence", "remote-sit"));
const LABEL = arg("label", "run");
const NET = arg("net", "clean");
const LEGACY = process.argv.includes("--legacy");
const CONTROL = process.env.CV_PROXY_CONTROL || "";
mkdirSync(OUT, { recursive: true });

const run = createRun(`remote-sit-${LABEL}-${NET}${LEGACY ? "-legacy" : ""}`);
run.evidence = OUT;
const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, channel: "chrome", args: gpu });
if (CONTROL) await fetch(`${CONTROL}/set?base=${NET === "jitter" ? 40 : 0}&jitter=${NET === "jitter" ? 140 : 0}`);

// ───────────────────────────── recording ─────────────────────────────

const startRecA = (p) =>
  p.page.evaluate(() => {
    window.__rec = [];
    const loop = () => {
      const q = window.__cv?.getPos?.();
      if (q) window.__rec.push({ t: performance.timeOrigin + performance.now(), x: q.x, z: q.z, yaw: q.yaw, seat: q.seatIndex });
      window.__recRaf = requestAnimationFrame(loop);
    };
    loop();
  });
/**
 * B's recorder: A's avatar GROUP as it is in B's scene (its position, lift y and facing — what B sees, on any build:
 * the old build's probe left the stand-up glide out), found once by the probe's pose, plus the clip A's avatar plays.
 * The legacy world has no scene hook: there the probe is used (a chair has no glide or lift on either build).
 */
const startRecB = (p, sid) =>
  p.page.evaluate((sid) => {
    window.__rec = [];
    const d0 = window.__cv.getRemoteDrawn()[sid];
    let group = null;
    const probe = { position: { x: 0, z: 0, y: 0 }, rotation: { y: 0 } };
    if (!window.__cvThree) group = probe;
    else window.__cvThree().scene.traverse((o) => {
      if (!group && o.isGroup && o.children.length > 0 && Math.abs(o.position.x - d0.x) < 1e-6 && Math.abs(o.position.z - d0.z) < 1e-6) group = o;
    });
    let lastT = -1;
    const loop = () => {
      const d = window.__cv?.getRemoteDrawn?.()[sid];
      if (d && group && d.t !== lastT) {
        lastT = d.t;
        if (group === probe) Object.assign(probe, { position: { x: d.x, z: d.z, y: d.y ?? 0 }, rotation: { y: d.yaw } });
        const clip = window.__cvAvatars?.()[sid]?.clip ?? null;
        const g = group.position;
        window.__rec.push({ t: performance.timeOrigin + d.t, x: g.x, z: g.z, y: g.y, yaw: group.rotation.y, mode: d.mode ?? null, clip });
      }
      window.__recRaf = requestAnimationFrame(loop);
    };
    loop();
    return !!group;
  }, sid);
const stopRec = (p) =>
  p.page.evaluate(() => {
    cancelAnimationFrame(window.__recRaf);
    const r = window.__rec;
    window.__rec = [];
    return r;
  });
const epoch = (p) => p.page.evaluate(() => performance.timeOrigin + performance.now());

// ───────────────────────────── analysis ─────────────────────────────

const ang = (a) => Math.abs(Math.atan2(Math.sin(a), Math.cos(a)));
const r3 = (n) => Math.round(n * 1000) / 1000;

function analyse(name, a, b) {
  const clipIs = (f, base) => typeof f.clip === "string" && f.clip.startsWith(base);
  const sit = b.findIndex((f, i) => i > 0 && clipIs(f, "Sit_Chair_Down") && !clipIs(b[i - 1], "Sit_Chair_Down"));
  const stand = b.findIndex((f, i) => i > sit && clipIs(f, "Sit_Chair_StandUp"));
  // Where A stood when its seat was confirmed (its own sit-down starts there), and the time.
  const seatedA = a.findIndex((q, i) => i > 0 && q.seat >= 0 && a[i - 1].seat < 0);
  const stoodA = seatedA > 0 ? a[seatedA - 1] : null;
  const out = { name, frames: b.length, sitFrame: sit, standFrame: stand };
  if (sit < 2 || !stoodA) return { ...out, error: "no sit-down seen" };
  const pre = b[sit - 1];
  const pre2 = b[sit - 2];
  out.sitStartFromStoodM = r3(Math.hypot(pre.x - stoodA.x, pre.z - stoodA.z));
  out.sitStartSpeedMs = r3(Math.hypot(pre.x - pre2.x, pre.z - pre2.z) / ((pre.t - pre2.t) / 1000));
  // While the sit-down clip plays (0.8 s): the fastest frame (m/s).
  let zip = 0;
  for (let i = sit; i < b.length && b[i].t - b[sit].t < 800; i++) {
    const dt = (b[i].t - b[i - 1].t) / 1000;
    if (dt > 0) zip = Math.max(zip, Math.hypot(b[i].x - b[i - 1].x, b[i].z - b[i - 1].z) / dt);
  }
  out.sitMaxSpeedMs = r3(zip);
  // Over the whole sit/stand (from 1 s before the sit-down to 1.5 s after the stand-up starts): the worst frame, as
  // a rate (a screenshot stalls a frame or two; a rate is not fooled by that), and the largest one-frame step.
  const lo = b.findIndex((f) => f.t >= b[sit].t - 1000);
  const hiT = stand > 0 ? b[stand].t + 1500 : b[b.length - 1].t;
  let jump = 0;
  let speed = 0;
  let turnRate = 0;
  let turn = 0;
  let liftRate = 0;
  let slide = 0;
  for (let i = Math.max(1, lo); i < b.length && b[i].t <= hiT; i++) {
    const dt = Math.max(1e-3, (b[i].t - b[i - 1].t) / 1000);
    const d = Math.hypot(b[i].x - b[i - 1].x, b[i].z - b[i - 1].z);
    const dy = ang(b[i].yaw - b[i - 1].yaw);
    jump = Math.max(jump, d);
    speed = Math.max(speed, d / dt);
    turn = Math.max(turn, dy);
    turnRate = Math.max(turnRate, dy / dt);
    liftRate = Math.max(liftRate, Math.abs(b[i].y - b[i - 1].y) / dt);
    if (d < 0.5) slide += d;
  }
  out.maxFrameStepM = r3(jump);
  out.maxSpeedMs = r3(speed);
  out.maxFrameTurnDeg = Math.round((turn * 180) / Math.PI);
  out.maxTurnRateDegS = Math.round((turnRate * 180) / Math.PI);
  out.maxLiftRateMs = r3(liftRate);
  out.slideM = r3(slide);
  out.standAfterSitMs = stand > 0 ? Math.round(b[stand].t - b[sit].t) : null;
  return out;
}

// ───────────────────────────── scenario helpers ─────────────────────────────

/**
 * Click-move to (x, z) and return the moment it arrives (the click target clears), once the action button offers
 * 앉기 (the prompt loop runs at ~5 Hz) — so E is pressed on arrival, as a player who walks up and presses it would.
 */
async function walkUpTo(p, x, z) {
  await p.page.evaluate(async ([x, z]) => {
    const m = await window.__imp("/src/game/clickMove.ts");
    window.__cm = m;
    m.setClickTarget(x, z);
  }, [x, z]);
  await sleep(100);
  await p.page.waitForFunction(() => window.__cm.getClickTarget() === null, null, { timeout: 30000, polling: "raf" });
  await p.page.waitForFunction(() => (document.querySelector(".cv-action-btn")?.textContent ?? "").includes("앉기"), null, { timeout: 5000, polling: "raf" }).catch(() => {});
  if (process.env.DBG) console.log("arrived", await pos(p), await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "(none)"));
}
const seatIs = (p, pred, ms = 8000, arg = null) =>
  p.page.waitForFunction(pred, arg, { timeout: ms, polling: "raf" }).then(
    () => true,
    () => false,
  );

/** B's screen captures of A's sit-down (the game camera): `0-before` now, then `1-mid` and `2-seated` on call. */
async function shots(viewer, prefix) {
  const shoot = (name) => viewer.page.screenshot({ path: join(OUT, `${prefix}-${name}.png`) });
  await shoot("0-before");
  return { mid: () => shoot("1-mid"), end: () => shoot("2-seated") };
}

async function recordScenario(name, A, B, sidA, act) {
  await startRecA(A);
  run.check(`${name}: B found A's avatar in its scene`, await startRecB(B, sidA));
  const t0 = await epoch(A);
  await act();
  const t1 = await epoch(A);
  const a = await stopRec(A);
  const b = await stopRec(B);
  writeFileSync(join(OUT, `trace-${LABEL}-${NET}-${name}.json`), JSON.stringify({ t0, t1, a, b }));
  const res = analyse(name, a, b);
  console.log(JSON.stringify(res));
  return res;
}

// ───────────────────────────── run ─────────────────────────────

const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP });
for (const p of [A, B]) await p.ctx.addInitScript(() => performance.setResourceTimingBufferSize(5000));
const results = [];

async function sidOf(viewer, nick) {
  await viewer.page.waitForFunction((n) => window.__cv.getRemotes().some((r) => r.nickname === n), nick, { timeout: 20000 });
  return viewer.page.evaluate((n) => window.__cv.getRemotes().find((r) => r.nickname === n).sessionId, nick);
}

if (!LEGACY) {
  await run.step("1. two players in 케이슨 마을; B watches the plaza bench", async () => {
    await joinVillage(A, "앉A");
    await joinVillage(B, "봄B");
  });
  const seats = await A.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s) => ({ ...s })));
  const S = 6; // plaza_4, by the spawn
  const s = seats[S];
  const side = (d, along) => [s.x + Math.sin(s.yaw) * d + Math.cos(s.yaw) * along, s.z + Math.cos(s.yaw) * d - Math.sin(s.yaw) * along];
  const sidA = await sidOf(B, A.nick);
  const [bx, bz] = side(4.2, -2.2);
  await walkAndWait(B, bx, bz, 30000, 0.5);
  await turnCameraTo(B, s.x, s.z);

  // The stop spot: 1.15 m from the seat, in front of the bench and clear of its collider; A comes from the west.
  const stop = [s.x - 0.75, s.z - 0.865];
  const toStart = async () => {
    await walkAndWait(A, stop[0] - 4.5, stop[1], 30000, 0.4);
    await sleep(800);
  };

  await run.step("2. walk-up-sit: E the moment A arrives, W 2 s later", async () => {
    await toStart();
    const res = await recordScenario("walk-up-sit", A, B, sidA, async () => {
      await walkUpTo(A, stop[0], stop[1]);
      await A.page.keyboard.press("KeyE");
      const shot = await shots(B, `${LABEL}-${NET}-walk-up-sit`);
      await sleep(420);
      await shot.mid();
      run.check("A is seated", await seatIs(A, () => window.__cv.getPos().seatIndex >= 0));
      await sleep(1500);
      await shot.end();
      await sleep(500);
      await A.page.keyboard.down("KeyW");
      await sleep(900);
      await A.page.keyboard.up("KeyW");
      await sleep(1500);
    });
    results.push(res);
  });

  await run.step("3. sit-then-W: W held from the frame the seat is confirmed", async () => {
    await toStart();
    const res = await recordScenario("sit-then-W", A, B, sidA, async () => {
      await walkUpTo(A, stop[0], stop[1]);
      await sleep(300);
      await A.page.keyboard.press("KeyE");
      run.check("A is seated", await seatIs(A, () => window.__cv.getPos().seatIndex >= 0));
      await A.page.keyboard.down("KeyW");
      await sleep(1600);
      await A.page.keyboard.up("KeyW");
      await sleep(1500);
    });
    results.push(res);
  });

  await run.step("4. still-sit: 3 s on the spot facing the bench, then E; E again to get up", async () => {
    await toStart();
    const res = await recordScenario("still-sit", A, B, sidA, async () => {
      await walkUpTo(A, stop[0], stop[1]);
      await sleep(3000);
      await A.page.keyboard.press("KeyE");
      const shot = await shots(B, `${LABEL}-${NET}-still-sit`);
      await sleep(420);
      await shot.mid();
      run.check("A is seated", await seatIs(A, () => window.__cv.getPos().seatIndex >= 0));
      await sleep(1800);
      await shot.end();
      await A.page.keyboard.press("KeyE");
      run.check("A stood up", await seatIs(A, () => window.__cv.getPos().seatIndex === -1));
      await sleep(1800);
    });
    results.push(res);
  });
} else {
  // The legacy world's renderer warns about its shadow type once per tab (as on main; not this test's business).
  run.allow("PCFSoftShadowMap deprecation (legacy world)", /PCFSoftShadowMap has been deprecated/);
  await run.step("1. two players in the legacy world; B watches a classroom chair", async () => {
    for (const [p, nick] of [
      [A, "앉A"],
      [B, "봄B"],
    ]) {
      await p.page.goto(new URL("/?world=legacy", CLIENT_URL).href, { waitUntil: "domcontentloaded" });
      await entryReady(p);
      p.nick = `${nick}${Math.floor(Math.random() * 900 + 100)}`.slice(0, 5);
      await p.page.locator("input.cv-input").first().fill(p.nick);
      await press(p, p.page.locator(".cv-submit"));
      await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 40000 });
      await sleep(2500);
    }
  });
  const seats = await A.page.evaluate(async () => (await window.__imp("/shared/src/worldMap.ts")).SEATS.map((s) => ({ ...s })));
  const S = 3; // front row by the door: the chair at (2.7, 3) faces the screen (+x); its dismount (1.8, 3) is behind it
  const s = seats[S];
  const sidA = await sidOf(B, A.nick);
  const DOOR = [
    [-2, 0],
    [2, 0],
  ];
  for (const [x, z] of DOOR) await walkAndWait(B, x, z, 20000, 0.6);
  await walkAndWait(B, s.standX, s.z - 3.6, 30000, 0.5);
  await turnCameraTo(B, s.x, s.z);
  for (const [x, z] of DOOR) await walkAndWait(A, x, z, 20000, 0.6);
  await run.step("2. chair: walk up to its back, E after 1 s, E again 2 s later", async () => {
    await walkAndWait(A, s.standX - 1.3, s.z, 30000, 0.4);
    await sleep(800);
    const res = await recordScenario("chair", A, B, sidA, async () => {
      await walkUpTo(A, s.standX - 0.05, s.z); // 0.95 m behind the chair (it faces +x)
      await sleep(1000);
      await A.page.keyboard.press("KeyE");
      const shot = await shots(B, `${LABEL}-${NET}-chair`);
      await sleep(250);
      await shot.mid();
      run.check("A is seated on the chair", await seatIs(A, (i) => window.__cv.getPos().seatIndex === i, 8000, S));
      await sleep(2000);
      await shot.end();
      await A.page.keyboard.press("KeyE");
      run.check("A stood up", await seatIs(A, () => window.__cv.getPos().seatIndex === -1));
      await sleep(1800);
    });
    results.push(res);
  });
}

await browser.close();
writeFileSync(join(OUT, `summary-${LABEL}-${NET}${LEGACY ? "-legacy" : ""}.json`), JSON.stringify(results, null, 2));
process.exit(run.finish({ out: OUT, results }));
