/**
 * The village as someone inside 케이슨랜드 sees it through the gate arch: a ring of photos from the spot in the VILLAGE that corresponds to
 * the park's arrival spot (15.5 m inside the gate), looking north, with the gatehouse, the castle wall, the park's skyline stand-in and the
 * sky taken away (the clear colour is magenta: the stitcher keys it out, so the park's own sky shows over the village's roofs).
 * tools/park-village-view.py stitches the ring into the cylinder strip the park draws beyond its arch (land/ParkVillageView.tsx).
 *
 *   node e2e/probe.mjs e2e/probes/gate-view-capture.mjs <out> desktop <time> -- <tag>
 *
 * Writes <tag>-NN.png (NN = 00..12: yaw -90 .. +90 in 15 degree steps, 0 = north) and <tag>.json (the camera's numbers).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

/** The park's arrival spot (40, -171) seen from the park's arch (40, -186.5) is the village's (-24, 94 + 15.5). */
export const EYE = [-24, 1.7, 109.5];
export const VFOV = 40;
export const STEP_DEG = 15;
export const SHOTS = 13;

export default async ({ P, OUT, args, hideHud, cam, shot, sleep }) => {
  const [TAG] = args;
  await hideHud(true);
  // let the village round the gate load at full detail first
  await cam([-24, 2.2, 78], [-24, 4, 94], 55);
  await sleep(6000);
  // the gatehouse and the wall mount a while after the village: wait for them, or they would be photographed
  await P.page.waitForFunction(() => {
    const { scene } = window.__cvThree();
    let lot = false, wall = false;
    scene.traverse((o) => { if (o.name === "lotdetail__lot_gate") lot = true; if (o.name === "castle_wall") wall = true; });
    return lot && wall;
  }, null, { timeout: 180000 });
  await sleep(3000);
  const hidden = await P.page.evaluate(() => {
    const { scene, gl } = window.__cvThree();
    const names = [];
    // taken OUT of the scene, not just hidden: the night's glow meshes are switched back on every frame
    const gone = [];
    const hide = (o) => { gone.push(o); names.push(o.name || o.type); };
    scene.traverse((o) => {
      const n = o.name || "";
      const mats = o.isMesh || o.isPoints || o.isSprite ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      const mn = mats.map((m) => m?.name || "").join(",");
      if (n === "castle_wall" || n === "park_skyline" || n === "gate_far_dress" || /lot_gate/.test(n) || /^lotshells_LM_martgate/.test(n)) return hide(o);
      // the sky and what hangs in it (the dome, clouds, stars, the moon, the sun's disc), by name or by material
      if (/^village_(sky|stars|star_lines|milky_way|moon)|cloud|sun_disc/i.test(n) || /^M_sky$|cloud/i.test(mn)) return hide(o);
    });
    // the moon's and the sun's glow sprites hang in the sky too
    for (const c of scene.children) if (c.isSprite) hide(c);
    for (const o of gone) o.removeFromParent();
    // everything south of the gate's line goes (the ground behind the gate rises: the eye would be under it): one clipping plane, z <= 95.2
    const V = scene.position.constructor;
    gl.clippingPlanes = [{ normal: new V(0, 0, -1), constant: 95.2, copy(p) { this.normal.copy(p.normal); this.constant = p.constant; return this; } }];
    scene.background = null;
    gl.setClearColor(0xff00ff, 1);
    window.__cvKeepClear = true;
    return names;
  });
  console.log("hidden", hidden.length, [...new Set(hidden)].slice(0, 60).join(" | "));
  const size = await P.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  for (let i = 0; i < SHOTS; i++) {
    const yaw = ((i - (SHOTS - 1) / 2) * STEP_DEG * Math.PI) / 180; // 0 = north (-z), positive toward +x (east)
    const look = [EYE[0] + Math.sin(yaw) * 50, EYE[1], EYE[2] - Math.cos(yaw) * 50];
    await cam(EYE, look, VFOV);
    await sleep(i === 0 ? 6000 : 2200);
    await P.page.evaluate(() => {
      const { gl, scene } = window.__cvThree();
      scene.background = null;
      scene.fog = null;
      gl.setClearColor(0xff00ff, 1);
    });
    await sleep(400);
    await shot(`${TAG}-${String(i).padStart(2, "0")}`);
  }
  writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({ eye: EYE, vfov: VFOV, stepDeg: STEP_DEG, shots: SHOTS, width: size.w, height: size.h }, null, 1));
};
