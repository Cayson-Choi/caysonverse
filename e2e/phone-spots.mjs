/**
 * e2e/phone-spots.mjs — what each heavy spot of the village costs, on the phone profile or a PC (perf/phone-library, 2026-11-21):
 * draw calls, triangles, GPU textures (count and the estimated MB of the uploaded ones), geometries, programs and the rAF frame
 * time, plus the visible scene's top groups by draws and by triangles. Headless Chrome renders WebGL on the CPU, so the fps is not
 * a phone's: draw calls / triangles / texture memory are the metrics.
 *
 *   CV_CLIENT_URL=http://localhost:5601 node e2e/phone-spots.mjs --device phone|pc [--spots plaza,gate,lake,...] [--label before] [--out <dir>]
 * spots: plaza, gate (the Caysonland avenue), lake, temple, school, library, hall (the memorial), house, school_in, library_in
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { act, enterHall, joinVillage, leaveHall } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "phone" },
    spots: { type: "string", default: "plaza,gate,lake,temple,school,library,hall,house,school_in,library_in" },
    label: { type: "string", default: "run" },
    out: { type: "string", default: "D:/ClaudeCode/tmpshots/phoneperf" },
    shots: { type: "boolean", default: true },
  },
});
const PH = args.device === "phone";
mkdirSync(args.out, { recursive: true });
const SPOTS = args.spots.split(",");
const run = createRun(`phone-spots-${args.device}`);
run.evidence = args.out;
run.allow("D3D X3595", /X3595/);
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "S", device: PH ? PHONE : DESKTOP, settings: PH ? { graphics: "low" } : {} });
await joinVillage(p, "Sp");
await sleep(3000);
const page = p.page;
const results = {};

/** What the renderer is drawing now: counters averaged over `n` samples, texture memory, top groups. */
async function measure(name) {
  await sleep(4000);
  const info = await page.evaluate(async () => {
    const samples = [];
    for (let i = 0; i < 12; i++) {
      const r = window.__cvRenderInfo();
      samples.push(r);
      await new Promise((res) => setTimeout(res, 150));
    }
    const avg = (k) => Math.round(samples.reduce((a, s) => a + s[k], 0) / samples.length);
    const t = window.__cvThree();
    const { scene, camera, gl } = t;
    camera.updateMatrixWorld();
    const seen = new Set();
    let bytes = 0;
    let n = 0;
    const texList = [];
    const texBytes = (tx) => {
      if (tx.isCompressedTexture && tx.mipmaps?.length) return tx.mipmaps.reduce((a, m) => a + (m.data?.byteLength ?? 0), 0);
      if (tx.isCompressedTexture) return 0;
      const im = tx.image;
      const w = im?.width ?? im?.videoWidth ?? 0, h = im?.height ?? im?.videoHeight ?? 0;
      return w * h * 4 * (tx.generateMipmaps ? 4 / 3 : 1);
    };
    const mm = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
    const e = mm.elements;
    const planes = [];
    for (const [i, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
      const a = e[3] + s * e[i], bb = e[7] + s * e[i + 4], c = e[11] + s * e[i + 8], d = e[15] + s * e[i + 12];
      const l = Math.hypot(a, bb, c);
      planes.push([a / l, bb / l, c / l, d / l]);
    }
    const inFrustum = (o) => {
      if (o.frustumCulled === false || o.isInstancedMesh) return true;
      const g = o.geometry;
      if (!g) return true;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const sp = g.boundingSphere;
      if (!sp) return true;
      const c = sp.center.clone().applyMatrix4(o.matrixWorld);
      const r = sp.radius * o.matrixWorld.getMaxScaleOnAxis();
      for (const pl of planes) if (pl[0] * c.x + pl[1] * c.y + pl[2] * c.z + pl[3] < -r) return false;
      return true;
    };
    const isVis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
    const pathOf = (o) => { const names = []; for (let q = o; q && q !== scene; q = q.parent) names.unshift(q.name || q.type); return names.slice(0, 3).join(">"); };
    const groups = {};
    const matDraws = {};
    scene.traverse((o) => {
      if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite)) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const k of Object.keys(m)) {
          const v = m[k];
          if (v && v.isTexture && !seen.has(v) && gl.properties.has(v)) { seen.add(v); const bb = texBytes(v); bytes += bb; n++; texList.push([v.name || v.source?.data?.src?.slice?.(-40) || v.uuid.slice(0, 6), v.image?.width ?? v.mipmaps?.[0]?.width, v.image?.height ?? v.mipmaps?.[0]?.height, v.isCompressedTexture ? "C" : "R", Math.round(bb / 1048576 * 10) / 10]); }
        }
        const u = m.uniforms;
        if (u) for (const k of Object.keys(u)) { const v = u[k]?.value; if (v && v.isTexture && !seen.has(v) && gl.properties.has(v)) { seen.add(v); bytes += texBytes(v); n++; } }
      }
      if (!isVis(o) || !inFrustum(o)) return;
      const g = o.geometry;
      if (!g) return;
      let tris = Math.floor((g.index ? g.index.count : g.attributes.position?.count ?? 0) / 3);
      if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, Math.floor(g.drawRange.count / 3));
      const cnt = o.isInstancedMesh ? o.count : 1;
      for (const m of mats) { const k = (m?.name || m?.type || "?") + (m?.transparent ? "/T" : ""); const M = (matDraws[k] ??= { d: 0, t: 0 }); M.d++; M.t += tris * cnt; }
      const G = (groups[pathOf(o)] ??= { meshes: 0, draws: 0, tris: 0 });
      G.meshes++; G.draws += mats.length; G.tris += tris * cnt;
    });
    const cat = {};
    for (const [k, v] of Object.entries(groups)) { const c = k.split(">")[0]; const C = (cat[c] ??= { draws: 0, tris: 0 }); C.draws += v.draws; C.tris += v.tris; }
    const topCat = Object.entries(cat).sort((a, b) => b[1].tris - a[1].tris).slice(0, 10).map(([k, v]) => `${k} d${v.draws} t${Math.round(v.tris / 1000)}k`);
    texList.sort((a, b) => b[4] - a[4]);
    const top = (key) => Object.entries(groups).sort((a, b) => b[1][key] - a[1][key]).slice(0, 8).map(([k, v]) => `${k} d${v.draws} t${v.tris}`);
    return {
      calls: avg("calls"), triangles: avg("triangles"), textures: avg("textures"), geometries: avg("geometries"),
      programs: gl.info.programs?.length ?? 0, uploadedTextures: n, textureMB: Math.round(bytes / 1048576 * 10) / 10,
      pr: gl.getPixelRatio(), size: [gl.domElement.width, gl.domElement.height],
      topDraws: top("draws"), topTris: top("tris"), topCat, topMat: Object.entries(matDraws).sort((a, b) => b[1].d - a[1].d).slice(0, 10).map(([k, v]) => `${k} d${v.d} t${Math.round(v.t / 1000)}k`), topTex: texList.slice(0, 8).map((t) => t.join(" ")),
    };
  });
  const fs = await page.evaluate(() => window.__cv.getFrameStats(4000));
  results[name] = { ...info, frame: { mean: Math.round(fs.meanMs * 10) / 10, p95: Math.round(fs.p95Ms * 10) / 10, max: Math.round(fs.maxMs) } };
  console.log(name.padEnd(11), `draws ${info.calls}  tris ${info.triangles}  tex ${info.uploadedTextures} ${info.textureMB}MB  geo ${info.geometries}  prog ${info.programs}  frame mean ${results[name].frame.mean} p95 ${results[name].frame.p95} max ${results[name].frame.max}`);
  console.log("   topDraws", JSON.stringify(info.topDraws.slice(0, 5)));
  console.log("   topTris ", JSON.stringify(info.topTris.slice(0, 5)));
  console.log("   topCat  ", JSON.stringify(info.topCat));
  console.log("   topMat  ", JSON.stringify(info.topMat));
  console.log("   topTex  ", JSON.stringify(info.topTex.slice(0, 6)));
  writeFileSync(join(args.out, `spots-${args.label}-${args.device}.json`), JSON.stringify(results, null, 2));
  if (args.shots) await page.screenshot({ path: join(args.out, `spot-${args.label}-${args.device}-${name}.png`) });
}

const areaNow = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function waitArea(a, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if ((await areaNow()) === a) break; await sleep(150); }
  await page.waitForFunction(() => {
    const c = document.querySelector(".cv-house-cover"), f = document.querySelector(".cv-door-fade"), v = document.querySelector(".cv-veg-veil");
    const gone = (e) => !e || getComputedStyle(e).opacity === "0" || getComputedStyle(e).display === "none";
    return gone(c) && gone(f) && gone(v);
  }, null, { timeout: 40000 }).catch(() => {});
  await sleep(2000);
  return (await areaNow()) === a;
}
/** To a lot's door by the village's own way, and in. */
async function enterLot(unit) {
  const info = await page.evaluate(async (unit) => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const r = L.LOT_ROOMS.find((x) => x.unit.id === unit);
    const d = L.lotDoorPoint(r.lot, r.door);
    const m = await window.__imp("/src/village/villagePlaces.ts");
    const at = window.__cv.getPos();
    return { lot: r.lot.id, area: r.area, pad: d.pad, arrival: d.arrival, way: m.wayTo(m.mapPlace(r.lot.id), at.x, at.z) };
  }, unit);
  for (const w of info.way) await walkAndWait(p, w.x, w.z, 40000, 1.5);
  await walkAndWait(p, info.arrival.x, info.arrival.z, 20000, 0.8);
  await walkAndWait(p, info.pad.x, info.pad.z, 20000, 0.6);
  await sleep(1500);
  await act(p);
  return waitArea(info.area);
}
async function exitLot() {
  // the way out: the door pad of the room (LotRoom exit) - walk to the room's exit marker through the area's own door
  const exit = await page.evaluate(async () => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const a = await window.__imp("/src/village/villageArea.ts");
    const cur = a.localArea();
    const r = L.LOT_ROOMS.find((x) => x.area === cur);
    return r ? L.lotRoomDoor(r) : null;
  });
  if (!exit) return;
  await walkAndWait(p, exit.x, exit.z, 20000, 0.6);
  await sleep(500);
  await act(p);
  await waitArea("village");
}
async function villageAt(x, z, via = []) {
  await page.evaluate(() => { window.__cvShot = null; });
  for (const [vx, vz] of via) await walkAndWait(p, vx, vz, 45000, 2);
  await walkAndWait(p, x, z, 45000, 1.2);
}
/** The same view every run: the photo camera (window.__cvShot) at a fixed place, so the numbers compare across builds. */
async function shot(x, y, z, tx, ty, tz, fov = 70) {
  await page.evaluate((v) => { window.__cvShot = v; }, { x, y, z, tx, ty, tz, fov });
  await sleep(2500);
}

async function spot(name, fn) {
  if (!SPOTS.includes(name)) return;
  try {
    await fn();
  } catch (e) {
    console.log(`!! ${name}: ${e.message}`);
    results[name] = { error: e.message };
  }
}

await spot("plaza", async () => {
  await villageAt(0, 14);
  await shot(0, 1.7, 26, 0, 2.5, 4);
  await measure("plaza");
});
await spot("gate", async () => {
  await villageAt(-24, 70, [[0, 40]]);
  await shot(-24, 1.7, 70, -24, 3, 92);
  await measure("gate");
});
await spot("lake", async () => {
  await villageAt(100, -12, [[0, 14], [40, 0], [80, -9]]);
  await shot(96, 1.8, -10, 118, 1, -12);
  await measure("lake");
});
await spot("temple", async () => {
  await villageAt(-45, -37, [[0, 14], [0, -20], [-30, -30]]);
  await shot(-42, 1.8, -37, -52, 3, -37);
  await measure("temple");
});
await spot("school", async () => {
  await villageAt(50, 15, [[0, 14]]);
  await shot(48, 1.8, 15, 58, 3, 15);
  await measure("school");
});
await spot("library", async () => {
  await villageAt(-46, 15, [[0, 14], [-30, 15]]);
  await shot(-44, 1.8, 15, -56, 3, 12);
  await measure("library");
});
await page.evaluate(() => { window.__cvShot = null; });
await spot("hall", async () => {
  await villageAt(0, 14);
  await enterHall(p);
  await measure("hall");
  await leaveHall(p);
});
await spot("house", async () => {
  await villageAt(21, -39.3, [[0, 14], [0, -20], [15, -34], [21, -37.15]]);
  await act(p);
  await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
  for (const c of "1004") await press(p, p.page.locator(`.cv-keypad button[data-key="${c}"]`));
  await press(p, p.page.locator('.cv-keypad button[data-key="ok"]'));
  await waitArea("house:house_1:1", 25000);
  await measure("house");
  const pad = await page.evaluate(async () => (await window.__imp("/village/houseAreas.ts")).HOUSE_PLACES[1].exitPad);
  await walkAndWait(p, pad.x, pad.z, 20000, 0.5);
  await act(p);
  await waitArea("village");
});
await spot("school_in", async () => {
  if ((await areaNow()) !== "village") await exitLot();
  if (!(await enterLot("lot_school_class"))) throw new Error("did not enter the classroom");
  await measure("school_in");
  await exitLot();
});
await spot("library_in", async () => {
  if ((await areaNow()) !== "village") await exitLot();
  if (!(await enterLot("lot_library_reading"))) throw new Error("did not enter the reading room");
  await measure("library_in");
  await exitLot();
});

writeFileSync(join(args.out, `spots-${args.label}-${args.device}.json`), JSON.stringify(results, null, 2));
console.log("errors", JSON.stringify(run.errors).slice(0, 600));
await b.close();
process.exit(0);
