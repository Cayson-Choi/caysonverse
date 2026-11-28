/**
 * e2e/scene-census.mjs — what the per-frame scene-graph pass walks (perf/100, 2026-11-28). three's renderer calls
 * scene.updateMatrixWorld() every frame and projectObject() walks every visible node, so the number of nodes (and of nodes whose
 * matrix is recomposed each frame: matrixAutoUpdate) is a direct cost on a phone. This joins the village, stands at the given
 * spots and prints, per subtree (the scene's children and one level below), the node count, the auto-updating nodes, the visible
 * meshes and the draw calls / triangles of one frame.
 *
 *   CV_CLIENT_URL=http://localhost:5625 node e2e/scene-census.mjs [--device phone|pc] [--spots plaza,houserow] [--out <file>]
 */
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: { device: { type: "string", default: "phone" }, spots: { type: "string", default: "plaza,houserow" }, out: { type: "string" } },
});
const PHONE_DEV = args.device === "phone";
const SPOTS = { plaza: [0, 12], houserow: [-11, -45] };
const run = createRun("scene-census");
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "C", device: PHONE_DEV ? PHONE : DESKTOP, settings: PHONE_DEV ? { graphics: "low" } : {} });
const result = {};
try {
  await joinVillage(p, "Cs");
  await sleep(8000);
  for (const name of args.spots.split(",")) {
    const [x, z] = SPOTS[name];
    await walkAndWait(p, x, z, 40000, 1.5);
    await sleep(4000);
    result[name] = await p.page.evaluate(() => {
      const t = window.__cvThree();
      const groups = new Map();
      const keyOf = (path) => path.slice(0, 2).join(" / ");
      // transparent double-sided materials drawn in two passes (three marks them changed before each: a program re-check per draw)
      const twoPass = new Map();
      let total = 0, auto = 0, meshes = 0, visibleMeshes = 0;
      const walk = (o, path, visible) => {
        const vis = visible && o.visible;
        const k = keyOf(path);
        let g = groups.get(k);
        if (!g) groups.set(k, (g = { nodes: 0, auto: 0, visibleNodes: 0, meshes: 0, visibleMeshes: 0, bones: 0 }));
        g.nodes++;
        total++;
        if (o.matrixAutoUpdate) (g.auto++, auto++);
        if (vis) g.visibleNodes++;
        if (o.isBone) g.bones++;
        const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
        if (vis) for (const m of mats) if (m.transparent && m.side === 2 && !m.forceSinglePass) twoPass.set(`${m.type}:${m.name || "?"} @ ${path.slice(-2).join("/")}`, (twoPass.get(`${m.type}:${m.name || "?"} @ ${path.slice(-2).join("/")}`) ?? 0) + 1);
        if (o.isMesh || o.isPoints || o.isLine || o.isSprite) {
          g.meshes++;
          meshes++;
          if (vis) (g.visibleMeshes++, visibleMeshes++);
        }
        for (const c of o.children) walk(c, [...path, c.name || c.type], vis);
      };
      walk(t.scene, [], true);
      const info = t.gl.info;
      return {
        twoPass: [...twoPass].sort((a, b) => b[1] - a[1]).slice(0, 20),
        total, auto, meshes, visibleMeshes, calls: info.render.calls, triangles: info.render.triangles,
        groups: [...groups].sort((a, b) => b[1].nodes - a[1].nodes).slice(0, 40).map(([k, g]) => ({ k, ...g })),
      };
    });
    const r = result[name];
    console.log(`\n== ${name}: ${r.total} nodes (${r.auto} auto-update), ${r.meshes} meshes (${r.visibleMeshes} visible), ${r.calls} calls, ${r.triangles} tris`);
    console.log("two-pass transparent materials:", JSON.stringify(r.twoPass));
    for (const g of r.groups.slice(0, 25)) console.log(`${String(g.nodes).padStart(6)} nodes ${String(g.auto).padStart(6)} auto ${String(g.visibleNodes).padStart(6)} vis ${String(g.visibleMeshes).padStart(5)} visMesh ${String(g.bones).padStart(4)} bones  ${g.k}`);
  }
} finally {
  if (args.out) writeFileSync(args.out, JSON.stringify(result, null, 1));
  await b.close();
}
