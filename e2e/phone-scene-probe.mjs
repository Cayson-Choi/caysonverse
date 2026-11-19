/**
 * e2e/phone-scene-probe.mjs — what the phone profile draws on the plaza: per top-level scene group, the visible meshes,
 * draw calls and triangles (frustum-culled by hand the way three does), plus renderer state (shadows, pixel ratio,
 * passes). perf/phone-village, 2026-11-19.
 *   CV_CLIENT_URL=http://localhost:5981 node e2e/phone-scene-probe.mjs [--device phone|pc] [--out <dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const { values: args } = parseArgs({ options: { device: { type: "string", default: "phone" }, out: { type: "string", default: "D:/ClaudeCode/tmpshots/phone-perf" }, label: { type: "string", default: "scene" } } });
const PH = args.device === "phone";
mkdirSync(args.out, { recursive: true });
const run = createRun("phone-scene-probe");
run.evidence = args.out;
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "V", device: PH ? PHONE : DESKTOP, settings: PH ? { graphics: "low" } : {} });
await joinVillage(p, "Pf");
await walkAndWait(p, 0, 14, 25000, 1.5);
await sleep(6000);
const out = await p.page.evaluate(() => {
  const t = window.__cvThree();
  const { scene, camera, gl } = t;
  camera.updateMatrixWorld();
  const THREE = camera.projectionMatrix.constructor;
  const info = { shadowEnabled: gl.shadowMap.enabled, shadowType: gl.shadowMap.type, pr: gl.getPixelRatio(), size: [gl.domElement.width, gl.domElement.height], programs: gl.info.programs?.length, textures: gl.info.memory.textures, geometries: gl.info.memory.geometries };
  // frustum from camera
  const m = camera.projectionMatrix.clone().multiply(camera.matrixWorldInverse);
  const e = m.elements;
  const planes = [];
  for (const [i, s] of [[0, 1], [0, -1], [1, 1], [1, -1], [2, 1], [2, -1]]) {
    const a = e[3] + s * e[i], bb = e[7] + s * e[i + 4], c = e[11] + s * e[i + 8], d = e[15] + s * e[i + 12];
    const l = Math.hypot(a, bb, c); planes.push([a / l, bb / l, c / l, d / l]);
  }
  const inFrustum = (o) => {
    if (o.frustumCulled === false) return true;
    const g = o.geometry; if (!g) return true;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const sp = g.boundingSphere; if (!sp) return true;
    const c = sp.center.clone().applyMatrix4(o.matrixWorld);
    const sc = o.matrixWorld.getMaxScaleOnAxis();
    let r = sp.radius * sc;
    if (o.isInstancedMesh) return true;
    for (const pl of planes) if (pl[0] * c.x + pl[1] * c.y + pl[2] * c.z + pl[3] < -r) return false;
    return true;
  };
  const groups = {};
  const isVis = (o) => { for (let q = o; q; q = q.parent) if (!q.visible) return false; return true; };
  const pathOf = (o) => {
    const names = []; for (let q = o; q && q !== scene; q = q.parent) names.unshift(q.name || q.type);
    return names.slice(0, 3).join(">");
  };
  let total = { meshes: 0, tris: 0, instTris: 0 };
  const mats = {};
  scene.traverse((o) => {
    if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !isVis(o)) return;
    if (!inFrustum(o)) return;
    const g = o.geometry; if (!g) return;
    const idx = g.index ? g.index.count : (g.attributes.position?.count ?? 0);
    let tris = Math.floor(idx / 3);
    const n = o.isInstancedMesh ? o.count : 1;
    if (g.drawRange && g.drawRange.count !== Infinity) tris = Math.min(tris, Math.floor(g.drawRange.count / 3));
    const mat = Array.isArray(o.material) ? o.material : [o.material];
    const key = pathOf(o);
    const G = (groups[key] ??= { meshes: 0, draws: 0, tris: 0, inst: 0, transparent: 0, cast: 0 });
    G.meshes++; G.draws += mat.length; G.tris += tris * n; if (o.isInstancedMesh) G.inst++;
    if (mat.some((x) => x && x.transparent)) G.transparent++;
    if (o.castShadow) G.cast++;
    for (const x of mat) if (x) { const k = x.type + (x.transparent ? "/T" : "") + (x.alphaTest ? "/A" : "") + (x.side === 2 ? "/D" : ""); const M = (mats[k] ??= { n: 0, tris: 0 }); M.n++; M.tris += tris * n; }
    total.meshes++; total.tris += tris * n;
  });
  const lights = []; scene.traverse((o) => { if (o.isLight) lights.push({ t: o.type, shadow: !!o.castShadow, mapSize: o.shadow?.mapSize?.toArray() }); });
  const top = Object.entries(groups).sort((a, b) => b[1].tris - a[1].tris).slice(0, 40);
  const topDraws = Object.entries(groups).sort((a, b) => b[1].draws - a[1].draws).slice(0, 25);
  return { info, total, lights, mats, top, topDraws, camera: camera.position.toArray(), fov: camera.fov, far: camera.far };
});
console.log(JSON.stringify(out, null, 1));
writeFileSync(join(args.out, `${args.label}-${args.device}.json`), JSON.stringify(out, null, 2));
await p.page.screenshot({ path: join(args.out, `${args.label}-${args.device}.png`) });
await b.close();
process.exit(0);
