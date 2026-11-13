/**
 * e2e/remote-move.mjs — how ANOTHER player's walking looks on my screen (the "goes ahead, then snaps back" bug).
 *
 * Two tabs join 케이슨 마을. Tab A (the mover) walks, runs, turns, stops and starts with the KEYBOARD on the
 * straight lane north of the plaza; tab B (the viewer) records, every frame, where it DRAWS A's avatar
 * (`__cv.getRemoteDrawn`) while tab A records its own pose (`__cv.getPos`). Both on the epoch clock
 * (performance.timeOrigin + now), so B's drawn path is compared with A's true path:
 *   - backtrack   how far the drawn avatar moved BACK along A's true path (running max − now) — must be ~0;
 *   - overshoot   how far past each true stop point the drawn avatar went — must be ~0;
 *   - offPath     how far the drawn avatar left A's true path (a dead-reckoned turn cuts a tangent) — small;
 *   - speed       the drawn speed while A walks/runs steadily: its spread is the visible jitter.
 * Run once on a clean link and once through a jitter proxy (e2e/lib/jitterProxy.mjs) that delays every chunk
 * by base + random·jitter ms in both directions, order kept (TCP head-of-line).
 *
 *   PORT=2617 npm run dev -w server                                   (or any server port)
 *   node e2e/lib/jitterProxy.mjs 2618 2617 2619                        (the client talks to :2618)
 *   VITE_SERVER_URL=http://localhost:2618 npx vite --port 5217 (in client/)
 *   CV_CLIENT_URL=http://localhost:5217 CV_PROXY_CONTROL=http://localhost:2619 node e2e/remote-move.mjs --out=<folder> [--label=after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { DESKTOP, createRun, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const OUT = arg("out", join(process.cwd(), ".superpowers", "sdd", "evidence", "remote-move"));
const LABEL = arg("label", "run");
const CONTROL = process.env.CV_PROXY_CONTROL || "";
mkdirSync(OUT, { recursive: true });

/** Network conditions to run the scenario under (base + random·jitter ms per chunk, each direction). */
const NETWORKS = [
  { name: "clean", base: 0, jitter: 0 },
  { name: "jitter", base: 40, jitter: 140 },
  // a phone's hiccup: a clean link that freezes for 900 ms (everything queued, then delivered at once) mid-run
  { name: "stall", base: 0, jitter: 0, stallMs: 900 },
];

const run = createRun(`remote-move-${LABEL}`);
run.evidence = OUT; // screenshots + the assertions file go next to the traces
const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, channel: "chrome", args: gpu });

const setNet = async (n) => {
  if (!CONTROL) return n.base === 0 && n.jitter === 0;
  await fetch(`${CONTROL}/set?base=${n.base}&jitter=${n.jitter}`);
  return true;
};

// ───────────────────────────── recording (in-page rAF loops) ─────────────────────────────

const startRecA = (p) =>
  p.page.evaluate(() => {
    window.__rec = [];
    const loop = () => {
      const q = window.__cv?.getPos?.();
      if (q) window.__rec.push({ t: performance.timeOrigin + performance.now(), x: q.x, z: q.z, yaw: q.yaw });
      window.__recRaf = requestAnimationFrame(loop);
    };
    loop();
  });
const startRecB = (p, sid) =>
  p.page.evaluate(async (sid) => {
    window.__rec = [];
    window.__snaps = [];
    const store = await window.__imp("/src/game/remoteStore.ts");
    let lastT = -1;
    let lastSnapT = -Infinity;
    const loop = () => {
      // every snapshot B received for A (the interpolation buffer's input), for the diagnosis
      for (const sn of store.getRemoteRecord(sid)?.snapshots ?? []) {
        if (sn.t > lastSnapT) {
          lastSnapT = sn.t;
          window.__snaps.push({ ...sn, epoch: performance.timeOrigin + performance.now() });
        }
      }
      const d = window.__cv?.getRemoteDrawn?.()[sid];
      if (d && d.t !== lastT) {
        lastT = d.t;
        const gait = window.__cv.getRemoteGaits()[sid] ?? null;
        window.__rec.push({ t: performance.timeOrigin + d.t, x: d.x, z: d.z, yaw: d.yaw, gait });
      }
      window.__recRaf = requestAnimationFrame(loop);
    };
    loop();
  }, sid);
const stopRec = (p) =>
  p.page.evaluate(() => {
    cancelAnimationFrame(window.__recRaf);
    const r = window.__rec;
    window.__rec = [];
    return r;
  });
const takeSnaps = (p) => p.page.evaluate(() => window.__snaps ?? []);

// ───────────────────────────── the keyboard scenario (tab A) ─────────────────────────────

/** Hold `keys` for `ms`, then release them (in reverse). */
async function hold(page, keys, ms) {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
}

/** One hiccup while A runs: the link freezes for `ms`, then everything queued arrives at once. */
async function hiccupScenario(page, marks, ms) {
  const t0 = await page.evaluate(() => performance.timeOrigin + performance.now());
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("KeyW");
  await sleep(500);
  await fetch(`${CONTROL}/stall?ms=${ms}`);
  await sleep(1300);
  await page.keyboard.up("KeyW");
  await page.keyboard.up("ShiftLeft");
  const t1 = await page.evaluate(() => performance.timeOrigin + performance.now());
  marks.push({ name: `run-with-${ms}ms-hiccup`, t0, t1 });
  await sleep(2500);
}

/** Every phase is logged with its epoch start/end, so the analysis knows where A walked steadily and where it stopped. */
async function scenario(page, marks) {
  const mark = async (name, fn) => {
    const t0 = await page.evaluate(() => performance.timeOrigin + performance.now());
    await fn();
    const t1 = await page.evaluate(() => performance.timeOrigin + performance.now());
    marks.push({ name, t0, t1 });
  };
  const rest = () => sleep(1400);
  await mark("walk-north", () => hold(page, ["KeyW"], 1500));
  await rest();
  await mark("walk-south(turn 180)", () => hold(page, ["KeyS"], 1500));
  await rest();
  await mark("run-north", () => hold(page, ["ShiftLeft", "KeyW"], 1500));
  await rest();
  await mark("run-south(turn 180)", () => hold(page, ["ShiftLeft", "KeyS"], 1500));
  await rest();
  await mark("walk-curve", async () => {
    await page.keyboard.down("KeyW");
    await sleep(500);
    await hold(page, ["KeyD"], 500);
    await hold(page, ["KeyA"], 900);
    await hold(page, ["KeyD"], 400);
    await page.keyboard.up("KeyW");
  });
  await rest();
  await mark("stop-start", async () => {
    for (let k = 0; k < 4; k++) {
      await hold(page, ["KeyW"], 280);
      await sleep(260);
    }
  });
  await rest();
}

// ───────────────────────────── analysis ─────────────────────────────

/** A's true pose at epoch t (linear between A's own frames). */
function trueAt(a, t) {
  if (t <= a[0].t) return a[0];
  for (let i = 1; i < a.length; i++) {
    if (a[i].t >= t) {
      const f = (t - a[i - 1].t) / (a[i].t - a[i - 1].t || 1);
      return { t, x: a[i - 1].x + (a[i].x - a[i - 1].x) * f, z: a[i - 1].z + (a[i].z - a[i - 1].z) * f };
    }
  }
  return a[a.length - 1];
}

/** Distance from a point to A's true path, only the part A walked in [tLo, tHi]. */
function offPath(a, pt, tLo, tHi) {
  let best = Infinity;
  for (let i = 1; i < a.length; i++) {
    if (a[i].t < tLo || a[i - 1].t > tHi) continue;
    const ax = a[i - 1].x, az = a[i - 1].z;
    const dx = a[i].x - ax, dz = a[i].z - az;
    const L2 = dx * dx + dz * dz;
    const f = L2 > 0 ? Math.max(0, Math.min(1, ((pt.x - ax) * dx + (pt.z - az) * dz) / L2)) : 0;
    best = Math.min(best, Math.hypot(pt.x - (ax + dx * f), pt.z - (az + dz * f)));
  }
  return best;
}

/** B's display lag behind A (ms): the time shift that best lays B's drawn path over A's true path. */
function displayLag(a, b) {
  let best = { lag: 0, err: Infinity };
  for (let lag = 0; lag <= 900; lag += 5) {
    let err = 0;
    let n = 0;
    for (const pt of b) {
      const q = trueAt(a, pt.t - lag);
      err += Math.hypot(pt.x - q.x, pt.z - q.z);
      n += 1;
    }
    if (n && err / n < best.err) best = { lag, err: err / n };
  }
  return best.lag;
}

/**
 * Per phase, along the phase's travel direction u (A's start → stop; every phase's true path only ever advances along it,
 * the 180° turns included — checked on A's own trace as `trueBacktrackM`):
 *   backtrack  max over the phase of (furthest reached so far − now) — the "went ahead, came back" distance;
 *   overshoot  furthest reached − the true stop point;
 *   offPath    max distance from A's true path (recent 0.9 s of it): a dead-reckoned turn cuts a tangent;
 *   speed      the drawn 2-D speed frame by frame over the steady middle of the phase (B's clock = A's + lag).
 */
function analyse(a, b, marks) {
  const lag = displayLag(a, b);
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const phases = marks.map((m) => {
    const p0 = trueAt(a, m.t0 - 50);
    const p1 = trueAt(a, m.t1 + 300); // stopped by then (A stops on the key-up frame)
    const len = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
    const ux = (p1.x - p0.x) / len, uz = (p1.z - p0.z) / len;
    const along = (pt) => (pt.x - p0.x) * ux + (pt.z - p0.z) * uz;
    const backtrack = (pts) => {
      let reach = -Infinity;
      let worst = 0;
      for (const pt of pts) {
        const s = along(pt);
        reach = Math.max(reach, s);
        worst = Math.max(worst, reach - s);
      }
      return { worst, reach };
    };
    const shown = b.filter((r) => r.t >= m.t0 + lag - 100 && r.t <= m.t1 + lag + 1300);
    const own = a.filter((r) => r.t >= m.t0 && r.t <= m.t1 + 1300);
    const bb = backtrack(shown);
    const ab = backtrack(own);
    const stopS = along(p1);
    const off = Math.max(0, ...shown.map((pt) => offPath(a, pt, pt.t - lag - 900, pt.t - lag + 300)));
    const steady = b.filter((r) => r.t >= m.t0 + lag + 350 && r.t <= m.t1 + lag - 100);
    const v = [];
    for (let i = 1; i < steady.length; i++) {
      const dt = (steady[i].t - steady[i - 1].t) / 1000;
      if (dt > 0) v.push(Math.hypot(steady[i].x - steady[i - 1].x, steady[i].z - steady[i - 1].z) / dt);
    }
    const trueSteady = a.filter((r) => r.t >= m.t0 + 350 && r.t <= m.t1 - 100);
    const tv = trueSteady.length > 1 ? (() => {
      let d = 0;
      for (let i = 1; i < trueSteady.length; i++) d += Math.hypot(trueSteady[i].x - trueSteady[i - 1].x, trueSteady[i].z - trueSteady[i - 1].z);
      return d / ((trueSteady[trueSteady.length - 1].t - trueSteady[0].t) / 1000);
    })() : 0;
    const sorted = [...v].sort((x, y) => x - y);
    const q = (f) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] : 0);
    const mean = v.length ? v.reduce((x, y) => x + y, 0) / v.length : 0;
    const sd = v.length ? Math.sqrt(v.reduce((x, y) => x + (y - mean) ** 2, 0) / v.length) : 0;
    return {
      phase: m.name,
      maxBacktrackM: r3(bb.worst),
      overshootPastStopM: r3(Math.max(0, bb.reach - stopS)),
      maxOffPathM: r3(off),
      trueBacktrackM: r3(ab.worst),
      trueSpeed: r3(tv),
      steadySpeed: { mean: r3(mean), sd: r3(sd), p05: r3(q(0.05)), p95: r3(q(0.95)), frames: v.length },
      steadyGaits: [...new Set(steady.map((r) => r.gait))],
    };
  });
  return { lag, phases };
}

// ───────────────────────────── the run ─────────────────────────────

const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP });
const summary = { label: LABEL, networks: [] };

await run.step("join the village (A = mover, B = viewer)", async () => {
  await joinVillage(A, "move");
  await joinVillage(B, "view");
  run.check("A joined", (await A.page.evaluate(() => window.__cv.getScreen())) === "village");
  run.check("B joined", (await B.page.evaluate(() => window.__cv.getScreen())) === "village");
});

const sidA = await A.page.evaluate(() => window.__cv.getSessionId());

await run.step("A to the lane north of the plaza, B a few metres behind it", async () => {
  for (const [x, z] of [[-20, 5], [-14, -20], [0, -33]]) await walkAndWait(A, x, z, 40000, 1.2);
  await walkAndWait(A, 0, -35, 15000, 0.5);
  await turnCameraTo(A, 0, -60);
  for (const [x, z] of [[-20, 5], [-14, -20], [-3, -28]]) await walkAndWait(B, x, z, 40000, 1.2);
  await turnCameraTo(B, 0, -45);
  const a = await pos(A);
  run.check("A on the lane", Math.abs(a.x) < 1 && Math.abs(a.z + 35) < 1, a);
  await sleep(800);
  run.check("B sees A", (await B.page.evaluate((sid) => !!window.__cv.getRemoteDrawn()[sid], sidA)) === true);
});

const ONLY = arg("only", "");
for (const net of NETWORKS.filter((n) => !ONLY || ONLY.split(",").includes(n.name))) {
  await run.step(`keyboard scenario — ${net.name} network (base ${net.base} + jitter ${net.jitter} ms)`, async () => {
    if (!(await setNet(net))) {
      run.check("network condition available (CV_PROXY_CONTROL)", false, "no proxy control: skipped");
      return;
    }
    await sleep(1500);
    // back to the start of the lane between runs
    await walkAndWait(A, 0, -35, 15000, 0.5);
    await turnCameraTo(A, 0, -60);
    await sleep(1200);
    const marks = [];
    await startRecA(A);
    await startRecB(B, sidA);
    const shots = (async () => {
      await sleep(900);
      await run.shot(B, `${LABEL}-${net.name}-viewer-walk.png`);
      await sleep(4300);
      await run.shot(B, `${LABEL}-${net.name}-viewer-run.png`);
    })();
    if (net.stallMs) await hiccupScenario(A.page, marks, net.stallMs);
    else await scenario(A.page, marks);
    await shots;
    const a = await stopRec(A);
    const b = await stopRec(B);
    const snaps = await takeSnaps(B);
    const { lag, phases } = analyse(a, b, marks);
    writeFileSync(join(OUT, `${LABEL}-${net.name}-trace.json`), JSON.stringify({ net, sidA, lag, marks, a, b, snaps }, null, 0));
    summary.networks.push({ net, lagMs: lag, phases });
    console.log(`   display lag of B behind A: ${lag} ms`);
    for (const ph of phases) {
      console.log(`   ${ph.phase.padEnd(22)} back ${ph.maxBacktrackM.toFixed(3)} m  over ${ph.overshootPastStopM.toFixed(3)} m  off ${ph.maxOffPathM.toFixed(3)} m  v ${ph.steadySpeed.mean} ±${ph.steadySpeed.sd} [${ph.steadySpeed.p05}..${ph.steadySpeed.p95}] (true ${ph.trueSpeed}, true back ${ph.trueBacktrackM})  ${ph.steadyGaits.join("/")}`);
    }
    // Where the SERVER put A once A stopped (the newest snapshot B holds) vs where A really stands: a move the
    // server's speed check dropped leaves everyone else seeing A somewhere A is not.
    for (const [i, m] of marks.entries()) {
      const truth = a.filter((r) => r.t <= m.t1 + 600).pop();
      const got = snaps.filter((sn) => sn.epoch <= m.t1 + 1300).pop();
      phases[i].serverRestErrorM = truth && got ? Math.round(Math.hypot(got.x - truth.x, got.z - truth.z) * 1000) / 1000 : null;
      console.log(`   ${m.name.padEnd(22)} server rest vs A's stop: ${phases[i].serverRestErrorM} m`);
    }
    run.check(`${net.name}: the server ends where A stopped (<= 5 cm)`, Math.max(...phases.map((p) => p.serverRestErrorM ?? 99)) <= 0.05, phases.map((p) => p.serverRestErrorM));
    const worstBack = Math.max(...phases.map((p) => p.maxBacktrackM));
    const worstOver = Math.max(...phases.map((p) => p.overshootPastStopM));
    run.check(`${net.name}: the drawn avatar never moves back along the path (≤ 2 cm)`, worstBack <= 0.02, { worstBack });
    run.check(`${net.name}: it never runs past a stop point (≤ 2 cm)`, worstOver <= 0.02, { worstOver });
    // The mover's OWN screen: no pull-back on a clean or jittery link; after a freeze longer than the server's
    // 4.8 m burst budget (a 900 ms freeze while running is ~5.8 m), one resync to what the server took — under
    // the 3 m snap distance (the old code: ~6 m, yanked back to a stale echo).
    const ownBack = Math.max(...phases.map((p) => p.trueBacktrackM));
    const ownLimit = net.stallMs ? 3 : 0.02;
    run.check(`${net.name}: the mover is not pulled back on its own screen (<= ${ownLimit} m)`, ownBack <= ownLimit, { ownBack });
  });
}

await setNet({ base: 0, jitter: 0 });
writeFileSync(join(OUT, `${LABEL}-summary.json`), JSON.stringify(summary, null, 2));
await browser.close();
process.exit(run.finish({ summary }));
