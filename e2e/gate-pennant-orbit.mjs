/**
 * e2e/gate-pennant-orbit.mjs - the gate's bunting pennants from every direction: the camera (window.__cvShot) orbits a point between the lamp
 * posts in 24 steps; at each step the pennant InstancedMesh must be drawn (visible, inside the frustum, same instance count) - a direction-
 * dependent cull (a bounding sphere in the wrong frame) fails. Writes one shot per step when OUT is given.
 *
 *   CV_CLIENT_URL=http://localhost:5641 node e2e/gate-pennant-orbit.mjs [outDir] [desktop|phone]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const [OUT, DEV = "desktop"] = process.argv.slice(2);
if (OUT) mkdirSync(OUT, { recursive: true });
const run = createRun("gate-pennant-orbit");
if (OUT) run.evidence = OUT;
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEV, device: DEV === "phone" ? PHONE : DESKTOP, settings: { graphics: DEV === "phone" ? "low" : "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("orbit");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
await sleep(4000);
await P.page.evaluate(() => (window.__cvShot = { x: -24, y: 3, z: 70, tx: -24, ty: 5, tz: 87.5, fov: 60 }));
await P.page.waitForFunction(() => { let f = false; window.__cvThree().scene.traverse((o) => { if (o.isInstancedMesh && /pennant/.test(o.parent?.name + o.name)) { f = true; for (let q = o; q; q = q.parent) if (!q.visible) f = false; } }); return f; }, null, { timeout: 60000 });
// orbit the WEST string's middle (x -33.5, along z): the directions along the string are the ones that used to show the flags edge-on
const centre = [-33.5, 5.0, 87.5];
const rows = [];
for (let i = 0; i < 24; i++) {
  const a = (i / 24) * Math.PI * 2;
  const R = 12;
  const cam = [centre[0] + Math.sin(a) * R, 3.0, centre[2] + Math.cos(a) * R];
  await P.page.evaluate(([c, l]) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: l[0], ty: l[1], tz: l[2], fov: 60 }), [cam, centre]);
  await sleep(1500);
  const r = await P.page.evaluate(async () => {
    const { scene, camera } = window.__cvThree();
    let mesh = null;
    scene.traverse((o) => { if (o.isInstancedMesh && /pennant/.test(o.parent?.name + o.name)) mesh = o; });
    if (!mesh) return { found: false };
    let vis = true;
    for (let o = mesh; o; o = o.parent) if (!o.visible) vis = false;
    // drawn = onBeforeRender fires only for meshes that survived the frustum cull (counted over 3 frames)
    let drawn = 0;
    const prev = mesh.onBeforeRender;
    mesh.onBeforeRender = (...a) => { drawn++; return prev?.apply(mesh, a); };
    for (let k = 0; k < 3; k++) await new Promise((r) => requestAnimationFrame(r));
    mesh.onBeforeRender = prev;
    camera.updateMatrixWorld();
    const m = camera.matrixWorld.constructor.prototype; // Matrix4 proto (unused)
    const V = camera.position.constructor;
    const mm = camera.matrixWorld.clone(), p = new V();
    let inView = 0, face = 0, nw = 0;
    for (let k = 0; k < mesh.count; k++) { mesh.getMatrixAt(k, mm); p.setFromMatrixPosition(mm).applyMatrix4(mesh.matrixWorld).project(camera); if (Math.abs(p.x) < 1 && Math.abs(p.y) < 1 && p.z < 1 && p.z > -1) inView++;
      // how square-on this flag is to the eye (|n . view|): 0 = edge-on = vanishes
      const e = mm.elements, wp = new V(e[12], e[13], e[14]).applyMatrix4(mesh.matrixWorld), nrm = new V(e[8], e[9], e[10]).transformDirection(mesh.matrixWorld), vd = camera.position.clone().sub(wp).normalize();
      if (wp.x < -30) { face += Math.abs(nrm.dot(vd)); nw++; } }
    if (!mesh.boundingSphere) mesh.computeBoundingSphere();
    return { found: true, vis, count: mesh.count, drawn, inView, facing: +(face / Math.max(1, nw)).toFixed(2), frustumCulled: mesh.frustumCulled, sphereR: +mesh.boundingSphere.radius.toFixed(1), sphereC: mesh.boundingSphere.center.toArray().map((v) => +v.toFixed(1)) };
  });
  rows.push({ i, ...r });
  if (OUT) await run.shot(P, `pennant-orbit-${DEV}-${String(i).padStart(2, "0")}.png`);
}
console.log(JSON.stringify(rows[0]));
const bad = rows.filter((r) => !r.found || !r.vis || (r.inView > 0 && r.drawn === 0) || r.count !== rows.find((x) => x.found)?.count);
for (const r of bad) console.log("BAD", JSON.stringify(r));
run.check("pennants read square enough from every direction (mean facing >= 0.3)", rows.every((r) => r.found && r.facing >= 0.3), JSON.stringify(rows.map((r) => r.facing)));
run.check("pennant instanced mesh found", rows.every((r) => r.found));
run.check("pennants drawn (visible, not culled while instances are in view) from all 24 directions, same count", bad.length === 0);
const code = run.finish();
await browser.close();
process.exit(code);
