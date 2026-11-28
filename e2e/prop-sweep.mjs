/**
 * e2e/prop-sweep.mjs — phone close-ups of the small props in the non-house interiors (tables, counters, shelves): walks in by the
 * real doors (as interiors-audit.mjs), then for each target point shoots a top-down-oblique and an eye-level camera from the room's
 * middle side (window.__cvShot).
 *   CV_CLIENT_URL=http://localhost:5627 node e2e/prop-sweep.mjs --where=lot_church_nave --targets=<json> [--phone] [--night] [--out=<dir>] [--tag=before]
 *   --where = a lot room unit id | hall | shop | outdoor ; targets json = { <where>: [[x,y,z], ...] } (world metres)
 *   --shots=<json> instead: { <where>: { name: [x,y,z,tx,ty,tz,fov] } } explicit cameras
 */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, waitIdle, walkTo } from "./lib/common.mjs";
import { act, areaOf, enterHall, hideHud } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const where = arg("where", "lot_church_nave");
const tag = arg("tag", "a");
const run = createRun(`prop-sweep-${where}`);
const OUT = arg("out", join(run.evidence, "sweep"));
mkdirSync(OUT, { recursive: true });
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "sweep", device: phone ? PHONE : DESKTOP });
const page = p.page;
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";

await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("sweep" + Math.floor(Math.random() * 900 + 100));
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await sleep(2500);

async function planned(x, z, tol = 0.6) {
  for (let a = 0; a < 3; a++) {
    const plan = await page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return { ok: plan.why === "here", at: await pos(p), why: plan.why };
    for (const w of plan.pts) {
      await walkTo(p, w.x, w.z);
      await sleep(300);
      await waitIdle(p, 25000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(p);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}
async function walkWay(placeId, x, z) {
  const here = await pos(p);
  if (Math.hypot(here.x, here.z - 14) > 25) await planned(0, 14, 2);
  const h2 = await pos(p);
  const way = await page.evaluate(async ([id, x, z]) => { const m = await window.__imp("/src/village/villagePlaces.ts"); return m.wayTo(m.mapPlace(id) ?? m.mapPlace(id.replace(/^lot_/, "")), x, z); }, [placeId, h2.x, h2.z]);
  for (const w of way) await planned(w.x, w.z, 1.2);
  return planned(x, z, 0.8);
}
async function waitArea(a, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await areaOf(p)) === a) break; await sleep(150); }
  await page.waitForFunction(() => { const c = document.querySelector(".cv-house-cover"); const f = document.querySelector(".cv-door-fade"); return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0"); }, null, { timeout: 30000 }).catch(() => {});
  await sleep(3000);
  return (await areaOf(p)) === a;
}
const FRAME = arg("frame", "");
/** --frame=<node name>: the cameras are in that node's own (glTF file) frame: map them through its matrixWorld */
async function framed(views) {
  if (!FRAME) return views;
  return page.evaluate(([views, name]) => {
    const { scene } = window.__cvThree();
    let node = null;
    scene.traverse((o) => { if (!node && o.name === name) node = o; });
    if (!node) return { __missing: name };
    node.updateMatrixWorld(true);
    const m = node.matrixWorld;
    const V = node.position.constructor;
    const out = {};
    for (const [k, v] of Object.entries(views)) {
      const a = new V(v[0], v[1], v[2]).applyMatrix4(m), b = new V(v[3], v[4], v[5]).applyMatrix4(m);
      out[k] = [a.x, a.y, a.z, b.x, b.y, b.z, v[6]];
    }
    return out;
  }, [views, FRAME]);
}
async function shoot(prefix, views0) {
  const views = await framed(views0);
  if (views.__missing) { console.log("frame node missing", views.__missing); return; }
  await hideHud(p);
  for (const [name, [x, y, z, tx, ty, tz, fov]] of Object.entries(views)) {
    await page.evaluate((v) => { window.__cvShot = { x: v[0], y: v[1], z: v[2], tx: v[3], ty: v[4], tz: v[5], fov: v[6] }; }, [x, y, z, tx, ty, tz, fov]);
    await sleep(1000);
    await page.screenshot({ path: join(OUT, `${tag}_${prefix}_${name}_${phone ? "ph" : "pc"}${night ? "_n" : ""}.png`) });
  }
  await page.evaluate(() => { window.__cvShot = null; });
}
/** two cameras per target: 1.0 m toward the room's middle and 0.7 m up (looking down), and 1.45 m off at the target's height + 0.2 */
function closeViews(targets, centre) {
  const V = {};
  const fov = phone ? 62 : 50;
  targets.forEach(([x, y, z], i) => {
    let dx = centre[0] - x, dz = centre[1] - z;
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    V[`t${String(i).padStart(2, "0")}a`] = [x + dx * 1.0, y + 0.7, z + dz * 1.0, x, y - 0.05, z, fov];
    V[`t${String(i).padStart(2, "0")}b`] = [x + dx * 1.45, y + 0.3, z + dz * 1.45, x, y, z, fov];
  });
  return V;
}
const targets = arg("targets") ? JSON.parse(readFileSync(arg("targets"), "utf8"))[where] ?? [] : [];
const explicit = arg("shots") ? JSON.parse(readFileSync(arg("shots"), "utf8"))[where] ?? {} : {};
const centreOf = (ts) => [ts.reduce((s, t) => s + t[0], 0) / Math.max(1, ts.length), ts.reduce((s, t) => s + t[2], 0) / Math.max(1, ts.length)];

if (where === "cafe1" || where === "cafe2") {
  // the café: by the plaza side to its door, the action; upstairs by the stair pad's button (e2e/cafe-upstairs.mjs)
  const d = await page.evaluate(async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotDoorPoint(r.lot, r.door); });
  for (const [x, z] of [[20, -8], [36, -12], [42, -15.1]]) await planned(x, z, 1.3);
  await planned(d.pad.x - 0.6, d.pad.z, 0.9);
  await sleep(800);
  await act(p);
  console.log("cafe inside", await waitArea("lot:lot_cafe_room", 60000));
  if (where === "cafe2") {
    const st = await page.evaluate(async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotRoomStair(r).pad; });
    await planned(st.x, st.z - 0.3, 0.5);
    await sleep(1500);
    await act(p);
    console.log("upstairs", await waitArea("lot:lot_cafe_upstairs", 60000));
  }
  await shoot(where, { ...closeViews(targets, centreOf(targets)), ...explicit });
}
if (where.startsWith("lot_")) {
  const info = await page.evaluate(async (unit) => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const r = L.LOT_ROOMS.find((x) => x.unit.id === unit);
    const d = L.lotDoorPoint(r.lot, r.door);
    return { lot: r.lot.id, area: r.area, pad: d.pad, arrival: d.arrival, inside: L.lotRoomDoor(r), bounds: r.bounds };
  }, where);
  await walkWay(info.lot, info.arrival.x, info.arrival.z);
  await planned(info.pad.x, info.pad.z, 0.6);
  await sleep(1800);
  await act(p);
  const ok = await waitArea(info.area, 25000);
  console.log(where, "inside", ok);
  const b = info.bounds;
  await shoot(where, { ...closeViews(targets, FRAME ? centreOf(targets) : [(b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2]), ...explicit });
}
if (where === "hall") {
  await enterHall(p);
  await shoot("hall", { ...closeViews(targets, centreOf(targets)), ...explicit });
}
if (where === "shop") {
  await walkWay("lake", 101, -16);
  await sleep(6000);
  await shoot("shop", { ...closeViews(targets, [101.9, -22.2]), ...explicit });
}
if (where === "outdoor") {
  await sleep(4000);
  await shoot("outdoor", explicit);
}
if (where.startsWith("park:")) {
  // Caysonland: through the park gate (its door pad, the action), then walk to x,z and shoot the explicit cameras
  const g = await page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await walkWay("lot_gate", g.x, g.z - 0.5);
  await planned(g.x, g.z - 0.5, 1.0);
  await act(p);
  console.log("park", await waitArea("park", 30000));
  await sleep(3000);
  const [x, z] = where.slice(5).split(",").map(Number);
  await planned(x, z, 1.5);
  await sleep(5000);
  await shoot("park", explicit);
}
if (where.startsWith("walk:")) {
  // walk:<x>,<z> then shoot the explicit cameras (park shops etc.)
  const [x, z] = where.slice(5).split(",").map(Number);
  await planned(x, z, 1.5);
  await sleep(4000);
  await shoot("walk", explicit);
}
console.log("errors", JSON.stringify(run.errors).slice(0, 500));
await browser.close();
