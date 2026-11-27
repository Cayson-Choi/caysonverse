/**
 * e2e/interiors-audit.mjs — photo audit of the interiors (houses 1-10 floors 1+2, the lot rooms, the fishing shop, the bus cabin):
 * walks in by the real doors, then shoots a fixed set of photo cameras (window.__cvShot) in each room's own frame.
 *   server:  PORT=2993 npx tsx src/index.ts   (server/)      client: VITE_SERVER_URL=http://localhost:2993 npx vite --port 5993 --strictPort (client/)
 *   CV_CLIENT_URL=http://localhost:5993 node e2e/interiors-audit.mjs --what=houses [--houses=2,3] [--phone] [--night] [--out=<dir>] [--tag=before]
 *   --extra=name:lx,ly,lz,tx,ty,tz;...  extra room-frame close-up cameras
 *   --what=houses|lots|shop|cafe   (lots: --rooms=lot_school_class,lot_library_reading; --q=cafe=off adds a DEV address flag)
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, pos, press, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, areaOf, hideHud } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const what = arg("what", "houses");
const tag = arg("tag", "a");
const run = createRun(`interiors-audit-${what}`);
const OUT = arg("out", join(run.evidence, "audit"));
mkdirSync(OUT, { recursive: true });
const device = phone ? PHONE : DESKTOP;
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "audit", device });
const page = p.page;
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";
const imp = (path) => page.evaluate((x) => window.__imp(x).then(() => true), path);

await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}${arg("q", "") ? "&" + arg("q", "") : ""}`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("audit" + Math.floor(Math.random() * 900 + 100));
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
const HITCH = process.argv.includes("--hitch");
const CLOSE = process.argv.includes("--close");
const startFrames = () => page.evaluate(() => { window.__fr = []; let last = performance.now(); const tick = (t) => { window.__fr.push(t - last); last = t; if (window.__fr) window.__frId = requestAnimationFrame(tick); }; window.__frId = requestAnimationFrame(tick); });
const stopFrames = async (label) => { const f = await page.evaluate(() => { cancelAnimationFrame(window.__frId); const a = window.__fr ?? []; window.__fr = null; return a; }); const s2 = [...f].sort((x, y) => x - y); console.log("HITCH", label, JSON.stringify({ frames: f.length, p50: +s2[Math.floor(s2.length / 2)]?.toFixed(1), max: +Math.max(...f).toFixed(1), over50: f.filter((x) => x > 50).length, over100: f.filter((x) => x > 100).length })); };
async function waitArea(a, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await areaOf(p)) === a) break; await sleep(150); }
  await page.waitForFunction(() => { const c = document.querySelector(".cv-house-cover"); const f = document.querySelector(".cv-door-fade"); return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0"); }, null, { timeout: 30000 }).catch(() => {});
  await sleep(2500);
  return (await areaOf(p)) === a;
}
/** shoot named cameras: views = { name: [x,y,z,tx,ty,tz,fov] } in world coords */
async function shoot(prefix, views) {
  await hideHud(p);
  for (const [name, [x, y, z, tx, ty, tz, fov]] of Object.entries(views)) {
    await page.evaluate(([x, y, z, tx, ty, tz, fov]) => { window.__cvShot = { x, y, z, tx, ty, tz, fov }; }, [x, y, z, tx, ty, tz, fov]);
    await sleep(900);
    await page.screenshot({ path: join(OUT, `${tag}_${prefix}_${name}_${phone ? "ph" : "pc"}.png`) });
  }
  await page.evaluate(() => { window.__cvShot = null; });
  await page.evaluate(() => { for (const e of window.__hidden ?? []) e.style.visibility = ""; });
}
/** a room-frame camera set: frame(lx,lz) -> world; w,d room size; h = ceiling */
function roomViews(frame, w, d, h, fov) {
  const V = {};
  const c = (lx, ly, lz) => { const q = frame(lx, lz); return [q.x, ly, q.z]; };
  const view = (a, b) => [...c(...a), ...c(...b), fov];
  V.c1 = view([0.8, 1.55, 0.8], [w * 0.75, 1.0, d * 0.8]);
  V.c2 = view([w - 0.8, 1.55, 0.8], [w * 0.25, 1.0, d * 0.8]);
  V.c3 = view([0.8, 1.55, d - 0.8], [w * 0.75, 1.0, d * 0.2]);
  V.c4 = view([w - 0.8, 1.55, d - 0.8], [w * 0.25, 1.0, d * 0.2]);
  V.up = view([w / 2, 1.5, d * 0.25], [w / 2, h - 0.2, d * 0.8]);
  V.dn = view([w / 2, 2.2, d * 0.2], [w / 2, 0, d * 0.65]);
  V.fw = view([w / 2, 1.55, 0.6], [w / 2, 1.3, d]);
  V.bw = view([w / 2, 1.55, d - 0.6], [w / 2, 1.3, 0]);
  if (process.argv.includes("--only-extra")) for (const k of Object.keys(V)) delete V[k];
  // --extra=name:lx,ly,lz,tx,ty,tz;... : more cameras in the room frame (close-ups of one piece)
  for (const e of (arg("extra", "") || "").split(";").filter(Boolean)) {
    const [name, nums] = e.split(":");
    const n = nums.split(",").map(Number);
    V[name] = view(n.slice(0, 3), n.slice(3, 6));
  }
  if (CLOSE) {
    // close-ups: from the room's middle band, 1.6 m off each wall, at three spots along it (left, middle, right), eye 1.3 m
    const k = [0.2, 0.5, 0.8];
    k.forEach((f, i) => {
      V[`s${i}`] = view([w * f, 1.3, 1.7], [w * f, 1.0, 0]);
      V[`n${i}`] = view([w * f, 1.3, d - 1.7], [w * f, 1.0, d]);
      V[`w${i}`] = view([1.7, 1.3, d * f], [0, 1.0, d * f]);
      V[`e${i}`] = view([w - 1.7, 1.3, d * f], [w, 1.0, d * f]);
    });
  }
  return V;
}

if (what === "houses") {
  const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntries());
  const places = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES);
  const only = arg("houses", "2,3,4,5,6,7,8,9").split(",").map(Number);
  for (const n of only) {
    const kp = keypads.find((k) => k.buildingId === `house_${n}`);
    const P = places[n];
    const at = await planned(kp.pad.x, kp.pad.z, 0.9);
    console.log(`house ${n} at pad`, at.ok);
    await act(p);
    await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const ch of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${ch}"]`));
    if (HITCH) await startFrames();
    await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
    const inside = await waitArea(`house:house_${n}:1`);
    if (HITCH) await stopFrames(`house_${n}_enter`);
    console.log(`house ${n} inside`, inside);
    const ox = P.exitPad.x - 5.3;
    const fr1 = (lx, lz) => ({ x: ox + lx, z: 0 - lz });
    await shoot(`h${n}f1`, roomViews(fr1, 10.6, 7.8, 3.7, phone ? 80 : 70));
    // up
    const upAt = await planned(P.upPad.x, P.upPad.z, 0.7);
    await act(p);
    const up = await waitArea(`house:house_${n}:2`, 15000);
    console.log(`house ${n} up`, up, upAt.ok);
    if (up) {
      const fr2 = (lx, lz) => ({ x: ox + lx, z: 30 - lz });
      await shoot(`h${n}f2`, roomViews(fr2, 10.6, 7.8, 3.7, phone ? 80 : 70));
      // back down + out
      const t = await targets(p);
      await act(p);
      await waitArea(`house:house_${n}:1`, 15000);
    }
    await planned(P.exitPad.x, P.exitPad.z, 0.7);
    await act(p);
    await waitArea("village", 15000);
  }
}

if (what === "lots") {
  const rooms = arg("rooms", "lot_school_class,lot_library_reading").split(",");
  for (const unit of rooms) {
    const info = await page.evaluate(async (unit) => {
      const L = await window.__imp("/shared/src/village/villageLots.ts");
      const r = L.LOT_ROOMS.find((x) => x.unit.id === unit);
      const d = L.lotDoorPoint(r.lot, r.door);
      return { lot: r.lot.id, area: r.area, door: r.door.id, pad: d.pad, arrival: d.arrival, inside: L.lotRoomDoor(r), bounds: r.bounds, ceiling: r.ceiling, origin: r.origin };
    }, unit);
    await walkWay(info.lot, info.arrival.x, info.arrival.z);
    await planned(info.pad.x, info.pad.z, 0.6);
    await sleep(1800);
    if (HITCH) await startFrames();
    await act(p);
    const ok = await waitArea(info.area, 25000);
    if (HITCH) await stopFrames(`${unit}_enter`);
    console.log(unit, "inside", ok, JSON.stringify(info.bounds), info.ceiling);
    const b = info.bounds;
    const w = b.maxX - b.minX, d = b.maxZ - b.minZ;
    const fr = (lx, lz) => ({ x: b.minX + lx, z: b.minZ + lz });
    await shoot(unit, roomViews(fr, w, d, info.ceiling ?? 3.5, phone ? 80 : 70));
    await planned(info.inside.exitPad.x, info.inside.exitPad.z, 0.7);
    await act(p);
    await waitArea("village", 25000);
  }
}

if (what === "hall") {
  const { enterHall } = await import("./lib/village.mjs");
  await enterHall(p);
  const fr = (lx, lz) => ({ x: 292.5 + lx, z: -6 + lz });
  await shoot("hall", roomViews(fr, 15, 12, 3.4, phone ? 80 : 70));
}

if (what === "bus") {
  // the bus where it stands: a camera set in its own frame (x across, z along: measured from its mesh bounds in the root frame)
  await walkWay("busstop", 38.6, -3.6).catch(() => {});
  await sleep(3000);
  // the bus drives its route: wait until it stands at the stop (its root still for 2 s), so every camera shares one pose
  const busAt = () => page.evaluate(() => { const r = window.__cvBus?.()?.root; return r ? [r.position.x, r.position.z, r.rotation.y] : null; });
  for (let t0 = Date.now(), last = null, still = 0; Date.now() - t0 < 240000; ) {
    const q = await busAt();
    still = q && last && Math.hypot(q[0] - last[0], q[1] - last[1]) < 0.002 ? still + 1 : 0;
    last = q;
    if (still >= 4) { console.log("bus standing at", JSON.stringify(q)); break; }
    await sleep(500);
  }
  const box = await page.evaluate(() => {
    const n = window.__cvBus?.();
    if (!n) return null;
    const r = n.root;
    r.updateMatrixWorld(true);
    const inv = r.matrixWorld.clone().invert();
    const V = r.position.constructor;
    let mn = new V(1e9, 1e9, 1e9), mx = new V(-1e9, -1e9, -1e9);
    r.traverse((o) => { if (!o.isMesh) return; o.geometry.computeBoundingBox(); const b = o.geometry.boundingBox; for (const cx of [b.min.x, b.max.x]) for (const cy of [b.min.y, b.max.y]) for (const cz of [b.min.z, b.max.z]) { const q = new V(cx, cy, cz).applyMatrix4(o.matrixWorld).applyMatrix4(inv); mn.min(q); mx.max(q); } });
    return { mn: mn.toArray(), mx: mx.toArray() };
  });
  console.log("bus box", JSON.stringify(box));
  const L = (pts) => page.evaluate((pts) => { const r = window.__cvBus().root; const V = r.position.constructor; return pts.map((q) => new V(...q).applyMatrix4(r.matrixWorld).toArray()); }, pts);
  if (box) {
    const [x0, y0, z0] = box.mn, [x1, y1, z1] = box.mx;
    const long = x1 - x0 > z1 - z0 ? "x" : "z";
    const P = (a, h, b) => (long === "x" ? [x0 + (x1 - x0) * a, y0 + h, z0 + (z1 - z0) * b] : [x0 + (x1 - x0) * b, y0 + h, z0 + (z1 - z0) * a]);
    // in the bus's own frame (the glTF root: nose toward -z, the doors toward +x, the floor at 0.34; the box above also holds the
    // road quad round the bus, so the cabin's cameras are set in metres from the root, not as fractions of it)
    const defs = process.argv.includes("--bus-box") ? {
      fwd: [P(0.85, 1.75, 0.5), P(0.05, 1.2, 0.5)], back: [P(0.15, 1.75, 0.5), P(0.95, 1.2, 0.5)],
      seatsL: [P(0.5, 1.7, 0.7), P(0.5, 0.6, 0.1)], seatsR: [P(0.5, 1.7, 0.3), P(0.5, 0.6, 0.9)],
      dash: [P(0.75, 1.6, 0.5), P(0.97, 1.0, 0.3)], floor: [P(0.5, 2.0, 0.5), P(0.6, 0.0, 0.5)],
      roof: [P(0.5, 1.2, 0.5), P(0.7, 3.0, 0.5)], seatClose: [P(0.45, 1.3, 0.55), P(0.4, 0.5, 0.15)],
    } : {
      fwd: [[0, 1.75, 3.4], [0, 1.25, -3.8]], back: [[0, 1.75, -2.4], [0, 1.2, 4.2]],
      seatsL: [[0.5, 1.6, 1.4], [-1.0, 0.7, 0.4]], seatsR: [[-0.5, 1.6, 2.6], [1.0, 0.7, 1.6]],
      seatClose: [[0.1, 1.15, 0.9], [-0.85, 0.55, 1.9]], housing: [[0.25, 1.45, 3.4], [-0.9, 0.8, 1.6]],
      roof: [[0, 1.4, 1.2], [0, 2.9, -1.2]], floor: [[0, 1.9, 0.6], [0, 0.3, -0.5]],
    };
    const V = {};
    for (const [k, [a, b]] of Object.entries(defs)) { const [ea, eb] = await L([a, b]); V[k] = [...ea, ...eb, phone ? 80 : 70]; }
    await shoot("bus", V);
    console.log("bus after shots", JSON.stringify(await busAt()));
  }
  // the shelter (village_busstop.glb: x 41..42.8, z -7.1..-2.7, open to the road on the west): its inside from the kerb
  const fov = phone ? 80 : 70;
  await shoot("shelter", {
    front: [39.4, 1.6, -4.9, 41.7, 1.1, -4.9, fov],
    oblique: [40.1, 1.55, -2.0, 41.7, 1.0, -6.4, fov],
    bench: [40.2, 1.15, -5.7, 41.3, 0.45, -4.5, fov],
    roof: [40.6, 1.3, -4.9, 41.9, 2.6, -5.6, fov],
  });
}

if (what === "shop") {
  await walkWay("lake", 101, -16);
  await sleep(6000);
  const fr = (lx, lz) => ({ x: 98.4 + lx, z: -24.6 + lz });
  await shoot("shop", roomViews(fr, 7.2, 4.7, 2.9, phone ? 80 : 72));
}

if (what === "cafe") {
  await walkWay("cafe", 40, -14);
  await sleep(4000);
  // cafe 20 x 15 centred (50.6,-15.1): shoot the inside from near the glass front looking in and from inside corners
  const V = {
    a: [52, 1.6, -9.5, 50, 1.2, -18, 70],
    b: [44, 1.6, -10, 56, 1.2, -19, 70],
    c: [57, 1.6, -10, 45, 1.2, -19, 70],
    d: [50.6, 1.6, -20, 50.6, 1.2, -10, 70],
    e: [50, 1.3, -14, 50, 3.0, -17, 80],
    f: [44.5, 1.6, -13, 56, 1.3, -14, 70],
    // through the glass from the terrace (standing eye height): left window, the door, right window, and the whole front from the plaza side
    w1: [43.2, 1.6, -19.6, 54, 1.7, -14.8, 62],
    w2: [43.2, 1.6, -15.1, 54, 1.9, -15.1, 62],
    w3: [43.2, 1.6, -10.6, 54, 1.7, -15.4, 62],
    w4: [36, 2.0, -15.1, 50, 1.9, -15.1, 58],
    w5: [44.6, 1.55, -12.5, 52, 1.6, -18.5, 66],
  };
  await shoot("cafe", V);
}
if (what === "plaza") {
  await sleep(4000);
  await shoot("plaza", { o: [30, 40, 60, 0, 0, 0, 55], cafe: [30, 14, 6, 50, 2, -15, 55] });
}
console.log("errors", JSON.stringify(run.errors).slice(0, 500));
await browser.close();
