/**
 * e2e/crowd-100.mjs — 100 remote avatars in ONE view (perf/crowd, 2026-11-18; owner: "100명이 플레이하는데 끊김이나 렉이나 이런게
 * 걸리면 안돼"). A room holds 30 players, so the crowd is injected on the client: fake remote records (the same store the room
 * writes: remoteStore.addRemote + receiveRemotePose) in a cone in front of the camera, half standing, half walking round small
 * circles (poses fed every 100 ms like the server's patches), random looks from randomAppearance.
 *
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/crowd-100.mjs --device pc|phone [--n 100] [--ms 12000] [--label before]
 *     [--dsf 3] [--tags all|nearby] [--bubbles 20]
 *
 * --dsf: the page's deviceScaleFactor (phone: also a 412 x 915 Android-sized view; fix/crisp-labels measured the label overlay
 * at a real phone's 3). --tags all: every avatar's name tag shown (the "이름표 보기: 모두" setting), not the nearest 15.
 * --bubbles N: N of the crowd keep a speech bubble up the whole run.
 *
 * Output (stdout + <out>/crowd-<device>-<label>.json): frame stats (mean/p50/p95/p99/max ms, fps, frames over 50 / 100 ms), draw
 * calls, triangles, skinned meshes in the scene and how many are visible, and a CPU profile's self time per function group
 * (mixer / skinning / scene-graph matrices / render / ...) in ms per frame. phone = 375x812, 4x CPU throttle, graphics low.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, REPO, cdp, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "pc" },
    n: { type: "string", default: "100" },
    ms: { type: "string", default: "12000" },
    label: { type: "string", default: "run" },
    throttle: { type: "string" },
    out: { type: "string" },
    walkers: { type: "string", default: "0.5" },
    lod: { type: "string", default: "new" },
    "no-profile": { type: "boolean", default: false },
    dsf: { type: "string" },
    tags: { type: "string" },
    bubbles: { type: "string", default: "0" },
  },
});
const PHONE_DEV = args.device === "phone";
const N = Number(args.n);
const MS = Number(args.ms);
const THROTTLE = Number(args.throttle ?? (PHONE_DEV ? 4 : 1));
const OUT = args.out ?? join(REPO, ".superpowers", "sdd", "evidence", "crowd");
mkdirSync(OUT, { recursive: true });

const run = createRun("crowd-100");
run.evidence = OUT;
const b = await launchBrowser();
const DSF = args.dsf ? Number(args.dsf) : undefined;
const baseDevice = PHONE_DEV ? (DSF ? { ...PHONE, viewport: { width: 412, height: 915 }, deviceScaleFactor: DSF } : PHONE) : DSF ? { ...DESKTOP, deviceScaleFactor: DSF } : DESKTOP;
const p = await openPlayer(b, run, { tag: "V", device: baseDevice, settings: PHONE_DEV ? { graphics: "low" } : {} });
if (args.lod === "old") await p.ctx.addInitScript(() => (window.__cvLodOff = true)); // DEV switch: no stand-ins, no still-avatar skipping
await joinVillage(p, "Cw");
const session = await cdp(p);
await walkAndWait(p, 0, 14, 25000, 1.5);
await sleep(1500);

// the crowd: a cone in front of the camera, 4..44 m away
await p.page.evaluate(
  async ({ n, walkers }) => {
    const store = await window.__imp("/src/game/remoteStore.ts");
    const { randomAppearance } = await window.__imp("/appearance.ts").catch(() => ({}));
    const playout = await window.__imp("/src/game/playout.ts");
    const t = window.__cvThree();
    const f = new t.camera.position.constructor();
    t.camera.getWorldDirection(f);
    const base = Math.atan2(f.x, f.z);
    const cx = t.camera.position.x;
    const cz = t.camera.position.z;
    let seed = 12345;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const crowd = [];
    for (let i = 0; i < n; i++) {
      const dist = 4 + Math.sqrt(rand()) * 40;
      const ang = base + (rand() - 0.5) * 1.0;
      const x = cx + Math.sin(ang) * dist;
      const z = cz + Math.cos(ang) * dist;
      const id = `crowd${i}`;
      const app = randomAppearance ? randomAppearance(rand) : undefined;
      store.addRemote({ sessionId: id, nickname: `손님${i}`, appearance: app, connected: true, seatIndex: -1, busSeat: -1, rideSeat: -1, rideId: 0, snapshots: [], playout: playout.createPlayout(0) });
      store.receiveRemotePose(id, performance.now(), 0, x, z, rand() * 6.28);
      crowd.push({ id, x, z, walk: rand() < walkers, ph: rand() * 6.28, r: 1.5 + rand() * 2.5, w: 0.3 + rand() * 0.4 });
    }
    const t0 = performance.now();
    window.__crowdTimer = setInterval(() => {
      const s = (performance.now() - t0) / 1000;
      for (const c of crowd) {
        if (!c.walk) continue;
        const a = c.ph + s * c.w;
        store.receiveRemotePose(c.id, performance.now(), 0, c.x + Math.cos(a) * c.r, c.z + Math.sin(a) * c.r, -a + 3.14);
      }
    }, 100);
    window.__crowdN = n;
  },
  { n: N, walkers: Number(args.walkers) },
);
if (args.tags) await p.page.evaluate(async (m) => (await window.__imp("/src/game/labelRegistry.ts")).setNametagMode(m), args.tags);
if (Number(args.bubbles) > 0)
  await p.page.evaluate(async (k) => {
    const { bubbleRegistry } = await window.__imp("/src/game/bubbleRegistry.ts");
    const say = () => {
      for (let i = 0; i < k; i++) bubbleRegistry.set(`crowd${i}`, `안녕하세요 ${i}번 손님이에요! 반가워요`, performance.now());
    };
    say();
    window.__crowdSay = setInterval(say, 3000);
  }, Number(args.bubbles));
await sleep(6000); // let the avatars assemble and the shaders compile

if (THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
await sleep(2000);
const PROFILE = !args["no-profile"]; // the CPU profile itself slows the page: --no-profile for the plain frame numbers
if (PROFILE) {
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 500 });
}
await p.page.evaluate(() => {
  window.__fr = [];
  let last = performance.now();
  const tick = (now) => {
    window.__fr.push(now - last);
    last = now;
    window.__frRaf = requestAnimationFrame(tick);
  };
  window.__frRaf = requestAnimationFrame(tick);
});
if (PROFILE) await session.send("Profiler.start");
// ThreadTime = the main thread's CPU seconds actually used (not wall time): robust to other processes taking the CPU away
await session.send("Performance.enable");
const metric = async () => Object.fromEntries((await session.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
const ovStat = () => p.page.evaluate(() => { const o = window.__cvLabelOverlay; return o ? { ms: o.totalMs, frames: o.totalFrames, drawn: o.totalDrawn } : null; });
const o0 = await ovStat();
const m0 = await metric();
await sleep(MS);
const m1 = await metric();
const o1 = await ovStat();
const overlay = o0 && o1 ? { msPerFrame: Math.round(((o1.ms - o0.ms) / Math.max(1, o1.frames - o0.frames)) * 1000) / 1000, labelsPerFrame: Math.round(((o1.drawn - o0.drawn) / Math.max(1, o1.frames - o0.frames)) * 10) / 10 } : null;
// draw calls per rendered frame: three resets the counters per render() call, so sum them over a few frames by hand
const draws = await p.page.evaluate(
  () =>
    new Promise((resolve) => {
      const { gl } = window.__cvThree();
      const info = gl.info;
      const orig = gl.render.bind(gl);
      let n = 0, calls = 0, tris = 0, max = 0;
      info.autoReset = false;
      gl.render = (s, c) => {
        if (n === 0) info.reset();
        return orig(s, c);
      };
      const tick = () => {
        n++;
        if (n > 10) {
          gl.render = orig;
          info.autoReset = true;
          resolve({ callsPerFrame: info.render.calls / 10, trisPerFrame: Math.round(info.render.triangles / 10) });
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }),
);
const profile = PROFILE ? (await session.send("Profiler.stop")).profile : { nodes: [{ id: 1, callFrame: { functionName: "(root)", url: "", lineNumber: 0 }, children: [] }], samples: [], timeDeltas: [] };
const res = await p.page.evaluate(() => {
  cancelAnimationFrame(window.__frRaf);
  const fr = window.__fr.slice(2).sort((a, b) => a - b);
  const q = (x) => fr[Math.min(fr.length - 1, Math.floor(fr.length * x))];
  const mean = fr.reduce((a, b) => a + b, 0) / fr.length;
  const t = window.__cvThree();
  let skinned = 0, visible = 0, meshes = 0;
  t.scene.traverse((o) => {
    if (o.isMesh) meshes++;
    if (o.isSkinnedMesh) {
      skinned++;
      let v = true;
      for (let q = o; q; q = q.parent) if (!q.visible) v = false;
      if (v) visible++;
    }
  });
  return {
    frames: fr.length, meanMs: mean, fps: 1000 / mean, p50: q(0.5), p95: q(0.95), p99: q(0.99), max: fr[fr.length - 1],
    trimmedMean: fr.slice(0, Math.max(1, fr.length - Math.ceil(fr.length * 0.005))).reduce((a, b) => a + b, 0) / Math.max(1, fr.length - Math.ceil(fr.length * 0.005)),
    over50: fr.filter((x) => x > 50).length, over100: fr.filter((x) => x > 100).length,
    skinned, skinnedVisible: visible, meshes, remotes: window.__crowdN,
    labelsDrawn: window.__cvLabelOverlay?.lastDrawn ?? null,
    nametagCostMs: window.__cv?.getNametagCostMs?.() ?? null,
  };
});

// CPU profile -> self time per group
const nodes = new Map(profile.nodes.map((nd) => [nd.id, nd]));
const self = new Map();
for (let i = 0; i < profile.samples.length; i++) self.set(profile.samples[i], (self.get(profile.samples[i]) ?? 0) + (profile.timeDeltas[i] ?? 0));
const byFn = new Map();
const groups = { mixer: 0, skinning: 0, matrices: 0, render: 0, rafOther: 0, gc: 0, idle: 0, other: 0 };
const GROUP = [
  ["mixer", /AnimationMixer|PropertyMixer|PropertyBinding|KeyframeTrack|_interpolate|interpolate_|evaluate|accumulate|_updateWeight|_updateTimeScale|\bupdate\b.*Action|_update(Weight|TimeScale)|setValue|getValue|\bapply\b/i],
  ["skinning", /Skeleton|\bSkinnedMesh|updateBones|bind|boneMatrices|computeBoundingSphere|computeBoundingBox/],
  ["matrices", /updateMatrixWorld|updateMatrix\b|multiplyMatrices|refreshAvatarMatrices|compose|decompose/],
  ["render", /renderBufferDirect|renderObject|renderObjects|projectObject|setProgram|WebGLRenderer|render\b|uniform|bindTexture|setMaterial|getProgram|draw|WebGLState|WebGLUniforms|setValue(V|Single|M)|useFrame|prepare/i],
  ["gc", /garbage/],
  ["idle", /^\(idle\)|^\(program\)/],
];
let total = 0;
for (const [id, us] of self) {
  const fn = nodes.get(id).callFrame;
  const name = fn.functionName || "(anonymous)";
  const key = `${name} ${fn.url.split("/").pop().split("?")[0]}:${fn.lineNumber}`;
  byFn.set(key, (byFn.get(key) ?? 0) + us);
  total += us;
  const g = GROUP.find(([, re]) => re.test(name))?.[0] ?? "other";
  groups[g] += us;
}
// inclusive time per function (a function's own time plus its callees'), recursion counted once
const parent = new Map();
for (const nd of profile.nodes) for (const c of nd.children ?? []) parent.set(c, nd.id);
const incl = new Map();
for (const [id, us] of self) {
  const seen = new Set();
  for (let cur = id; cur !== undefined; cur = parent.get(cur)) {
    const fn = nodes.get(cur).callFrame;
    const key = `${fn.functionName || "(anonymous)"} ${fn.url.split("/").pop().split("?")[0]}:${fn.lineNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    incl.set(key, (incl.get(key) ?? 0) + us);
  }
}
const frames = res.frames;
const perFrame = (us) => Math.round((us / 1000 / frames) * 100) / 100;
const top = [...byFn].sort((a, c) => c[1] - a[1]).slice(0, 70).map(([k, us]) => `${perFrame(us)} ms/f  ${k}`);
const inclTop = [...incl].sort((a, c) => c[1] - a[1]).slice(0, 45).map(([k, us]) => `${perFrame(us)} ms/f  ${k}`);
const srcIncl = [...incl].filter(([k]) => /\/src\/|\.tsx?:|villageVegetation|programGate|Sky|Water/i.test(k) && !/three\.module|react-dom|react_jsx|\(root\)/.test(k)).sort((a, c) => c[1] - a[1]).slice(0, 40).map(([k, us]) => `${perFrame(us)} ms/f  ${k}`);
const nFrames = res.frames;
const threadMsPerFrame = ((m1.ThreadTime - m0.ThreadTime) * 1000) / nFrames;
const out = {
  threadMsPerFrame: Math.round(threadMsPerFrame * 100) / 100,
  perFrameMs: Object.fromEntries(['ScriptDuration','LayoutDuration','RecalcStyleDuration','TaskDuration','ThreadTime'].map((k) => [k, Math.round(((m1[k] - m0[k]) * 1000 / nFrames) * 100) / 100])),
  taskMsPerFrame: Math.round(((m1.TaskDuration - m0.TaskDuration) * 1000 / nFrames) * 100) / 100,
  device: args.device, lod: args.lod, n: N, throttle: THROTTLE, label: args.label, dsf: DSF ?? null, tags: args.tags ?? "nearby", bubbles: Number(args.bubbles),
  overlay,
  draws,
  ...Object.fromEntries(Object.entries(res).map(([k, v]) => [k, typeof v === "number" ? Math.round(v * 100) / 100 : v])),
  cpuMsPerFrame: Object.fromEntries(Object.entries(groups).map(([k, us]) => [k, perFrame(us)])),
  cpuTotalMsPerFrame: perFrame(total),
  top,
  inclTop,
  srcIncl,
};
console.log(JSON.stringify(out, null, 1));
writeFileSync(join(OUT, `crowd-${args.device}-${args.label}.json`), JSON.stringify(out, null, 2));
if (PROFILE) writeFileSync(join(OUT, `crowd-${args.device}-${args.label}.cpuprofile`), JSON.stringify(profile)); // open in DevTools › Performance
await p.page.screenshot({ path: join(OUT, `crowd-${args.device}-${args.label}.png`) }).catch(() => {});
await p.page.evaluate(() => (clearInterval(window.__crowdTimer), clearInterval(window.__crowdSay)));
const code = run.finish();
await b.close();
process.exit(code);
