/**
 * Coplanar-face audit (z-fighting): inside each box, every pair of same-facing triangles of the drawn meshes that lie in one plane (within
 * EPS m) and overlap is listed - two faces in one plane fight for the depth buffer and crawl as the camera moves.
 *   node e2e/probe.mjs e2e/probes/coplanar.mjs <out> desktop <time> -- park|village name:x0,x1,y0,y1,z0,z1 ...
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export default async ({ P, OUT, args, enterPark, sleep }) => {
  const [where, ...boxes] = args;
  if (where === "park") await enterPark();
  await sleep(3000);
  const all = {};
  for (const spec of boxes) {
    const [name, nums] = spec.split(":");
    const b = nums.split(",").map(Number);
    const res = await P.page.evaluate(
      ([b, EPS]) => {
        const { scene } = window.__cvThree();
        const tris = [];
        const V = scene.position.constructor;
        const a = new V(), c = new V(), d = new V(), n = new V(), e1 = new V(), e2 = new V(), im = scene.matrixWorld.clone();
        const label = (o, m) => {
          const names = [];
          for (let q = o; q && names.length < 3; q = q.parent) if (q.name) names.push(q.name);
          const src = m?.map?.image?.currentSrc || m?.map?.image?.src || m?.map?.name || "";
          const col = m?.color ? "#" + m.color.getHexString() : "";
          return `${names.join("<") || o.type}#${o.id}/${m?.name || m?.type}${col}${src ? "[" + String(src).split("/").pop().slice(0, 28) + "]" : ""}${m?.polygonOffset ? "(po" + m.polygonOffsetFactor + ")" : ""}${o.renderOrder ? "(ro" + o.renderOrder + ")" : ""}`;
        };
        const inBox = (p) => p.x >= b[0] && p.x <= b[1] && p.y >= b[2] && p.y <= b[3] && p.z >= b[4] && p.z <= b[5];
        scene.traverse((o) => {
          if (!o.isMesh || o.isSkinnedMesh || !o.geometry?.attributes?.position) return;
          for (let q = o; q; q = q.parent) if (!q.visible) return;
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          if (mats.every((m) => !m || m.visible === false || (m.transparent && m.depthWrite === false))) return;
          const g = o.geometry, pos = g.attributes.position, idx = g.index;
          if (!g.boundingBox) g.computeBoundingBox();
          const count = idx ? idx.count : pos.count;
          const inst = o.isInstancedMesh ? o.count : 1;
          if (count * inst > 900000) return;
          for (let k = 0; k < inst; k++) {
            const mw = o.matrixWorld.clone();
            if (o.isInstancedMesh) { o.getMatrixAt(k, im); mw.multiply(im); }
            const bb = g.boundingBox.clone().applyMatrix4(mw);
            if (bb.max.x < b[0] || bb.min.x > b[1] || bb.max.y < b[2] || bb.min.y > b[3] || bb.max.z < b[4] || bb.min.z > b[5]) continue;
            for (let i = 0; i < count; i += 3) {
              const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
              a.fromBufferAttribute(pos, i0).applyMatrix4(mw); c.fromBufferAttribute(pos, i1).applyMatrix4(mw); d.fromBufferAttribute(pos, i2).applyMatrix4(mw);
              if (!inBox(a) && !inBox(c) && !inBox(d)) continue;
              n.crossVectors(e1.subVectors(c, a), e2.subVectors(d, a));
              if (n.length() / 2 < 1e-5) continue;
              n.normalize();
              tris.push({ i: tris.length, p: [a.x, a.y, a.z, c.x, c.y, c.z, d.x, d.y, d.z], n: [n.x, n.y, n.z], d: n.dot(a), m: label(o, mats[0]) });
            }
          }
        });
        // bucket by the plane (normal to 0.02, distance to 2 EPS, twice with a half-cell shift so neighbours meet)
        const buckets = new Map();
        for (const t of tris)
          for (const off of [0, 0.5]) {
            const k = `${Math.round(t.n[0] * 50)},${Math.round(t.n[1] * 50)},${Math.round(t.n[2] * 50)},${Math.floor(t.d / (EPS * 2) + off)},${off}`;
            let l = buckets.get(k);
            if (!l) buckets.set(k, (l = []));
            l.push(t);
          }
        const signedArea = (q) => { let s = 0; for (let i = 0; i < q.length; i++) { const j = (i + 1) % q.length; s += q[i][0] * q[j][1] - q[j][0] * q[i][1]; } return s / 2; };
        const clipArea = (A, B, n) => {
          // both triangles on the plane's dominant axes, Sutherland-Hodgman, the overlap's area
          const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
          const [u, v] = ax >= ay && ax >= az ? [1, 2] : ay >= az ? [0, 2] : [0, 1];
          const tri = (t) => [[t.p[u], t.p[v]], [t.p[3 + u], t.p[3 + v]], [t.p[6 + u], t.p[6 + v]]];
          let subj = tri(A);
          const cl = tri(B);
          if (signedArea(cl) < 0) cl.reverse();
          for (let i = 0; i < 3 && subj.length; i++) {
            const p0 = cl[i], p1 = cl[(i + 1) % 3];
            const ex = p1[0] - p0[0], ey = p1[1] - p0[1];
            const side = (q) => ex * (q[1] - p0[1]) - ey * (q[0] - p0[0]);
            const out = [];
            for (let j = 0; j < subj.length; j++) {
              const s = subj[j], e = subj[(j + 1) % subj.length];
              const ss = side(s), se = side(e);
              if ((ss >= 0) !== (se >= 0)) { const t = ss / (ss - se); out.push([s[0] + (e[0] - s[0]) * t, s[1] + (e[1] - s[1]) * t]); }
              if (se >= 0) out.push(e);
            }
            subj = out;
          }
          return subj.length < 3 ? 0 : Math.abs(signedArea(subj));
        };
        const seen = new Set();
        const pairs = new Map();
        let total = 0;
        for (const list of buckets.values()) {
          if (list.length < 2 || list.length > 5000) continue;
          for (let i = 0; i < list.length; i++)
            for (let j = i + 1; j < list.length; j++) {
              const A = list[i], B = list[j];
              if (Math.abs(A.d - B.d) > EPS) continue;
              if (A.n[0] * B.n[0] + A.n[1] * B.n[1] + A.n[2] * B.n[2] < 0.9995) continue;
              const k = A.i < B.i ? A.i * 4194304 + B.i : B.i * 4194304 + A.i;
              if (seen.has(k)) continue;
              seen.add(k);
              const ar = clipArea(A, B, A.n);
              if (ar < 4e-4) continue;
              total += ar;
              const pk = [A.m, B.m].sort().join("  <>  ") + `  n=${A.n.map((x) => Math.round(x)).join(",")}`;
              let row = pairs.get(pk);
              if (!row) pairs.set(pk, (row = { area: 0, n: 0, at: null, gap: 0 }));
              row.area += ar; row.n++; row.gap = Math.max(row.gap, Math.abs(A.d - B.d));
              if (!row.at) row.at = [(A.p[0] + A.p[3] + A.p[6]) / 3, (A.p[1] + A.p[4] + A.p[7]) / 3, (A.p[2] + A.p[5] + A.p[8]) / 3].map((x) => +x.toFixed(2));
            }
        }
        return { triangles: tris.length, overlapM2: +total.toFixed(4), pairs: [...pairs.entries()].map(([k, v]) => ({ k, area: +v.area.toFixed(4), n: v.n, gapMm: +(v.gap * 1000).toFixed(2), at: v.at })).sort((x, y) => y.area - x.area).slice(0, 30) };
      },
      [b, 0.0015],
    );
    all[name] = res;
    console.log(name, "tris", res.triangles, "coplanar overlap m2", res.overlapM2);
    for (const p of res.pairs.slice(0, 14)) console.log("   ", p.area, "x" + p.n, "gap", p.gapMm, "mm", p.k, JSON.stringify(p.at));
  }
  writeFileSync(join(OUT, `coplanar-${where}-${Date.now() % 100000}.json`), JSON.stringify(all, null, 1));
};
