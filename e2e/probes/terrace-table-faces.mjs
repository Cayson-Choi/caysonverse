/**
 * e2e/probes/terrace-table-faces.mjs — what the café terrace's round tables are made of in village.glb (prop sweep 2026-11-28): every
 * triangle whose centroid is in a box round each table's top: mesh, material, vertex colour, uv, normal, y range.
 *   CV_CLIENT_URL=http://localhost:5627 node e2e/probes/terrace-table-faces.mjs
 */
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "../lib/common.mjs";

const run = createRun("terrace-table-faces");
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "probe", device: DESKTOP });
const page = p.page;
await page.goto(`${CLIENT_URL}/?time=2026-11-03T12:30`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("probe" + Math.floor(Math.random() * 900 + 100));
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await sleep(6000);
const out = await page.evaluate(() => {
  const { scene } = window.__cvThree();
  const boxes = [[41.6, 0.4, -18.4, 43.0, 0.9, -16.8], [41.6, 0.4, -13.4, 43.0, 0.9, -11.8]];
  const res = [];
  scene.updateMatrixWorld(true);
  scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.getAttribute) return;
    const g = o.geometry, pos = g.getAttribute("position"), col = g.getAttribute("color"), uv = g.getAttribute("uv");
    if (!pos) return;
    const idx = g.getIndex();
    const n = idx ? idx.count : pos.count;
    const V = o.position.constructor;
    const a = new V(), b = new V(), c = new V();
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) for (let i = gr.start; i < gr.start + gr.count; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, ia).applyMatrix4(o.matrixWorld); b.fromBufferAttribute(pos, ib).applyMatrix4(o.matrixWorld); c.fromBufferAttribute(pos, ic).applyMatrix4(o.matrixWorld);
      const cx = (a.x + b.x + c.x) / 3, cy = (a.y + b.y + c.y) / 3, cz = (a.z + b.z + c.z) / 3;
      const k = boxes.findIndex((B) => cx > B[0] && cx < B[3] && cy > B[1] && cy < B[4] && cz > B[2] && cz < B[5]);
      if (k < 0) continue;
      const n3 = new V().subVectors(b, a).cross(new V().subVectors(c, a)).normalize();
      res.push({ k, mesh: o.name, mat: mats[gr.materialIndex ?? 0]?.name, col: col ? [col.getX(ia), col.getY(ia), col.getZ(ia)].map((x) => +x.toFixed(3)) : null,
        uv: uv ? [+uv.getX(ia).toFixed(3), +uv.getY(ia).toFixed(3)] : null, n: [n3.x, n3.y, n3.z].map((x) => +x.toFixed(2)), y: [Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y)].map((x) => +x.toFixed(3)),
        r: +Math.hypot(cx - 42.3, cz - (k ? -12.6 : -17.6)).toFixed(3) });
    }
  });
  return res;
});
const key = (r) => `${r.k}|${r.mesh}|${r.mat}|${JSON.stringify(r.col)}|${JSON.stringify(r.uv)}`;
const groups = {};
for (const r of out) { const k = key(r); (groups[k] ??= { n: 0, y: [9, -9], r: 0, ny: [] }); const G = groups[k]; G.n++; G.y = [Math.min(G.y[0], r.y[0]), Math.max(G.y[1], r.y[1])]; G.r = Math.max(G.r, r.r); if (G.ny.length < 4) G.ny.push(r.n[1]); }
for (const [k, v] of Object.entries(groups)) console.log(k, JSON.stringify(v));
await browser.close();
