/**
 * The park as someone in the VILLAGE sees it through the open gate: a ring of photos taken in the park from the spot that corresponds to
 * the village's forecourt (8 m in front of the gate's line: the village's (-24, 86) is the park's (40, -194.5)), looking south, with the
 * gatehouse taken away and everything north of its back cut off (the wall, the ground outside). The sky is taken away (magenta, keyed out by the stitcher): the village's own sky shows there.
 * tools/park-village-view.py --portal stitches it; village/skyline/VillageParkPortal.tsx draws it behind the village's gate.
 *
 *   node e2e/probe.mjs e2e/probes/gate-park-view-capture.mjs <out> desktop <time> -- <tag>
 * Bearings: 0 = south (+z), positive toward the camera's right (west, -x). 9 shots, -60 .. +60 in 15 degree steps.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const EYE = [40, 1.7, -194.5];
export const VFOV = 72;
export const STEP_DEG = 15;
export const SHOTS = 9;

export default async ({ P, OUT, args, enterPark, goTo, hideHud, cam, shot, sleep }) => {
  const [TAG] = args;
  await enterPark();
  // out of the picture: behind the east shops
  await goTo(74, -150);
  await hideHud(true);
  await P.page.waitForFunction(() => { let n = 0; window.__cvThree().scene.traverse((o) => { if (o.name === "park_gate_lot") n = o.children.length; }); return n > 3; }, null, { timeout: 180000 });
  await sleep(3000);
  const prep = () =>
    P.page.evaluate(() => {
      const { scene, gl } = window.__cvThree();
      scene.traverse((o) => {
        if (o.name === "park_gate_lot" || o.material?.name === "M_park_village_view" || o.isSprite) o.visible = false;
        // the sky goes (the dome, the stars, the moon): the clear colour is keyed out, the village's own sky shows there
        if (/^village_(sky|stars|star_lines|milky_way|moon)/.test(o.name || "")) o.visible = false;
        if (o.isMesh && o.geometry?.type === "SphereGeometry" && (o.geometry.parameters?.radius ?? 0) > 1000) o.visible = false;
      });
      scene.background = null;
      gl.setClearColor(0xff00ff, 1);
      const V = scene.position.constructor;
      gl.clippingPlanes = [{ normal: new V(0, 0, 1), constant: 184.6, copy(p) { this.normal.copy(p.normal); this.constant = p.constant; return this; } }];
      scene.fog = null;
    });
  const size = await P.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  for (let i = 0; i < SHOTS; i++) {
    const yaw = ((i - (SHOTS - 1) / 2) * STEP_DEG * Math.PI) / 180;
    await cam(EYE, [EYE[0] - Math.sin(yaw) * 50, EYE[1], EYE[2] + Math.cos(yaw) * 50], VFOV);
    await sleep(i === 0 ? 5000 : 2200);
    await prep();
    await sleep(500);
    await shot(`${TAG}-${String(i).padStart(2, "0")}`);
  }
  writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({ eye: EYE, vfov: VFOV, stepDeg: STEP_DEG, shots: SHOTS, width: size.w, height: size.h }, null, 1));
};
