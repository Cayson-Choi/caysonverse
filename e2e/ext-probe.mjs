/**
 * e2e/ext-probe.mjs — dumps the village scene's named groups with their world boxes (the exteriors audit's shot list source).
 *   CV_CLIENT_URL=http://localhost:5651 node e2e/ext-probe.mjs --out=<file.json>
 */
import { writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const run = createRun("ext-probe");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", "ext-probe.json");
const browser = await launchBrowser();
try {
  const P = await openPlayer(browser, run, { tag: "d", device: DESKTOP, settings: { graphics: "high" } });
  await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded" });
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill("probe");
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
  await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 180000 });
  await sleep(15000);
  const data = await P.page.evaluate(async () => {
    const THREE = await window.__imp("/node_modules/.vite/deps/three.js").catch(() => null);
    const { scene } = window.__cvThree();
    scene.updateMatrixWorld(true);
    const out = [];
    const box = (o) => {
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9], tris = 0, mats = new Set();
      o.traverse((m) => {
        if (!m.isMesh || !m.visible) return;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        const b = g.boundingBox;
        const e = m.matrixWorld.elements;
        for (const x of [b.min.x, b.max.x]) for (const y of [b.min.y, b.max.y]) for (const z of [b.min.z, b.max.z]) {
          const w = [e[0] * x + e[4] * y + e[8] * z + e[12], e[1] * x + e[5] * y + e[9] * z + e[13], e[2] * x + e[6] * y + e[10] * z + e[14]];
          for (let k = 0; k < 3; k++) { mn[k] = Math.min(mn[k], w[k]); mx[k] = Math.max(mx[k], w[k]); }
        }
        tris += (g.index ? g.index.count : g.getAttribute("position").count) / 3 * (m.isInstancedMesh ? m.count : 1);
        for (const mt of [].concat(m.material)) mats.add(mt.name || mt.type);
      });
      return { min: mn.map((v) => +v.toFixed(1)), max: mx.map((v) => +v.toFixed(1)), tris: Math.round(tris), mats: [...mats].slice(0, 30) };
    };
    const walk = (o, depth, path) => {
      if (depth > 3) return;
      for (const c of o.children) {
        const p = path + "/" + (c.name || c.type);
        let n = 0;
        c.traverse((m) => { if (m.isMesh) n++; });
        if (!n) continue;
        out.push({ path: p, depth, meshes: n, ...box(c) });
        walk(c, depth + 1, p);
      }
    };
    walk(scene, 0, "");
    return out;
  });
  writeFileSync(OUT, JSON.stringify(data, null, 1));
  console.log("groups", data.length);
} finally {
  await browser.close();
}
