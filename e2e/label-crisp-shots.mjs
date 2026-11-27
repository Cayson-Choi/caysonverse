/**
 * e2e/label-crisp-shots.mjs — how crisp the in-world labels (name tags, speech bubbles, the guide's "안내원", emoji) come out
 * next to the HTML HUD text, at the device's real pixel ratio (fix/crisp-labels, owner 2026-11-27: "모바일에서 왜 이렇게 글자
 * 가독성이 안좋지? ... 닉네임을 봐봐").
 *
 *   CV_CLIENT_URL=http://localhost:5616 node e2e/label-crisp-shots.mjs --device phone3|pc2|pc1 --label before|after [--time day|night]
 *
 * phone3 = 412 x 915 CSS px at deviceScaleFactor 3 (an Android phone: isMobile, hasTouch), graphics auto (light tier).
 * pc2 / pc1 = 1280 x 800 at deviceScaleFactor 2 / 1, graphics auto (rich tier).
 * A few fake remote players stand in front of the camera ("크리스마스" with a chat line, others with an emoji), the own player
 * says something too. Saves <out>/<device>-<time>-<label>.png (native device pixels) and one crop per label plus a crop of
 * the HUD (compass + top bar), with their rects in <out>/<device>-<time>-<label>.json.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage, NOON } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "phone3" },
    label: { type: "string", default: "run" },
    time: { type: "string", default: "day" },
    out: { type: "string", default: "D:/ClaudeCode/tmpshots/labels" },
  },
});
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36";
const DEVICES = {
  phone3: { viewport: { width: 412, height: 915 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: ANDROID_UA },
  pc2: { ...DESKTOP, deviceScaleFactor: 2 },
  pc1: { ...DESKTOP, deviceScaleFactor: 1 },
};
const device = DEVICES[args.device];
if (!device) throw new Error(`unknown device ${args.device}`);
const TIME = args.time === "night" ? "2026-11-03T22:30" : NOON;
const OUT = args.out;
mkdirSync(OUT, { recursive: true });
const stem = `${args.device}-${args.time}-${args.label}`;

const run = createRun("label-crisp-shots");
run.evidence = OUT;
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "L", device });
await joinVillage(p, "Lb", TIME);
// near the plaza guide (5, 12), looking at it
await walkAndWait(p, 1.5, 17.5, 25000, 1.2);
await turnCameraTo(p, 5, 12);
await sleep(1200);

await p.page.evaluate(async () => {
  const store = await window.__imp("/src/game/remoteStore.ts");
  const playout = await window.__imp("/src/game/playout.ts");
  const { bubbleRegistry } = await window.__imp("/src/game/bubbleRegistry.ts");
  const { emojiRegistry } = await window.__imp("/src/game/emojiRegistry.ts");
  const t = window.__cvThree();
  const f = new t.camera.position.constructor();
  t.camera.getWorldDirection(f);
  const base = Math.atan2(f.x, f.z);
  const me = window.__cv.getPos();
  const people = [
    ["crisp0", "크리스마스", 3.2, -0.45],
    ["crisp1", "케이슨", 5.5, 0.42],
    ["crisp2", "Minji_22", 8.5, -0.25],
    ["crisp3", "겨울바다", 12, 0.3],
  ];
  for (const [id, nickname, dist, da] of people) {
    const a = base + da;
    store.addRemote({ sessionId: id, nickname, connected: true, seatIndex: -1, busSeat: -1, rideSeat: -1, rideId: 0, snapshots: [], playout: playout.createPlayout(0) });
    store.receiveRemotePose(id, performance.now(), 0, me.x + Math.sin(a) * dist, me.z + Math.cos(a) * dist, base + Math.PI);
  }
  window.__crispKeep = setInterval(() => {
    const now = performance.now();
    for (const [id, , dist, da] of people) {
      const a = base + da;
      store.receiveRemotePose(id, now, 0, me.x + Math.sin(a) * dist, me.z + Math.cos(a) * dist, base + Math.PI);
    }
    bubbleRegistry.set("crisp0", "안녕하세요! 오늘 날씨 좋네요 ☀️", now - 1500);
    emojiRegistry.set("crisp1", 0, now - 300);
  }, 1500);
  const now = performance.now();
  bubbleRegistry.set("crisp0", "안녕하세요! 오늘 날씨 좋네요 ☀️", now);
});
await sleep(3500);

// every label sprite on screen: its rect in CSS px (projected the way the label overlay places it)
const rects = await p.page.evaluate(() => {
  const t = window.__cvThree();
  const { camera, scene, gl } = t;
  const w = gl.domElement.clientWidth;
  const h = gl.domElement.clientHeight;
  const out = [];
  const v = new camera.position.constructor();
  scene.traverse((o) => {
    if (!o.isSprite || o.layers.mask !== 1 << 30) return;
    for (let q = o; q; q = q.parent) if (!q.visible) return;
    if ((o.material?.opacity ?? 1) < 0.05) return;
    o.getWorldPosition(v);
    v.project(camera);
    if (v.z > 1 || v.z < -1) return;
    const img = o.material.map?.image;
    const sx = new camera.position.constructor().setFromMatrixScale(o.matrixWorld);
    const d = o.getWorldPosition(new camera.position.constructor()).applyMatrix4(camera.matrixWorldInverse);
    const ppm = h / (2 * Math.tan((camera.fov * Math.PI) / 360) * -d.z);
    const ww = sx.x * ppm;
    const hh = sx.y * ppm;
    const cx = (v.x * 0.5 + 0.5) * w;
    const cy = (1 - (v.y * 0.5 + 0.5)) * h;
    const x = cx - o.center.x * ww;
    const y = cy - (1 - o.center.y) * hh;
    out.push({ order: o.renderOrder, x, y, w: ww, h: hh, tex: img ? [img.width, img.height] : null });
  });
  const hud = [".cv-compass", ".cv-hud-top", ".cv-action-btn"].map((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { sel: s, x: r.x, y: r.y, w: r.width, h: r.height };
  }).filter(Boolean);
  return { w, h, dpr: window.devicePixelRatio, glPixelRatio: gl.getPixelRatio(), canvasPx: [gl.domElement.width, gl.domElement.height], labels: out, hud };
});
await p.page.screenshot({ path: join(OUT, `${stem}.png`) });
const pad = 4;
let i = 0;
for (const r of rects.labels.sort((a, c) => a.order - c.order || a.y - c.y)) {
  const clip = { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad };
  if (clip.x + clip.width > rects.w || clip.y + clip.height > rects.h || clip.width < 4) continue;
  r.file = `${stem}-label${i++}-o${r.order}.png`;
  await p.page.screenshot({ path: join(OUT, r.file), clip });
}
for (const r of rects.hud) {
  r.file = `${stem}-hud${r.sel.replace(/[^a-z]/g, "")}.png`;
  await p.page.screenshot({ path: join(OUT, r.file), clip: { x: r.x, y: r.y, width: Math.min(r.w, 300), height: Math.min(r.h, 120) } });
}
writeFileSync(join(OUT, `${stem}.json`), JSON.stringify(rects, null, 2));
console.log(JSON.stringify({ ...rects, labels: rects.labels.map((l) => ({ o: l.order, w: Math.round(l.w), h: Math.round(l.h), tex: l.tex, file: l.file })) }, null, 1));
await p.page.evaluate(() => clearInterval(window.__crispKeep));
const code = run.finish();
await b.close();
process.exit(code);
