/**
 * The photos 케이슨랜드's guide map is drawn from (tools/park-guide-map.py): the REAL park, seen from the gate's side at a bird's-eye slant,
 * in an orthographic projection (no perspective: a metre is a metre everywhere, so the tiles join and a ride's cut-out can be set down at
 * its true place).
 *
 *   node e2e/probe.mjs e2e/probes/park-map-capture.mjs <out> desktop 2026-11-16T12:30
 *   (CV_VIEW=1500x900)
 *
 * Writes
 *   base-<col>-<row>.png   the whole park in tiles, the four rides that are set down larger left out
 *   ride-<key>.png         each of those rides alone on magenta (and the gate arch, the star fountain), close up
 *   capture.json           the projection's numbers (pitch, each photo's centre and metres per pixel)
 *
 * The view: the camera looks south (+z) and down by PITCH; screen right is west (-x) - the map is read standing at the gate, looking in.
 * A point (x, y, z) lands at  sx = -x,  sy = z sin(PITCH) + y cos(PITCH)  (metres, sy up).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

export const PITCH_DEG = 50;
/** The map's frame in the projection's metres: sx -405 .. 195 (x 405 .. -195), sy from the ground at z -205 to 80. */
export const FRAME = { x0: -195, x1: 405, z0: -205, syTop: 80 };
const RIDES = {
  carousel: { at: [110, -135], half: 30 },
  wheel: { at: [205, -137], half: 46, lift: 28 },
  moonboat: { at: [-90, -146], half: 32, lift: 12 },
  droptower: { at: [-73, -88], half: 62, lift: 50 },
  gate: { at: [40, -186.5], half: 20, lift: 8, keep: true },
  fountain: { at: [40, -112], half: 12, lift: 2, keep: true },
};

export default async ({ P, OUT, enterPark, hideHud, cam, shot, sleep }) => {
  await enterPark();
  await hideHud(true);
  const phi = (PITCH_DEG * Math.PI) / 180;
  const S = Math.sin(phi);
  const C = Math.cos(phi);
  const view = await P.page.evaluate(() => ({ w: innerWidth, h: innerHeight }));
  // the orthographic lens: the rig keeps calling updateProjectionMatrix, which now builds the box window.__ortho names
  await P.page.evaluate(() => {
    const { camera, scene } = window.__cvThree();
    window.__ortho = { halfW: 100, halfH: 60 };
    camera.updateProjectionMatrix = function () {
      const o = window.__ortho;
      this.projectionMatrix.makeOrthographic(-o.halfW, o.halfW, o.halfH, -o.halfH, 1, 3000);
      this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
    };
    scene.fog = null;
  });
  // the park's own root: the group that holds the castle wall; its children are the park's parts
  const parts = await P.page.evaluate(() => {
    const { scene } = window.__cvThree();
    let root = null;
    scene.traverse((o) => { if (o.name === "castle_wall") root = o.parent; });
    window.__mapRoot = root;
    const B = scene.position.constructor;
    return root.children.map((c, i) => {
      let x0 = 1e9, x1 = -1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9, n = 0;
      c.traverse((m) => {
        if (!m.isMesh || !m.geometry?.attributes?.position) return;
        const g = m.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        let b = g.boundingBox;
        if (m.isInstancedMesh) { if (!m.boundingBox) m.computeBoundingBox(); b = m.boundingBox; }
        if (!b || !Number.isFinite(b.min.x)) return;
        const w = b.clone().applyMatrix4(m.matrixWorld);
        x0 = Math.min(x0, w.min.x); x1 = Math.max(x1, w.max.x); y1 = Math.max(y1, w.max.y); z0 = Math.min(z0, w.min.z); z1 = Math.max(z1, w.max.z); n++;
      });
      void B;
      return { i, name: c.name, n, x0, x1, y1, z0, z1 };
    });
  });
  const partOf = (r) => parts.filter((p) => p.n > 0 && p.x1 - p.x0 < 140 && Math.abs((p.x0 + p.x1) / 2 - r.at[0]) < 14 && Math.abs((p.z0 + p.z1) / 2 - r.at[1]) < 14).map((p) => p.i);
  const rideParts = Object.fromEntries(Object.entries(RIDES).map(([k, r]) => [k, partOf(r)]));
  console.log("ride parts", JSON.stringify(rideParts));
  // the sky dome, the mountains, and whatever holds no mesh at all (the high clouds are sprites)
  const sky = parts.filter((p) => p.n === 0 || p.x1 - p.x0 > 2000 || p.name === "park_mountains").map((p) => p.i);
  const show = (only, hide) =>
    P.page.evaluate(([only, hide]) => {
      const { gl, scene } = window.__cvThree();
      window.__mapRoot.children.forEach((c, i) => { c.visible = only ? only.includes(i) : !hide.includes(i); });
      scene.traverse((o) => { if (o.isSprite) o.visible = false; });
      scene.background = null;
      gl.setClearColor(0xff00ff, 1);
    }, [only, hide]);
  /** Aim the lens at the projection point (sx, sy): the ground point under it, the camera 600 m back up the view line. */
  const aim = async (sx, sy, halfW, D = 150) => {
    const halfH = (halfW * view.h) / view.w;
    const x = -sx;
    const z = sy / S;
    await P.page.evaluate(([halfW, halfH]) => { window.__ortho = { halfW, halfH }; window.__cvThree().camera.updateProjectionMatrix(); }, [halfW, halfH]);
    // the camera stays near (the lens has no perspective, so its distance changes nothing but what the scene's level of detail draws:
    // from far off the park's trees thin out to nothing)
    await cam([x, D * S, z - D * C], [x, 0, z], 30);
    return { sx, sy, halfW, halfH, mPerPx: (2 * halfW) / view.w };
  };
  const meta = { pitchDeg: PITCH_DEG, frame: FRAME, view, base: [], rides: {} };
  // ── the base: everything but the sky and the rides that are set down larger ──
  const lifted = Object.entries(RIDES).filter(([, r]) => !r.keep).flatMap(([k]) => rideParts[k]);
  await show(null, [...sky, ...lifted]);
  const sx0 = -FRAME.x1;
  const sx1 = -FRAME.x0;
  const sy0 = FRAME.z0 * S;
  const sy1 = FRAME.syTop;
  const halfW = 60;
  const halfH = (halfW * view.h) / view.w;
  const cols = Math.ceil((sx1 - sx0) / (2 * halfW));
  const rows = Math.ceil((sy1 - sy0) / (2 * halfH));
  let first = true;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const m = await aim(sx0 + halfW + c * 2 * halfW, sy0 + halfH + r * 2 * halfH, halfW);
      await sleep(first ? 9000 : 3000);
      first = false;
      await show(null, [...sky, ...lifted]);
      await sleep(600);
      await shot(`base-${c}-${r}`);
      meta.base.push({ file: `base-${c}-${r}.png`, ...m });
    }
  // ── each ride alone, close up ──
  for (const [k, r] of Object.entries(RIDES)) {
    await show(rideParts[k], []);
    const m = await aim(-r.at[0], r.at[1] * S + (r.lift ?? 3) * C, r.half, 230);
    await sleep(3500);
    await show(rideParts[k], []);
    await sleep(600);
    await shot(`ride-${k}`);
    meta.rides[k] = { file: `ride-${k}.png`, at: r.at, ...m };
  }
  writeFileSync(join(OUT, "capture.json"), JSON.stringify(meta, null, 1));
};
