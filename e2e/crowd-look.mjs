/**
 * e2e/crowd-look.mjs — what the far-avatar stand-ins look like next to the full avatars (perf/crowd visual check).
 *   CV_CLIENT_URL=http://localhost:5951 node e2e/crowd-look.mjs --device pc|phone [--out <dir>]
 * Writes into <out> (default .superpowers/sdd/evidence/crowd-look):
 *   <dev>-wide.png        100 avatars in view (the default full / stand-in split)
 *   <dev>-pair-15m.png    the same look at 15 m: full avatar (left) and stand-in (right), cropped and enlarged
 *   <dev>-pair-25m.png    the same at 25 m
 *   <dev>-seq.png         4 frames of one walking avatar: full, full, then pinned to the stand-in, stand-in (the swap)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const { values: args } = parseArgs({ options: { device: { type: "string", default: "pc" }, out: { type: "string" } } });
const phone = args.device === "phone";
const OUT = args.out ?? join(REPO, ".superpowers", "sdd", "evidence", "crowd-look");
mkdirSync(OUT, { recursive: true });
const run = createRun("crowd-look");
run.evidence = OUT;
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "V", device: phone ? PHONE : DESKTOP, settings: phone ? { graphics: "low" } : {} });
await joinVillage(p, "Lk");
await walkAndWait(p, 0, 14, 25000, 1.5);
await sleep(1000);

const page = p.page;
// helpers in the page
await page.evaluate(() => {
  window.__stage = async (list) => {
    // list: [{id, d, side, look, walk}] -> avatars d metres ahead of the camera, side metres to the right
    const store = await window.__imp("/src/game/remoteStore.ts");
    const playout = await window.__imp("/src/game/playout.ts");
    const { randomAppearance } = await window.__imp("/appearance.ts");
    const t = window.__cvThree();
    const f = new t.camera.position.constructor();
    t.camera.getWorldDirection(f);
    f.y = 0;
    f.normalize();
    const rx = -f.z, rz = f.x; // right of forward
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const app = randomAppearance(rand);
    window.__stageAv = list.map((e) => {
      const x = t.camera.position.x + f.x * e.d + rx * e.side;
      const z = t.camera.position.z + f.z * e.d + rz * e.side;
      store.addRemote({ sessionId: e.id, nickname: e.id, appearance: app, connected: true, seatIndex: -1, busSeat: -1, rideSeat: -1, rideId: 0, snapshots: [], playout: playout.createPlayout(0) });
      store.receiveRemotePose(e.id, performance.now(), 0, x, z, Math.PI + Math.atan2(f.x, f.z));
      return { ...e, x, z };
    });
    window.__stageStore = store;
  };
  window.__screenOf = (x, z) => {
    const t = window.__cvThree();
    const cam = t.camera;
    const proj = (y) => {
      const v = new cam.position.constructor(x, y, z).project(cam);
      return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
    };
    return { feet: proj(0), head: proj(1.9) };
  };
  window.__clear = () => {
    const s = window.__stageStore;
    for (const e of window.__stageAv ?? []) s.removeRemote(e.id);
    window.__stageAv = [];
  };
});

/** Crop the screen around a world point (an avatar), enlarged by CSS in the montage. */
async function crop(x, z, file) {
  const s = await page.evaluate(([x, z]) => window.__screenOf(x, z), [x, z]);
  const h = Math.max(30, s.feet.y - s.head.y);
  const w = h * 1.0;
  const clip = { x: Math.max(0, s.feet.x - w / 2), y: Math.max(0, s.head.y - h * 0.15), width: w, height: h * 1.3 };
  await page.screenshot({ path: join(OUT, file), clip });
  return { file, h: Math.round(h) };
}
async function montage(files, out, scale = 4) {
  const imgs = [];
  const fs = await import("node:fs");
  for (const f of files) imgs.push("data:image/png;base64," + fs.readFileSync(join(OUT, f)).toString("base64"));
  const pg = await page.context().newPage();
  await pg.setContent(`<body style="margin:0;background:#888;display:flex;gap:8px;align-items:flex-start">${imgs
    .map((s) => `<img src="${s}" style="image-rendering:pixelated;height:300px;width:auto">`)
    .join("")}</body>`);
  await pg.setViewportSize({ width: 1600, height: 320 });
  await pg.screenshot({ path: join(OUT, out) });
  await pg.close();
}

// (a) wide view with 100
await page.evaluate(async () => {
  const store = await window.__imp("/src/game/remoteStore.ts");
  const playout = await window.__imp("/src/game/playout.ts");
  const { randomAppearance } = await window.__imp("/appearance.ts");
  const t = window.__cvThree();
  const f = new t.camera.position.constructor();
  t.camera.getWorldDirection(f);
  const base = Math.atan2(f.x, f.z);
  let seed = 99;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < 100; i++) {
    const d = 4 + Math.sqrt(rand()) * 40, a = base + (rand() - 0.5) * 1.0;
    store.addRemote({ sessionId: `w${i}`, nickname: `손님${i}`, appearance: randomAppearance(rand), connected: true, seatIndex: -1, busSeat: -1, rideSeat: -1, rideId: 0, snapshots: [], playout: playout.createPlayout(0) });
    store.receiveRemotePose(`w${i}`, performance.now(), 0, t.camera.position.x + Math.sin(a) * d, t.camera.position.z + Math.cos(a) * d, rand() * 6.28);
  }
  window.__wide = Array.from({ length: 100 }, (_, i) => `w${i}`);
});
await sleep(7000);
await page.screenshot({ path: join(OUT, `${args.device}-wide.png`) });
await page.evaluate(() => {
  const s = window.__imp("/src/game/remoteStore.ts");
  return s.then((m) => window.__wide.forEach((id) => m.removeRemote(id)));
});
await sleep(1500);

// (b) pairs at 15 m and 25 m: full (left) and stand-in (right), same look
for (const d of [15, 25]) {
  await page.evaluate(
    async (d) => {
      await window.__stage([
        { id: `full${d}`, d, side: -1.2 },
        { id: `imp${d}`, d, side: 1.2 },
      ]);
      window.__cvAvatarForce = { ...(window.__cvAvatarForce ?? {}), [`full${d}`]: "full", [`imp${d}`]: "imp" };
    },
    d,
  );
  await sleep(2500);
  const av = await page.evaluate(() => window.__stageAv);
  const a = await crop(av[0].x, av[0].z, `_${args.device}-${d}-full.png`);
  const c = await crop(av[1].x, av[1].z, `_${args.device}-${d}-imp.png`);
  run.check(`${d} m: avatar ${a.h}px tall on screen`, true, { full: a, imp: c });
  await montage([a.file, c.file], `${args.device}-pair-${d}m.png`);
  await page.evaluate(() => window.__clear());
}

// (c) the swap on one walker at 20 m: full, full, stand-in, stand-in
await page.evaluate(async () => {
  await window.__stage([{ id: "walker", d: 20, side: 0 }]);
  window.__cvAvatarForce = { walker: "full" };
  const s = window.__stageStore;
  const e = window.__stageAv[0];
  const t0 = performance.now();
  window.__walkTimer = setInterval(() => {
    const k = (performance.now() - t0) / 1000;
    s.receiveRemotePose("walker", performance.now(), 0, e.x + Math.sin(k * 0.5) * 1.5, e.z, Math.PI / 2 * Math.sign(Math.cos(k * 0.5)));
  }, 100);
});
await sleep(2500);
const frames = [];
for (const mode of ["full", "full", "imp", "imp"]) {
  await page.evaluate((m) => (window.__cvAvatarForce.walker = m), mode);
  await sleep(mode === "full" && frames.length === 0 ? 300 : 60);
  const pos = await page.evaluate(() => {
    const d = window.__cvThree(); // the walker's current drawn spot: from the DEV probe
    return window.__cv.getRemoteDrawn().walker;
  });
  const f = await crop(pos.x, pos.z, `_${args.device}-seq${frames.length}.png`);
  frames.push(f.file);
}
await montage(frames, `${args.device}-seq.png`);
await page.evaluate(() => clearInterval(window.__walkTimer));
const code = run.finish();
await b.close();
process.exit(code);
