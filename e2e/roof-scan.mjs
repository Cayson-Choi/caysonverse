/** e2e/roof-scan.mjs — 마을 바닥 격자에서 머리 위 1.6 m 안에 무엇이 있는지(점프 막힘 후보) 이름별로 모아요. */
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const run = createRun("roof-scan");
const browser = await launchBrowser();
try {
  const p = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
  await joinVillage(p, "지붕");
  await sleep(6000);
  const res = await p.page.evaluate(async () => {
    const cp = await window.__imp("/src/game/clickPick.ts");
    const T = await window.__imp("/deps/three.js");
    const { scene } = window.__cvThree();
    const ray = new T.Raycaster();
    const up = new T.Vector3(0, 1, 0);
    const names = {};
    for (let x = -120; x <= 160; x += 2)
      for (let z = -120; z <= 160; z += 2) {
        const g = cp.surfaceHeightAt(ray, scene, x, z, NaN);
        if (!(g > -0.2 && g < 0.6)) continue; // not walkable ground (a hill, water, a roof)
        ray.set(new T.Vector3(x, g + 2.2, z), up);
        ray.near = 0;
        ray.far = 1.6;
        const hit = cp.pickSurface(ray, scene, { skipBlockers: true });
        if (hit) {
          const n = hit.name;
          names[n] ??= { n: 0, at: [], y: Math.round(hit.y * 100) / 100 };
          if (names[n].at.length < 6) names[n].at.push([x, z]);
          names[n].n++;
        }
      }
    return names;
  });
  for (const [k, v] of Object.entries(res).sort((a, b) => b[1].n - a[1].n)) console.log(v.n, k, JSON.stringify(v.at), v.y);
} finally {
  await browser.close();
}
