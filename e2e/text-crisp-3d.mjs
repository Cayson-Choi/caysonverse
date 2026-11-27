/**
 * e2e/text-crisp-3d.mjs — how crisp the text that is part of the 3D scene comes out (fix/pine-text, owner 2026-11-27: the
 * phone draws the scene at dpr 1, the name tags moved to the full-DPR overlay in fix/crisp-labels; the scene's own text —
 * the memorial cubbies' name plates, the hall's zone signs and museum label, the houses' number plates, the gate's welcome
 * board, the plot signs — was still soft).
 *
 *   CV_CLIENT_URL=http://localhost:5621 node e2e/text-crisp-3d.mjs --device phone3|pc1|pc2 --label before|after [--out <dir>]
 *
 * Each item is shot from a pinned camera (the same eye before and after): straight on at a usual standing distance, and
 * 45 degrees off (where the texture filtering shows). The cubby's name plate also in the real cubby card's close view.
 * Saves <out>/<device>-<label>-<item>-<view>.png (a crop round the text, native device pixels) and the full frames, and
 * <out>/<device>-<label>.json with the canvas textures' GPU bytes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { enterHall, joinVillage, NOON } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "phone3" },
    label: { type: "string", default: "run" },
    out: { type: "string", default: "D:/ClaudeCode/tmpshots/pinetext/text" },
  },
});
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const DEVICES = {
  phone3: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  pc1: { ...DESKTOP, deviceScaleFactor: 1 },
  pc2: { ...DESKTOP, deviceScaleFactor: 2 },
};
const device = DEVICES[args.device];
if (!device) throw new Error(`unknown device ${args.device}`);
const OUT = args.out;
mkdirSync(OUT, { recursive: true });
const stem = `${args.device}-${args.label}`;

const run = createRun("text-crisp-3d");
run.evidence = OUT;
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "T", device });
const page = p.page;
const report = { device: args.device, label: args.label, items: [], textures: null };

const hideHud = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    window.__hidden = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el) || el.tagName === "CANVAS") continue;
      if (el.style.visibility !== "hidden") {
        window.__hidden.push(el);
        el.style.visibility = "hidden";
      }
    }
  });
const showHud = () => page.evaluate(() => (window.__hidden ?? []).forEach((el) => (el.style.visibility = "")));

/** Pin the camera at eye, looking at target (null: let the game's camera go again). */
const pin = (pose) =>
  page.evaluate((pose) => {
    const { scene, camera } = window.__cvThree();
    if (!pose) {
      if (window.__pinOld !== undefined) scene.onBeforeRender = window.__pinOld;
      window.__pinOld = undefined;
      return;
    }
    if (window.__pinOld === undefined) window.__pinOld = scene.onBeforeRender;
    window.__pin = pose;
    scene.onBeforeRender = () => {
      const { eye, target } = window.__pin;
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateMatrixWorld(true);
    };
  }, pose);

/**
 * The quad of an item in the world: { c, n, corners } — `find` is evaluated in the page and returns
 * { c: [x,y,z], n: [x,y,z], corners: [[x,y,z] x4] } or null.
 */
async function quadOf(findSrc) {
  return page.evaluate(`(${findSrc})()`);
}

/** Crop rect (CSS px) round the projected corners, grown by `pad` of its size (at least 24 px). */
const cropOf = (corners, pad = 0.35) =>
  page.evaluate(
    ({ corners, pad }) => {
      const { camera } = window.__cvThree();
      const V = camera.position.constructor;
      const r = document.querySelector("canvas").getBoundingClientRect();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const c of corners) {
        const v = new V(c[0], c[1], c[2]).project(camera);
        const x = r.left + (v.x * 0.5 + 0.5) * r.width;
        const y = r.top + (0.5 - v.y * 0.5) * r.height;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      const gx = Math.max(24, (x1 - x0) * pad);
      const gy = Math.max(24, (y1 - y0) * pad);
      const X0 = Math.max(0, Math.floor(x0 - gx)), Y0 = Math.max(0, Math.floor(y0 - gy));
      const X1 = Math.min(innerWidth, Math.ceil(x1 + gx)), Y1 = Math.min(innerHeight, Math.ceil(y1 + gy));
      return { x: X0, y: Y0, width: Math.max(8, X1 - X0), height: Math.max(8, Y1 - Y0), textPx: Math.round(y1 - y0) };
    },
    { corners, pad },
  );

async function shootItem(name, q, dist, { eyeY = null, angles = [0, 45] } = {}) {
  if (!q) {
    console.log(`skip ${name}: not found`);
    report.items.push({ name, found: false });
    return;
  }
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    // the normal turned by `deg` about y
    const nx = q.n[0] * Math.cos(a) + q.n[2] * Math.sin(a);
    const nz = -q.n[0] * Math.sin(a) + q.n[2] * Math.cos(a);
    const eye = [q.c[0] + nx * dist, eyeY ?? q.c[1], q.c[2] + nz * dist];
    await pin({ eye, target: q.c });
    await sleep(1800);
    await hideHud();
    const clip = await cropOf(q.corners);
    const file = `${stem}-${name}-${deg}.png`;
    await page.screenshot({ path: join(OUT, file), clip });
    if (deg === 0) await page.screenshot({ path: join(OUT, `${stem}-${name}-full.png`) });
    await showHud();
    report.items.push({ name, deg, dist, file, clip, textCssPx: clip.textPx });
    console.log(name, deg, JSON.stringify(clip));
  }
  await pin(null);
}

/** Canvas-textures' GPU bytes (2D-canvas maps on scene materials: w*h*4, x4/3 with mipmaps), grouped by material name. */
const canvasBytes = () =>
  page.evaluate(() => {
    const { scene } = window.__cvThree();
    const seen = new Map();
    scene.traverse((o) => {
      const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of ms) {
        const t = m.map;
        const img = t?.image;
        if (!img || !(img instanceof HTMLCanvasElement)) continue;
        if (seen.has(t.uuid)) continue;
        const mip = t.generateMipmaps && t.minFilter !== 1006 && t.minFilter !== 1003;
        seen.set(t.uuid, { mat: m.name || o.name || o.type, w: img.width, h: img.height, bytes: Math.round(img.width * img.height * 4 * (mip ? 4 / 3 : 1)), aniso: t.anisotropy, mip });
      }
    });
    const by = {};
    for (const v of seen.values()) {
      const k = v.mat.replace(/_[A-Z0-9]$/, "").replace(/__.*$/, "");
      by[k] ??= { n: 0, bytes: 0, sample: `${v.w}x${v.h} aniso ${v.aniso} mip ${v.mip}` };
      by[k].n++;
      by[k].bytes += v.bytes;
    }
    return by;
  });

try {
  await joinVillage(p, "Tx", NOON);
  // ── outside: the houses' number plates, the gate's welcome board, any plot sign ──
  await sleep(4000);
  const house = await quadOf(`async () => {
    const { VILLAGE_LAYOUT } = await window.__imp("/village/villageLayout.ts");
    const { houseSlots } = await window.__imp("/village/houseExterior.ts");
    const h = VILLAGE_LAYOUT.sceneryHouses.find((x) => x.kind === "house");
    const s = houseSlots(h).find((x) => x.kind === "nameplate");
    const n = [Math.sin(s.yaw), 0, Math.cos(s.yaw)];
    const r = [Math.cos(s.yaw), 0, -Math.sin(s.yaw)];
    const hw = 0.21, hh = 0.08;
    const corners = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a, b]) => [s.x + r[0] * a * hw, s.y + b * hh, s.z + r[2] * a * hw]);
    return { c: [s.x, s.y, s.z], n, corners, id: h.id };
  }`);
  const objQuad = (namePattern) => `() => {
    const { scene } = window.__cvThree();
    let hit = null;
    scene.traverse((o) => { if (!hit && ${namePattern}.test(o.name) && o.visible !== false) hit = o; });
    if (!hit) return null;
    hit.updateWorldMatrix(true, true);
    const V = hit.position.constructor;
    // local bounds of the object (with its children), via its geometry or children's
    let mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
    const inv = hit.matrixWorld.clone().invert();
    hit.traverse((c) => {
      const g = c.geometry; if (!g) return;
      g.computeBoundingBox();
      const bb = g.boundingBox;
      for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) {
        const v = new V(x, y, z).applyMatrix4(c.matrixWorld).applyMatrix4(inv);
        mn = [Math.min(mn[0], v.x), Math.min(mn[1], v.y), Math.min(mn[2], v.z)];
        mx = [Math.max(mx[0], v.x), Math.max(mx[1], v.y), Math.max(mx[2], v.z)];
      }
    });
    const zf = mx[2];
    const corners = [[mn[0], mn[1]], [mx[0], mn[1]], [mx[0], mx[1]], [mn[0], mx[1]]].map(([x, y]) => new V(x, y, zf).applyMatrix4(hit.matrixWorld).toArray());
    const c = new V((mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, zf).applyMatrix4(hit.matrixWorld);
    const n = new V(0, 0, 1).transformDirection(hit.matrixWorld);
    return { c: c.toArray(), n: [n.x, 0, n.z], corners, name: hit.name };
  }`;
  if (house) {
    // stand a few metres in front of the plate (the houses load their near detail round the player)
    const sp = [house.c[0] + house.n[0] * 4, house.c[2] + house.n[2] * 4];
    await walkAndWait(p, sp[0], sp[1], 40000, 1.5);
    await sleep(2500);
    await shootItem("house-plate", house, 3, { eyeY: 1.6 });
  }
  const plot = await quadOf(objQuad("/^plot_sign__/"));
  await shootItem("plot-sign", plot, 4, { eyeY: 1.6 });
  const gate = await quadOf(objQuad("/^gate_board_panel$/"));
  await shootItem("gate-board", gate, 6, { eyeY: 1.6 });

  // ── the memorial hall ──
  await enterHall(p);
  await page.waitForFunction(async () => (await window.__imp("/src/village/memorial/claimsStore.ts")).claimsSnapshot().status === "ready", null, { timeout: 15000 }).catch(() => {});
  await sleep(2000);
  const zone = await quadOf(objQuad("/^zone_sign_A$/"));
  await shootItem("zone-sign", zone, 3.5, { eyeY: 1.6 });
  const label = await quadOf(objQuad("/^lounge_painting_label$/"));
  await shootItem("museum-label", label, 1.4, { eyeY: 1.6 });
  // the name plate: the sample cubby's (its plate is a 6.2 x 1.35 cm plane under the photo)
  const sample = await page.evaluate(async () => {
    const { SAMPLE_CUBBIES } = await window.__imp("/src/village/sampleCubbies.ts");
    return SAMPLE_CUBBIES[0]?.id ?? null;
  });
  const plateFind = `() => {
    const { scene } = window.__cvThree();
    let hit = null;
    scene.traverse((o) => { if (!hit && o.isMesh && o.geometry?.parameters?.width === 0.062) hit = o; });
    if (!hit) return null;
    hit.updateWorldMatrix(true, false);
    const V = hit.position.constructor;
    const corners = [[-0.031, -0.00675], [0.031, -0.00675], [0.031, 0.00675], [-0.031, 0.00675]].map(([x, y]) => new V(x, y, 0).applyMatrix4(hit.matrixWorld).toArray());
    const c = new V(0, 0, 0).applyMatrix4(hit.matrixWorld);
    const n = new V(0, 0, 1).transformDirection(hit.matrixWorld);
    return { c: c.toArray(), n: [n.x, 0, n.z], corners };
  }`;
  const plate = await quadOf(plateFind);
  console.log("sample", sample, plate ? "plate found" : "no plate");
  await shootItem("name-plate", plate, 0.9, { angles: [0, 35] });
  // the real close view (the cubby card)
  if (sample) {
    const m = /^M1-([A-Z])-r(\d+)-c(\d+)$/.exec(sample);
    if (m) {
      await page.evaluate(async (s) => (await window.__imp("/src/village/cubbyCard.ts")).openCubbyAt(s), { bank: m[1], row: Number(m[2]), col: Number(m[3]) });
      await page.locator(".cv-cubby").waitFor({ timeout: 8000 }).catch(() => {});
      await sleep(3000);
      const q = await quadOf(plateFind);
      if (q) {
        await page.screenshot({ path: join(OUT, `${stem}-name-plate-card-full.png`) });
        await hideHud();
        const clip = await cropOf(q.corners, 0.6);
        await page.screenshot({ path: join(OUT, `${stem}-name-plate-card.png`), clip });
        await showHud();
        report.items.push({ name: "name-plate-card", file: `${stem}-name-plate-card.png`, clip, textCssPx: clip.textPx });
        console.log("name-plate-card", JSON.stringify(clip));
      }
    }
  }
  report.textures = { hall: await canvasBytes() };
} finally {
  writeFileSync(join(OUT, `${stem}.json`), JSON.stringify(report, null, 2));
  await b.close();
}
process.exit(run.finish());
