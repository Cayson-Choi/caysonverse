/**
 * e2e/ext-shots.mjs — the exteriors audit (feat/exteriors-real): fixed photo-camera shots (window.__cvShot) of every building's
 * outside, generated from the layout (village) or a views file (park): four corners at eye level, four facade close-ups, an
 * aerial; lots forced to full detail; HUD hidden; draw calls / triangles per shot.
 *
 *   CV_CLIENT_URL=http://localhost:5651 node e2e/ext-shots.mjs --out=<dir> [--tag=before] [--dev=desktop|phone]
 *        [--time=12:30] [--only=house_1,lot_school] [--views=c1,c2,c3,c4,sf,sb,sl,sr,air] [--list] [--extra=<views.json>]
 */
import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", "tmp-ext");
const TAG = opt("tag", "before");
const DEV = opt("dev", "desktop");
const TIME = opt("time", "12:30");
const ONLY = opt("only", "").split(",").filter(Boolean);
const VIEWS = opt("views", "c1,c2,c3,c4,sf,sb,sl,sr,air").split(",");
const EXTRA = opt("extra", "");
mkdirSync(OUT, { recursive: true });
const run = createRun("ext-shots");
run.evidence = OUT;

const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`2026-11-16T${TIME}`)}${process.env.CV_QS || ""}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("shot");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 180000 });
await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 90000 }).catch(() => {});
await P.page.waitForFunction(() => !!window.__cvLots?.()?.visible, null, { timeout: 120000 }).catch(() => {});
await P.page.evaluate(() => window.__cvLotsForce?.(2));
await sleep(8000);

const hideHud = (on) =>
  P.page.evaluate((on) => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el)) el.style.visibility = on ? "hidden" : "";
  }, on);
const areaOf = () => P.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function goTo(x, z) {
  await P.page.evaluate(async ([x, z]) => {
    const plan = await window.__imp("/src/game/clickPlan.ts");
    const move = await window.__imp("/src/game/clickMove.ts");
    const am = await window.__imp("/src/game/activeMap.ts");
    const me = window.__cv.getPos();
    const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
    move.setClickTarget(x, z, 0, via ?? undefined);
  }, [x, z]);
  await sleep(400);
  for (let i = 0; i < 480; i++) {
    if ((await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null) break;
    await sleep(250);
  }
}
async function enterPark() {
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  for (let attempt = 0; attempt < 4; attempt++) {
    await goTo(g.x, g.z - 0.5);
    const at = await P.page.evaluate(() => window.__cv.getPos());
    if (Math.hypot(at.x - g.x, at.z - (g.z - 0.5)) < 1.2) break;
  }
  for (let i = 0; i < 3 && (await areaOf()) !== "park"; i++) {
    await act(P);
    await sleep(5000);
  }
  await sleep(6000);
}

// targets from the layout: { name, cx, cz, hx, hz, h, yaw (door direction: 0 = +z) }
const targets = await P.page.evaluate(async () => {
  const L = await window.__imp("/shared/src/village/villageLayout.ts");
  const LOTS = await window.__imp("/shared/src/village/villageLots.ts");
  const yawOf = { s: 0, n: Math.PI, e: Math.PI / 2, w: -Math.PI / 2 };
  const out = [];
  for (const h of L.VILLAGE_LAYOUT.sceneryHouses) {
    const sz = h.size ?? { x: 11.2, z: 10.75 };
    out.push({ name: h.id, cx: h.centre.x, cz: h.centre.z, hx: sz.x / 2, hz: sz.z / 2, h: h.kind === "kiosk" ? 4 : h.kind === "cafe" ? 9 : 11, yaw: yawOf[h.doorSide] });
  }
  for (const l of [...LOTS.VILLAGE_LOTS]) {
    const f = LOTS.lotFootprint(l);
    out.push({ name: l.id, cx: (f.minX + f.maxX) / 2, cz: (f.minZ + f.maxZ) / 2, hx: (f.maxX - f.minX) / 2, hz: (f.maxZ - f.minZ) / 2, h: l.height ?? 12, yaw: yawOf[l.doorSide] });
  }
  const m = L.VILLAGE_LAYOUT.memorial.exterior;
  out.push({ name: "memorial", cx: m.centre.x, cz: m.centre.z, hx: m.size.x / 2, hz: m.size.z / 2, h: 9, yaw: 0 });
  const pv = L.VILLAGE_LAYOUT.pavilion;
  out.push({ name: "pavilion", cx: pv.centre.x, cz: pv.centre.z, hx: pv.size.x / 2, hz: pv.size.z / 2, h: 5, yaw: 0 });
  const b = L.VILLAGE_LAYOUT.bridge;
  out.push({ name: "bridge", cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, hx: (b.maxX - b.minX) / 2, hz: (b.maxZ - b.minZ) / 2, h: 2, yaw: 0 });
  out.push({ name: "fountain", cx: 0, cz: 0, hx: 5, hz: 5, h: 5, yaw: 0 });
  out.push({ name: "busstop", cx: 41, cz: -6.1, hx: 2.4, hz: 4.7, h: 3.5, yaw: -Math.PI / 2 });
  return out;
});
if (args.includes("--list")) {
  console.log(JSON.stringify(targets));
  await browser.close();
  process.exit(0);
}

function viewsFor(t) {
  const c = Math.cos(t.yaw), s = Math.sin(t.yaw);
  // local (x right of door, z out of door) -> world
  const W = (lx, lz) => [t.cx + lx * c + lz * s, t.cz - lx * s + lz * c];
  const r = Math.max(t.hx, t.hz);
  const hxL = t.yaw === 0 || Math.abs(t.yaw) === Math.PI ? t.hx : t.hz; // local half-width along the facade
  const hzL = t.yaw === 0 || Math.abs(t.yaw) === Math.PI ? t.hz : t.hx;
  const ty = Math.min(t.h * 0.42, 6);
  const v = {};
  const d = r * 1.25 + 7;
  const corner = (sx, sz) => { const [x, z] = W(sx * (hxL + d * 0.62), sz * (hzL + d * 0.62)); return { cam: [x, 1.7, z], look: [t.cx, ty, t.cz], fov: 55 }; };
  v.c1 = corner(-1, 1);
  v.c2 = corner(1, 1);
  v.c3 = corner(1, -1);
  v.c4 = corner(-1, -1);
  const side = (lx, lz, ax, az) => { const [x, z] = W(lx, lz); const [a, b] = W(ax, az); return { cam: [x, 1.8, z], look: [a, Math.min(t.h * 0.35, 3.5), b], fov: 60 }; };
  v.sf = side(-1.2, hzL + 5.5, 0, hzL);
  v.sb = side(1.2, -hzL - 5.5, 0, -hzL);
  v.sl = side(-hxL - 5.5, 0.8, -hxL, 0);
  v.sr = side(hxL + 5.5, -0.8, hxL, 0);
  const [ax, az] = W(-(hxL + d * 0.7), hzL + d * 0.9);
  v.air = { cam: [ax, t.h + 9, az], look: [t.cx, t.h * 0.3, t.cz], fov: 55 };
  return v;
}

const list = [];
for (const t of targets) {
  if (ONLY.length && !ONLY.includes(t.name)) continue;
  const vs = viewsFor(t);
  for (const k of VIEWS) if (vs[k]) list.push({ name: `${t.name}-${k}`, ...vs[k] });
}
if (EXTRA) for (const v of JSON.parse(readFileSync(EXTRA, "utf8"))) if (!ONLY.length || ONLY.some((o) => v.name.startsWith(o))) list.push(v);

const stats = {};
for (const v of list) {
  if (v.park && (await areaOf()) !== "park") {
    await P.page.evaluate(() => (window.__cvShot = null));
    await hideHud(false);
    await enterPark();
  }
  if (v.walk) {
    await P.page.evaluate(() => (window.__cvShot = null));
    await goTo(v.walk[0], v.walk[1]).catch(() => {});
  }
  await hideHud(true);
  await P.page.evaluate(([c, l, fov]) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov }), [v.cam, v.look, v.fov ?? 55]);
  await sleep(v.wait ?? 1800);
  const info = await P.page.evaluate(() => {
    const gl = window.__cvThree().gl;
    return { calls: gl.info.render.calls, triangles: gl.info.render.triangles, tex: gl.info.memory.textures };
  });
  stats[v.name] = info;
  await P.page.screenshot({ path: join(OUT, `${TAG}-${DEV}-${TIME.replace(":", "")}-${v.name}.png`) });
}
writeFileSync(join(OUT, `${TAG}-${DEV}-${TIME.replace(":", "")}-stats.json`), JSON.stringify(stats, null, 1));
console.log("shots", list.length);
await browser.close();
process.exit(run.finish());
