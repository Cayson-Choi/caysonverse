/**
 * e2e/ext-pick.mjs — the exteriors audit's "what is this surface?" probe: from fixed photo cameras (window.__cvShot), raycast the scene
 * at screen points and print the hit mesh, its material, the uv, the vertex colour and the world point / normal.
 *
 *   CV_CLIENT_URL=http://localhost:5595 node e2e/ext-pick.mjs <picks.json> [--park]
 *   picks.json: [{ "name": "memorial-back", "cam": [x,y,z], "look": [x,y,z], "fov": 55, "pts": [[0.5,0.5], [0.2,0.7]] }]  (pts: 0..1 of the screen, y down)
 */
import { readFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const picks = JSON.parse(readFileSync(process.argv[2], "utf8"));
const park = process.argv.includes("--park");
const run = createRun("ext-pick");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "d", device: DESKTOP, settings: { graphics: "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("pick");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 180000 });
await P.page.evaluate(() => window.__cvLotsForce?.(2));
await sleep(10000);
if (park) {
  const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await P.page.evaluate(async ([x, z]) => {
    const move = await window.__imp("/src/game/clickMove.ts");
    const plan = await window.__imp("/src/game/clickPlan.ts");
    const am = await window.__imp("/src/game/activeMap.ts");
    const me = window.__cv.getPos();
    const via = plan.findDetour(me.x, me.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
    move.setClickTarget(x, z, 0, via ?? undefined);
  }, [g.x, g.z - 0.5]);
  for (let i = 0; i < 240 && (await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) !== null; i++) await sleep(250);
  await act(P);
  await sleep(12000);
}
for (const pk of picks) {
  await P.page.evaluate(([c, l, fov]) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov }), [pk.cam, pk.look, pk.fov ?? 55]);
  await sleep(2500);
  const hits = await P.page.evaluate(async (pts) => {
    const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
    const { scene, camera } = window.__cvThree();
    const rc = new THREE.Raycaster();
    const out = [];
    for (const [sx, sy] of pts) {
      rc.setFromCamera(new THREE.Vector2(sx * 2 - 1, -(sy * 2 - 1)), camera);
      const hs = rc.intersectObjects(scene.children, true).filter((h) => h.object.visible && h.object.isMesh);
      const h = hs[0];
      if (!h) { out.push({ pt: [sx, sy], none: true }); continue; }
      const m = [].concat(h.object.material)[h.face?.materialIndex ?? 0] ?? [].concat(h.object.material)[0];
      const g = h.object.geometry;
      const col = g.getAttribute("color");
      const path = [];
      for (let o = h.object; o && path.length < 5; o = o.parent) path.push(o.name || o.type);
      out.push({
        pt: [sx, sy],
        path: path.join(" < "),
        mat: m?.name || m?.type,
        mtype: m?.type,
        map: !!m?.map, nmap: !!m?.normalMap,
        uv: h.uv ? [+h.uv.x.toFixed(3), +h.uv.y.toFixed(3)] : null,
        col: col && h.face ? [col.getX(h.face.a), col.getY(h.face.a), col.getZ(h.face.a)].map((v) => +v.toFixed(3)) : null,
        p: [h.point.x, h.point.y, h.point.z].map((v) => +v.toFixed(2)),
        n: h.face ? [h.face.normal.x, h.face.normal.y, h.face.normal.z].map((v) => +v.toFixed(2)) : null,
        dist: +h.distance.toFixed(1),
      });
    }
    return out;
  }, pk.pts);
  console.log(`== ${pk.name}`);
  for (const h of hits) console.log(JSON.stringify(h));
}
await browser.close();
process.exit(0);
