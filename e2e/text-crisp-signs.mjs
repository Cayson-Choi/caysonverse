/**
 * e2e/text-crisp-signs.mjs — the scene's signs drawn crisp on the label overlay (fix/text-crisp2, owner 2026-11-28: the houses'
 * number plates, the zone signs, the gate's welcome board, the lake's finger posts and the park's shop signs were still soft on a
 * phone). The ink layer (client/src/game/inkLayer.ts) draws a sign's lettering at the device's pixel ratio where the scene is drawn
 * at fewer pixels; `window.__cvInkOff` turns it off (the signs as WebGL alone draws them: "before").
 *
 *   CV_CLIENT_URL=http://localhost:5624 node e2e/text-crisp-signs.mjs --device phone3|pc1 [--time noon|night] [--out <dir>] [--no-park]
 *
 * fix/text-crisp3 adds: the sweep checks (an opaque box moving across a sign at a car's speed, and the eye walking past a box standing
 * in front of a sign): on no frame may the overlay's letters show over the box; and the fallback check (a browser whose WebGL2 has
 * no occlusion queries): the layer stays off, the signs keep their own lettering, no error.
 *
 * Each sign from a pinned camera (straight on, 45 degrees off), shot with the ink layer off and on (the same frame pose):
 * <out>/<device>-<item>-<deg>-before.png / -after.png (crops round the sign, device px), and <out>/<device>-sheet.png (all of them
 * side by side). The occlusion check: an opaque box put between the eye and a sign (whole, then half of it) must take the sign's
 * lettering off the overlay there. Asserts: on a phone the layer is active and draws the signs; on a PC at dpr 1 it stays off.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, enterHall, joinVillage, leaveHall, NOON } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "phone3" },
    out: { type: "string", default: "D:/ClaudeCode/tmpshots/text3" },
    time: { type: "string", default: "noon" },
    "no-park": { type: "boolean", default: false },
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
const TIMES = { noon: NOON, night: "2026-11-03T21:30" };
if (!TIMES[args.time]) throw new Error(`unknown time ${args.time}`);
const D = args.time === "noon" ? args.device : `${args.device}-${args.time}`;
const phone = args.device === "phone3";

const run = createRun(`text-crisp-signs-${D}`);
run.evidence = OUT;
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "T", device });
const page = p.page;
const shots = [];
const report = { device: D, items: [], occlusion: null, stats: null };

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
const inkOff = (off) => page.evaluate((off) => (window.__cvInkOff = off), off);
const inkStats = () => page.evaluate(() => ({ ...(window.__cvLabelOverlay?.ink?.stats ?? {}) }));

/** Pin the camera at eye looking at target (null: the game's camera again). */
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
      window.__anim?.(performance.now());
      const { eye, target } = window.__pin;
      camera.position.set(eye[0], eye[1], eye[2]);
      camera.up.set(0, 1, 0);
      camera.lookAt(target[0], target[1], target[2]);
      camera.updateMatrixWorld(true);
    };
  }, pose);

/**
 * The quads of the ink anchors named `name` (their w x h from the ink registry): [{ c, n, corners }], nearest to (x, z) first when
 * given. Read in the page from the ink layer's own registry, so it is the plane the overlay draws on.
 */
const anchors = (namePattern, near = null) =>
  page.evaluate(
    async ({ src, near }) => {
      const re = new RegExp(src);
      const { inkLabels } = await window.__imp("/src/game/inkLabels.ts");
      const out = [];
      for (const l of inkLabels()) {
        if (!re.test(l.object.name)) continue;
        const o = l.object;
        o.updateWorldMatrix(true, false);
        const V = o.position.constructor;
        const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b2]) => new V((a * l.w) / 2, (b2 * l.h) / 2, 0).applyMatrix4(o.matrixWorld).toArray());
        const c = new V(0, 0, 0).applyMatrix4(o.matrixWorld);
        const n = new V(0, 0, 1).transformDirection(o.matrixWorld);
        out.push({ name: o.name, c: c.toArray(), n: [n.x, n.y, n.z], corners, w: l.w, h: l.h });
      }
      if (near) out.sort((a, b) => Math.hypot(a.c[0] - near[0], a.c[2] - near[1]) - Math.hypot(b.c[0] - near[0], b.c[2] - near[1]));
      return out;
    },
    { src: namePattern, near },
  );

/** Crop rect (CSS px) round the projected corners, grown by `pad` of its size (at least 20 px). */
const cropOf = (corners, pad = 0.3) =>
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
      const gx = Math.max(20, (x1 - x0) * pad);
      const gy = Math.max(20, (y1 - y0) * pad);
      const X0 = Math.max(0, Math.floor(x0 - gx)), Y0 = Math.max(0, Math.floor(y0 - gy));
      const X1 = Math.min(innerWidth, Math.ceil(x1 + gx)), Y1 = Math.min(innerHeight, Math.ceil(y1 + gy));
      return { x: X0, y: Y0, width: Math.max(8, X1 - X0), height: Math.max(8, Y1 - Y0), signPx: [Math.round(x1 - x0), Math.round(y1 - y0)] };
    },
    { corners, pad },
  );

/** Opaque overlay pixels (alpha > 128) inside a CSS rect of the label overlay. */
const overlayInk = (rect) =>
  page.evaluate((rect) => {
    const o = document.querySelector(".cv-label-overlay");
    if (!o) return -1;
    const k = o.width / o.getBoundingClientRect().width;
    const x = Math.max(0, Math.floor(rect.x * k));
    const y = Math.max(0, Math.floor(rect.y * k));
    const w = Math.max(1, Math.min(o.width - x, Math.floor(rect.width * k)));
    const h = Math.max(1, Math.min(o.height - y, Math.floor(rect.height * k)));
    // a copy to read from (reading the overlay itself would make the browser warn about repeated read-backs)
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d", { willReadFrequently: true });
    g.drawImage(o, x, y, w, h, 0, 0, w, h);
    const d = g.getImageData(0, 0, w, h).data;
    let n = 0;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 128) n++;
    return n;
  }, rect);

async function shoot(item, q, dist, { eyeY = null, angles = [0, 45] } = {}) {
  if (!q) {
    console.log(`skip ${item}: not found`);
    report.items.push({ item, found: false });
    return;
  }
  for (const deg of angles) {
    const a = (deg * Math.PI) / 180;
    const nx = q.n[0] * Math.cos(a) + q.n[2] * Math.sin(a);
    const nz = -q.n[0] * Math.sin(a) + q.n[2] * Math.cos(a);
    const eye = [q.c[0] + nx * dist, eyeY ?? q.c[1], q.c[2] + nz * dist];
    await pin({ eye, target: q.c });
    await sleep(600); // the pinned eye takes effect on the next frame: crop from it
    await hideHud();
    const clip = await cropOf(q.corners);
    const row = { item, deg, dist, clip };
    for (const label of ["before", "after"]) {
      await inkOff(label === "before");
      await sleep(1500);
      const file = `${D}-${item}-${deg}-${label}.png`;
      await page.screenshot({ path: join(OUT, file), clip });
      if (deg === 0) await page.screenshot({ path: join(OUT, `${D}-${item}-full-${label}.png`) });
      row[label] = file;
      row[`${label}Ink`] = await overlayInk(clip);
      row[`${label}Stats`] = await inkStats();
    }
    await showHud();
    report.items.push(row);
    shots.push(row);
    console.log(item, deg, JSON.stringify({ signPx: clip.signPx, beforeInk: row.beforeInk, afterInk: row.afterInk, drawn: row.afterStats.drawn, active: row.afterStats.active }));
  }
  await inkOff(false);
  await pin(null);
}

/** An opaque box between the eye and the sign covering `share` of it from the left (1 = all); returns the overlay's ink there. */
async function occlusionCheck(item, q, dist) {
  if (!q) return null;
  const eye = [q.c[0] + q.n[0] * dist, q.c[1], q.c[2] + q.n[2] * dist];
  await pin({ eye, target: q.c });
  await sleep(600);
  await hideHud();
  const clip = await cropOf(q.corners, 0.1);
  const res = { item, clip };
  for (const share of [0, 0.5, 1]) {
    await page.evaluate(
      async ({ q, share }) => {
        const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
        const { scene } = window.__cvThree();
        window.__occ?.removeFromParent();
        window.__occ = null;
        if (share === 0) return;
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.02), new THREE.MeshBasicMaterial({ color: 0x884422 }));
        // half a metre in front of the sign, facing it; `share` of the sign's width from its left edge (seen from the front)
        const n = new THREE.Vector3(...q.n);
        const right = new THREE.Vector3(0, 1, 0).cross(n).normalize();
        const w = q.w * share + 0.02;
        m.scale.set(w, q.h * 1.4, 1);
        const c = new THREE.Vector3(...q.c).addScaledVector(n, 0.5).addScaledVector(right, -q.w / 2 + w / 2 - 0.01);
        m.position.copy(c);
        m.lookAt(c.clone().add(n));
        m.name = "e2e_occluder";
        scene.add(m);
        window.__occ = m;
      },
      { q, share },
    );
    await sleep(1200);
    const file = `${D}-occlusion-${item}-${Math.round(share * 100)}.png`;
    await page.screenshot({ path: join(OUT, file), clip });
    res[`ink${Math.round(share * 100)}`] = await overlayInk(clip);
    res[`file${Math.round(share * 100)}`] = file;
    res[`drawn${Math.round(share * 100)}`] = (await inkStats()).drawn;
    shots.push({ item: `occlusion-${item}`, deg: Math.round(share * 100), clip, after: file, before: null });
  }
  await page.evaluate(() => {
    window.__occ?.removeFromParent();
    window.__occ = null;
  });
  await showHud();
  await pin(null);
  console.log("occlusion", JSON.stringify(res));
  return res;
}

/**
 * Something sweeping in front of a sign: `mode` "car" — an opaque box (the sign's height x 1.4, half its width) crossing it 0.5 m in
 * front at `speed` m/s, the eye still; "walk" — the box standing still 1 m in front, the eye walking sideways past at `speed` m/s.
 * Every frame (right after the overlay is drawn, with that frame's camera) the overlay's opaque pixels inside the box's outline (2 px
 * in) are counted; returns the frames with more than 12 of them, and the worst.
 */
async function sweepCheck(item, q, dist, mode, speed) {
  if (!q) return null;
  const eye = [q.c[0] + q.n[0] * dist, q.c[1], q.c[2] + q.n[2] * dist];
  await pin({ eye, target: q.c });
  await sleep(800);
  await hideHud();
  const res = await page.evaluate(
    async ({ q, dist, mode, speed }) => {
      const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
      const { scene, camera } = window.__cvThree();
      const n = new THREE.Vector3(...q.n);
      const right = new THREE.Vector3(0, 1, 0).cross(n).normalize();
      const bw = q.w * 0.5;
      const box = new THREE.Mesh(new THREE.BoxGeometry(bw, q.h * 1.4, 0.05), new THREE.MeshBasicMaterial({ color: 0x884422 }));
      box.name = "e2e_sweeper";
      const front = mode === "car" ? 0.5 : 1;
      const base = new THREE.Vector3(...q.c).addScaledVector(n, front);
      box.lookAt(box.position.clone().add(n));
      scene.add(box);
      const span = q.w + bw + 1; // from fully off one side to fully off the other
      const t0 = performance.now();
      const dur = (span / speed) * 1000;
      const eye0 = new THREE.Vector3(...window.__pin.eye);
      // the eye walking: the box's shadow on the sign moves (dist / (dist - front)) as fast as the eye does
      const k = mode === "walk" ? dist / Math.max(0.1, dist - front) : 1;
      window.__anim = (now) => {
        const u = Math.min(1, (now - t0) / dur) * span - span / 2;
        if (mode === "car") box.position.copy(base).addScaledVector(right, u);
        else {
          box.position.copy(base);
          const e = eye0.clone().addScaledVector(right, -u / k);
          window.__pin.eye = e.toArray();
          window.__pin.target = new THREE.Vector3(...q.c).addScaledVector(right, -u / k).toArray();
        }
        box.updateMatrixWorld(true);
      };
      const o = window.__cvLabelOverlay;
      const oc = document.querySelector(".cv-label-overlay");
      const copy = document.createElement("canvas");
      const cg = copy.getContext("2d", { willReadFrequently: true });
      const corners = [];
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push(new THREE.Vector3((sx * bw) / 2, (sy * q.h * 1.4) / 2, 0.025));
      const frames = [];
      const orig = o.draw.bind(o);
      o.draw = (...a) => {
        const r = orig(...a);
        if (performance.now() - t0 > dur + 100) return r;
        // the box's outline on the overlay this frame
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        for (const c of corners) {
          const v = c.clone().applyMatrix4(box.matrixWorld).project(camera);
          const x = (v.x * 0.5 + 0.5) * oc.width;
          const y = (0.5 - v.y * 0.5) * oc.height;
          x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        }
        x0 = Math.max(0, Math.ceil(x0 + 2)); y0 = Math.max(0, Math.ceil(y0 + 2));
        x1 = Math.min(oc.width, Math.floor(x1 - 2)); y1 = Math.min(oc.height, Math.floor(y1 - 2));
        let ink = 0;
        if (x1 > x0 && y1 > y0) {
          copy.width = x1 - x0;
          copy.height = y1 - y0;
          cg.drawImage(oc, x0, y0, x1 - x0, y1 - y0, 0, 0, x1 - x0, y1 - y0);
          const d = cg.getImageData(0, 0, x1 - x0, y1 - y0).data;
          for (let i = 3; i < d.length; i += 4) if (d[i] > 128) ink++;
        }
        frames.push({ ink, drawn: o.ink?.stats.drawn ?? 0 });
        return r;
      };
      await new Promise((r) => setTimeout(r, dur + 400));
      o.draw = orig;
      window.__anim = null;
      box.removeFromParent();
      box.geometry.dispose();
      box.material.dispose();
      const bad = frames.filter((f) => f.ink > 12);
      return { frames: frames.length, bad: bad.length, worst: Math.max(0, ...frames.map((f) => f.ink)), drawnFrames: frames.filter((f) => f.drawn > 0).length };
    },
    { q, dist, mode, speed },
  );
  await showHud();
  await pin(null);
  const out = { item, mode, speed, ...res };
  console.log("sweep", JSON.stringify(out));
  return out;
}

/** Walk to the park's gate and through it (the shops are in 케이슨랜드). */
async function enterPark() {
  const area = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
  const g = await page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  const goTo = async (x, z) => {
    await page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const me = window.__cv.getPos();
      const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(400);
    for (let i = 0; i < 480; i++) {
      if ((await page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) break;
      await sleep(250);
    }
  };
  for (let attempt = 0; attempt < 4; attempt++) {
    await goTo(g.x, g.z - 0.5);
    const at = await page.evaluate(() => window.__cv.getPos());
    if (Math.hypot(at.x - g.x, at.z - (g.z - 0.5)) < 1.2) break;
  }
  for (let i = 0; i < 3 && (await area()) !== "park"; i++) {
    await act(p);
    await sleep(5000);
  }
  await sleep(6000);
  return (await area()) === "park";
}

/** All shots side by side (before | after), one row each, into <out>/<device>-sheet.png. */
async function sheet() {
  const rows = shots
    .map((s) => {
      const img = (f) => (f ? `<img src="data:image/png;base64,${readFileSync(join(OUT, f)).toString("base64")}">` : "<div class=none>—</div>");
      return `<div class=row><div class=cap>${s.item} ${s.deg}${s.item.startsWith("occlusion") ? "% covered" : "°"}</div><div class=pair>${s.before ? img(s.before) : ""}${img(s.after)}</div></div>`;
    })
    .join("");
  const sp = await b.newPage({ viewport: { width: 1400, height: 800 } });
  await sp.setContent(
    `<html><body style="margin:0;background:#222;color:#eee;font:16px sans-serif"><h3 style="margin:10px">${D}: left = before (WebGL only), right = after (ink layer)</h3>${rows}<style>.row{margin:8px 10px}.cap{margin:2px 0}.pair{display:flex;gap:10px;align-items:flex-start}img{max-width:680px;image-rendering:pixelated;border:1px solid #555}</style></body></html>`,
  );
  await sp.screenshot({ path: join(OUT, `${D}-sheet.png`), fullPage: true });
  await sp.close();
}

try {
  await joinVillage(p, "Ti", TIMES[args.time]);
  // the houses, the gate lot and the lake's posts register their signs as they load
  for (let i = 0; ; i++) {
    const names = (await anchors(".")).map((a) => a.name);
    if (names.some((n) => n.startsWith("house_plate_ink__")) && names.includes("gate_board_ink") && names.includes("lake_sign_ink")) break;
    if (i >= 90) {
      console.log("not every outdoor sign registered in 90 s:", [...new Set(names)].join(" "));
      break;
    }
    await sleep(1000);
  }
  await sleep(3000);
  // ── outside: a house's number plate, the gate's welcome board, a lake finger post ──
  const plates = await anchors("^house_plate_ink__");
  const plate = plates[0] ?? null;
  if (plate) {
    await walkAndWait(p, plate.c[0] + plate.n[0] * 4, plate.c[2] + plate.n[2] * 4, 40000, 1.5);
    await sleep(2500);
    await shoot("house-plate", plate, 3, { eyeY: 1.6 });
    report.occlusion = await occlusionCheck("house-plate", plate, 2.5);
    if (phone) {
      report.sweeps = [];
      for (const [mode, speed] of [["car", 4], ["car", 6], ["car", 10], ["walk", 3], ["walk", 6]]) report.sweeps.push(await sweepCheck("house-plate", plate, 2.5, mode, speed));
    }
  }
  const gate = (await anchors("^gate_board_ink$"))[0] ?? null;
  await shoot("gate-board", gate, 6, { eyeY: 1.6 });
  const lake = (await anchors("^lake_sign_ink$", [29.6, 3.5]))[0] ?? null;
  if (lake) {
    await walkAndWait(p, lake.c[0] + lake.n[0] * 3, lake.c[2] + lake.n[2] * 3, 40000, 1.5);
    await sleep(2000);
    const near = (await anchors("^lake_sign_ink$", [29.6, 3.5])).filter((a) => Math.hypot(a.c[0] - 29.6, a.c[2] - 3.5) < 3);
    // the face that looks back toward the plaza
    const face = near.sort((a, b2) => a.n[0] - b2.n[0])[0] ?? lake;
    await shoot("lake-sign", face, 4, { eyeY: 1.7 });
  }
  // ── the memorial hall: a zone sign and the museum label ──
  await enterHall(p);
  await sleep(2000);
  const zone = (await anchors("^zone_sign_ink_A$"))[0] ?? null;
  await shoot("zone-sign", zone, 3.5, { eyeY: 1.6 });
  const label = (await anchors("^lounge_painting_label_ink$"))[0] ?? null;
  await shoot("museum-label", label, 1.4, { eyeY: 1.6 });
  report.occlusionZone = await occlusionCheck("zone-sign", zone, 3);
  if (phone) for (const [mode, speed] of [["car", 10], ["walk", 6]]) report.sweeps?.push(await sweepCheck("zone-sign", zone, 3, mode, speed));
  // ── 케이슨랜드: a shop sign ──
  if (!args["no-park"]) {
    await leaveHall(p);
    await sleep(2000);
    if (await enterPark()) {
      const shop = (await anchors("^shop_sign_ink$", [17, -168]))[0] ?? null;
      if (shop) {
        await walkAndWait(p, shop.c[0] + shop.n[0] * 5, shop.c[2] + shop.n[2] * 5, 40000, 2).catch(() => {});
        await sleep(2500);
        await shoot("shop-sign", shop, 4.5, { eyeY: 1.7 });
      }
    } else console.log("skip park: not entered");
  }
  report.stats = await inkStats();
  // the checks
  const drawnPhone = report.items.filter((r) => r.afterStats && r.afterStats.drawn > 0).length;
  if (phone) {
    run.check("phone: the ink layer is active", report.items.some((r) => r.afterStats?.active), {});
    run.check("phone: every sign shot was drawn crisp (overlay ink present after, none before)", report.items.every((r) => r.found === false || (r.afterInk > 50 && r.beforeInk === 0)), {
      items: report.items.map((r) => [r.item, r.deg, r.beforeInk, r.afterInk]),
    });
    for (const k of ["occlusion", "occlusionZone"]) {
      const o = report[k];
      if (!o) continue;
      run.check(`phone: ${o.item} behind an opaque box: no ink on the overlay when fully covered, less when half`, o.ink100 === 0 && o.ink50 < o.ink0 * 0.75 && o.ink0 > 50, o);
    }
    for (const w of report.sweeps ?? []) {
      if (!w) continue;
      // a box crossing at 10 m/s half a metre before a sign 2.5 m away jumps ~55 framebuffer px a frame: past the guard ring (24 px)
      // in one frame, it can show the letters over it for a frame — the known limit, reported, not asserted
      if (w.mode === "car" && w.speed > 6) {
        console.log(`(info) ${w.item} car ${w.speed} m/s: ${w.bad} frame(s) with letters over the box`);
        continue;
      }
      run.check(`phone: ${w.item}, a box sweeping in front (${w.mode} ${w.speed} m/s): no frame shows letters over it`, w.bad === 0 && w.frames > 10, w);
    }
  } else {
    run.check("pc: the ink layer stays off (the canvas is at the device's pixel ratio)", report.items.every((r) => r.found === false || r.afterStats?.active === false), { n: drawnPhone });
  }
  await sheet();
  // the fallback: a browser whose WebGL2 has no occlusion queries (the layer must stay off, the signs keep their lettering, no error)
  if (phone) {
    const p2 = await openPlayer(b, run, { tag: "N", device });
    await p2.page.addInitScript(() => {
      delete WebGL2RenderingContext.prototype.createQuery;
      WebGL2RenderingContext.prototype.createQuery = undefined;
    });
    await joinVillage(p2, "Tn", TIMES[args.time]);
    await sleep(8000);
    const st = await p2.page.evaluate(() => ({ ...(window.__cvLabelOverlay?.ink?.stats ?? {}), noQuery: typeof WebGL2RenderingContext.prototype.createQuery }));
    run.check("fallback: WebGL2 without occlusion queries — the ink layer stays off, nothing hidden", st.active === false && st.noQuery !== "function", st);
    await p2.page.close();
  }
} finally {
  writeFileSync(join(OUT, `${D}-report.json`), JSON.stringify(report, null, 2));
  await b.close();
}
process.exit(run.finish());
