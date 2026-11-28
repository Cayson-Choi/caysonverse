/**
 * e2e/walk-clear.mjs — what stands on a walk or at its mouth (owner 2026-11-28: every path straight on its door; the house 5
 * sidewalk lamp stood at the mouth of its new front walk). Joins the village, lets every patch land (lots, houses, street
 * furniture, plants), then scans the scene as drawn: every triangle that stands up (above `--minY`, default 0.12 m: over the
 * cobble and its 7 cm edging) inside a walk's cobble widened by `--pad` (default 0.25 m) — and, for a walk that starts on the
 * ring's sidewalk, the sidewalk in front of its mouth (to r 36.4) — is counted per mesh (instanced meshes per instance).
 * Prints a JSON report: per walk, the meshes that reach into it with their hit box.
 *   CV_CLIENT_URL=http://localhost:5635 node e2e/walk-clear.mjs [--only=walk_house_5,w] [--minY=0.12] [--pad=0.25] [--out=<file>]
 */
import { writeFileSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const only = (arg("only", "") ?? "").split(",").filter(Boolean);
const minY = Number(arg("minY", 0.12));
const pad = Number(arg("pad", 0.25));
const run = createRun("walk-clear");
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
let report = null;
await run.step("join", async () => { await joinVillage(A, "Wc", process.env.TIME ?? "2026-11-03T12:30"); });
await run.step("scan", async () => {
  await A.page.waitForFunction(() => { try { return !!window.__cvLots?.()?.ready; } catch { return false; } }, null, { timeout: 120000 }).catch(() => {});
  await A.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(10000);
  report = await A.page.evaluate(async ([only, minY, pad]) => {
    const G = await window.__imp("/src/village/ground/groundPaths.ts");
    const walks = G.LANES.filter((l) => !only.length || only.includes(l.id)).map((l) => {
      const c = G.laneCobble(l);
      // a ring walk's mouth: the sidewalk in front of it, back to r 36.4 (the curb)
      let line = c.mid;
      if (!l.start) {
        const a = c.mid[0], d = c.mid[1];
        const n = Math.hypot(d.x - a.x, d.z - a.z);
        const back = Math.max(0, Math.hypot(a.x, a.z) - 36.4);
        line = [{ x: a.x - ((d.x - a.x) / n) * back, z: a.z - ((d.z - a.z) / n) * back }, ...c.mid];
      }
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const p of line) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
      const r = c.half + pad;
      return { id: l.id, line, half: c.half, r, box: { minX: minX - r, maxX: maxX + r, minZ: minZ - r, maxZ: maxZ + r }, hits: new Map() };
    });
    const inWalk = (w, x, z) => x >= w.box.minX && x <= w.box.maxX && z >= w.box.minZ && z <= w.box.maxZ && G.polylineDistance(w.line, x, z) < w.r;
    const { scene } = window.__cvThree();
    scene.updateMatrixWorld(true);
    const v = [0, 0, 0].map(() => ({ x: 0, y: 0, z: 0 }));
    const apply = (e, x, y, z, o) => {
      o.x = e[0] * x + e[4] * y + e[8] * z + e[12];
      o.y = e[1] * x + e[5] * y + e[9] * z + e[13];
      o.z = e[2] * x + e[6] * y + e[10] * z + e[14];
    };
    const mul = (a, b) => {
      const o = new Array(16).fill(0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k];
      return o;
    };
    const visible = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };
    const note = (w, key, x, y, z, low) => {
      let h = w.hits.get(key);
      if (!h) w.hits.set(key, (h = { n: 0, minX: x, maxX: x, minZ: z, maxZ: z, maxY: y, low }));
      h.low = Math.min(h.low, low);
      h.n++;
      h.minX = Math.min(h.minX, x); h.maxX = Math.max(h.maxX, x); h.minZ = Math.min(h.minZ, z); h.maxZ = Math.max(h.maxZ, z); h.maxY = Math.max(h.maxY, y);
    };
    let meshes = 0, tris = 0;
    scene.traverse((o) => {
      if (!(o.isMesh || o.isInstancedMesh) || !o.geometry?.attributes?.position || !visible(o)) return;
      const name = `${o.name || "?"}|${(Array.isArray(o.material) ? o.material[0] : o.material)?.name || "?"}`;
      const pos = o.geometry.attributes.position;
      const idx = o.geometry.index;
      const triCount = idx ? idx.count / 3 : pos.count / 3;
      const mats = [];
      if (o.isInstancedMesh) {
        const arr = o.instanceMatrix.array;
        for (let i = 0; i < o.count; i++) mats.push({ key: `${name}#${i}`, e: mul(o.matrixWorld.elements, Array.from(arr.slice(i * 16, i * 16 + 16))) });
      } else mats.push({ key: name, e: o.matrixWorld.elements });
      // quick reject per matrix by the geometry's box
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      meshes++;
      for (const m of mats) {
        const corners = [];
        for (const x of [bb.min.x, bb.max.x]) for (const y of [bb.min.y, bb.max.y]) for (const z of [bb.min.z, bb.max.z]) { const c = { x: 0, y: 0, z: 0 }; apply(m.e, x, y, z, c); corners.push(c); }
        const wb = { minX: Math.min(...corners.map((c) => c.x)), maxX: Math.max(...corners.map((c) => c.x)), minZ: Math.min(...corners.map((c) => c.z)), maxZ: Math.max(...corners.map((c) => c.z)), maxY: Math.max(...corners.map((c) => c.y)) };
        if (wb.maxY < minY) continue;
        const near = walks.filter((w) => wb.maxX >= w.box.minX && wb.minX <= w.box.maxX && wb.maxZ >= w.box.minZ && wb.minZ <= w.box.maxZ);
        if (!near.length) continue;
        for (let t = 0; t < triCount; t++) {
          for (let k = 0; k < 3; k++) {
            const i = idx ? idx.getX(t * 3 + k) : t * 3 + k;
            apply(m.e, pos.getX(i), pos.getY(i), pos.getZ(i), v[k]);
          }
          tris++;
          const top = Math.max(v[0].y, v[1].y, v[2].y);
          if (top < minY) continue;
          const cx = (v[0].x + v[1].x + v[2].x) / 3, cz = (v[0].z + v[1].z + v[2].z) / 3;
          for (const w of near) {
            // the triangle's centroid or any vertex above minY inside the walk
            const low = Math.min(v[0].y, v[1].y, v[2].y);
            if (inWalk(w, cx, cz)) { note(w, m.key, cx, top, cz, low); continue; }
            for (const p of v) if (p.y >= minY && inWalk(w, p.x, p.z)) { note(w, m.key, p.x, p.y, p.z, low); break; }
          }
        }
      }
    });
    const r2 = (n) => Math.round(n * 100) / 100;
    return {
      meshes, tris,
      walks: walks.map((w) => ({
        id: w.id,
        hits: [...w.hits].map(([k, h]) => ({ mesh: k, n: h.n, x: [r2(h.minX), r2(h.maxX)], z: [r2(h.minZ), r2(h.maxZ)], top: r2(h.maxY), low: r2(h.low) })).sort((a, b) => b.n - a.n),
      })),
    };
  }, [only, minY, pad]);
  run.check("scanned", !!report, { meshes: report?.meshes, tris: report?.tris });
});
const out = arg("out", null);
if (report) {
  if (out) writeFileSync(out, JSON.stringify(report, null, 2));
  for (const w of report.walks) {
    console.log(`\n${w.id}: ${w.hits.length ? "" : "clear"}`);
    for (const h of w.hits) console.log(`  ${h.mesh}  n ${h.n}  x ${h.x.join("..")}  z ${h.z.join("..")}  top ${h.top}  low ${h.low}`);
  }
}
const code = run.finish({ report });
await b.close();
process.exit(code);
