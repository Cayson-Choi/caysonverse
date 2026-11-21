/**
 * e2e/uv-stretch-audit.mjs - flags faces with strongly anisotropic / very low texel density UVs in the LIVE scene (every Mesh with a
 * `map`, world units): per triangle the UV->world Jacobian's singular values (stretch = max/min), grouped by mesh + material.
 *
 *   CV_CLIENT_URL=http://localhost:5641 node e2e/uv-stretch-audit.mjs <out.json> [desktop|phone] [area=village|park]
 *
 * A face is flagged when stretch > 3 and its world area > UV_AREA_MIN (0.05) m^2; UV_BOX=x0,x1,z0,z1 limits the region (atlas-cell surfaces are expected: listed, not failed).
 */
import { writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const [OUT, DEV = "desktop"] = process.argv.slice(2);
const run = createRun("uv-stretch-audit");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("audit");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
await sleep(8000);
const AMIN = Number(process.env.UV_AREA_MIN || 0.05);
const BOX = (process.env.UV_BOX || "").split(",").map(Number); // x0,x1,z0,z1 (world), empty = everything
const res = await P.page.evaluate(([AMIN, BOX]) => {
  const { scene } = window.__cvThree();
  scene.updateMatrixWorld(true);
  const out = {};
  let tris = 0;
  const A = [0, 0, 0], B = [0, 0, 0], C = [0, 0, 0];
  scene.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
    const g = o.geometry, pos = g.attributes.position, uv = g.attributes.uv;
    if (!pos || !uv) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    const e = o.matrixWorld.elements;
    const w = (i, r) => {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      r[0] = e[0] * x + e[4] * y + e[8] * z + e[12];
      r[1] = e[1] * x + e[5] * y + e[9] * z + e[13];
      r[2] = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    const n = g.index ? g.index.count : pos.count;
    const groups = g.groups.length ? g.groups : [{ start: 0, count: n, materialIndex: 0 }];
    for (const gr of groups) {
      const m = mats[gr.materialIndex ?? 0] ?? mats[0];
      if (!m || !m.map || m.transparent) continue;
      for (let t = gr.start; t + 2 < gr.start + gr.count; t += 3) {
        const i0 = g.index ? g.index.getX(t) : t, i1 = g.index ? g.index.getX(t + 1) : t + 1, i2 = g.index ? g.index.getX(t + 2) : t + 2;
        w(i0, A); w(i1, B); w(i2, C);
        const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
        const nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
        const area = Math.hypot(nx, ny, nz) / 2;
        if (area < AMIN) continue;
        if (BOX.length === 4 && !(A[0] >= BOX[0] && A[0] <= BOX[1] && A[2] >= BOX[2] && A[2] <= BOX[3])) continue;
        tris++;
        const du1 = [uv.getX(i1) - uv.getX(i0), uv.getY(i1) - uv.getY(i0)], du2 = [uv.getX(i2) - uv.getX(i0), uv.getY(i2) - uv.getY(i0)];
        // metric tensor of the uv->world map: world lengths per uv unit along the two uv axes
        const l1 = Math.hypot(...e1), l2 = Math.hypot(...e2), d12 = e1[0] * e2[0] + e1[1] * e2[1] + e1[2] * e2[2];
        // solve for dX/du, dX/dv in the face plane: [e1 e2] = [Xu Xv] * [du1 du2]  (2x2 inverse)
        const det = du1[0] * du2[1] - du1[1] * du2[0];
        if (Math.abs(det) < 1e-12) { (out[`${o.name || o.parent?.name}|${m.name}`] ||= { n: 0, degenerate: 0, area: 0 }).degenerate++; continue; }
        const iu = [du2[1] / det, -du1[1] / det], iv = [-du2[0] / det, du1[0] / det];
        const Xu = [0, 1, 2].map((k) => e1[k] * iu[0] + e2[k] * iu[1]), Xv = [0, 1, 2].map((k) => e1[k] * iv[0] + e2[k] * iv[1]);
        const a = Xu[0] ** 2 + Xu[1] ** 2 + Xu[2] ** 2, c = Xv[0] ** 2 + Xv[1] ** 2 + Xv[2] ** 2, b = Xu[0] * Xv[0] + Xu[1] * Xv[1] + Xu[2] * Xv[2];
        const tr = a + c, dd = Math.sqrt(Math.max(0, (a - c) ** 2 + 4 * b * b));
        const s1 = Math.sqrt((tr + dd) / 2), s2 = Math.sqrt(Math.max(1e-18, (tr - dd) / 2)); // metres per uv unit, max / min
        const stretch = s1 / s2;
        if (stretch <= 3) continue;
        const k = `${o.name || o.parent?.name || "?"}|${m.name || "?"}`;
        const r = (out[k] ||= { n: 0, degenerate: 0, area: 0, worst: 0, at: null });
        r.n++; r.area += area;
        if (stretch > r.worst) { r.worst = stretch; r.at = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3].map((v) => Math.round(v * 10) / 10); }
      }
    }
  });
  return { tris, out };
}, [AMIN, BOX]);
const list = Object.entries(res.out).map(([k, v]) => ({ k, ...v, area: Math.round(v.area * 10) / 10 })).sort((a, b) => b.area - a.area);
writeFileSync(OUT, JSON.stringify({ trisChecked: res.tris, flagged: list }, null, 1));
console.log("checked", res.tris, "flagged groups", list.length);
for (const r of list.slice(0, 40)) console.log(r.k, "faces", r.n, "area", r.area, "worst", Math.round(r.worst), "at", JSON.stringify(r.at));
await browser.close();
process.exit(0);
