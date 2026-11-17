/**
 * e2e/remote-matrix.mjs — a remote player's avatar is DRAWN where it stands (hotfix fix/remote-origin).
 * B walks away from the fountain and stands still; A looks at B's avatar group: its matrixWorld position must equal B's position
 * (three 0.185 leaves a group's own matrixWorld alone when matrixWorldAutoUpdate is off, which RemotePlayer switches off).
 * Cases: A near B, and A far from B (the far-LOD refresh cadence). Also B walking, to see it follow.
 *   CV_CLIENT_URL=http://localhost:5411 node e2e/remote-matrix.mjs [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait, pos } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun("remote-matrix");
if (outArg) run.evidence = outArg.slice(6);
mkdirSync(run.evidence, { recursive: true });
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: DESKTOP });
const B = await openPlayer(b, run, { tag: "B", device: DESKTOP });
await joinVillage(A, "Ma");
await joinVillage(B, "Mb");

/** B's avatar as A's scene draws it: the group (child of the Scene) holding a skinned mesh, nearest to B's reported position. */
const drawn = (P, want) =>
  P.page.evaluate(([x, z]) => {
    const t = window.__cvThree();
    let best = null;
    t.scene.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      let g = o.parent;
      while (g && !(g.parent && g.parent.type === "Scene")) g = g.parent;
      if (!g || g.matrixAutoUpdate !== false) return; // remotes only: the local avatar keeps its automatic update
      const d = Math.hypot(g.position.x - x, g.position.z - z);
      if (!best || d < best.d) best = { d, pos: [g.position.x, g.position.z], world: [g.matrixWorld.elements[12], g.matrixWorld.elements[14]], mwau: g.matrixWorldAutoUpdate };
    });
    // far avatars (perf/crowd) are drawn as an instance of the crowd mesh, not as a skinned group: the instance's position counts
    t.scene.traverse((o) => {
      if (o.name !== "avatar__impostors" || !o.isInstancedMesh) return;
      const e = o.instanceMatrix.array;
      for (let i = 0; i < o.count; i++) {
        const sx = e[i * 16] ** 2 + e[i * 16 + 5] ** 2;
        if (sx === 0) continue; // a free slot
        const d = Math.hypot(e[i * 16 + 12] - x, e[i * 16 + 14] - z);
        if (!best || d < best.d) best = { d, pos: [e[i * 16 + 12], e[i * 16 + 14]], world: [e[i * 16 + 12], e[i * 16 + 14]], mwau: "instance" };
      }
    });
    return best;
  }, want);

await run.step("B stands away from the fountain", async () => {
  await walkAndWait(B, 30, 30, 40000, 1.2);
  await sleep(2500);
  const pb = await pos(B);
  run.check("B stands at (30, 30)", Math.hypot(pb.x - 30, pb.z - 30) < 2, pb);
  for (const [label, at] of [["near", null], ["far", [-60, -20]]]) {
    if (at) {
      await walkAndWait(A, at[0], at[1], 60000, 2);
      await sleep(3000);
    }
    await sleep(2000);
    const d = await drawn(A, [pb.x, pb.z]);
    const ok = !!d && Math.hypot(d.world[0] - pb.x, d.world[1] - pb.z) < 0.5;
    run.check(`A (${label}) draws B where B stands: matrixWorld == B's position`, ok, { b: [pb.x, pb.z], d });
    await run.shot(A, `A-${label}.png`);
  }
});
await run.step("B walks, A far", async () => {
  await walkAndWait(B, 40, -10, 40000, 1.5);
  await sleep(2500);
  const pb = await pos(B);
  const d = await drawn(A, [pb.x, pb.z]);
  run.check("a walking-then-stopped B is drawn at its new spot", !!d && Math.hypot(d.world[0] - pb.x, d.world[1] - pb.z) < 0.5, { b: [pb.x, pb.z], d });
});
const code = run.finish();
await b.close();
process.exit(code);
