// lake-fins.mjs — every species' fins must show when the fish is drawn in the game (owner 2026-11-17: "지느러미가 너무 투명해",
// "잡았는데 지느러미가 안보이는 것도 있어"). On the pier, each species' model (the game's own createFishModel and runtime materials)
// is put in front of the game camera over the lake's water and drawn by the game's own render loop (tone mapping, the water, the
// draw order — a see-through fin that wrote no depth was painted over by the water). Screenshots inside the fish's box with its fin
// meshes as the game draws them, without them (twice: the water's own motion is left out) and drawn fully opaque: over the pixels
// the opaque fins cover, the game's fins must show nearly everywhere and be >= 75% as opaque (owner: 75-90 %, only the edge fading)
// — side on, from 3/4 and from behind the tail.
//   CV_CLIENT_URL=http://localhost:5751 node e2e/lake-fins.mjs --out=<folder> [--device=pc|phone] [--cm=30]
// Writes <out>/fins-<device>-<species>-<view>.png (the fish in the game) and <out>/fins-<device>.json.

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-fins"));
const dev = opt("device", "pc");
const CM = Number(opt("cm", "30"));
const device = dev === "phone" ? PHONE : DESKTOP;
const run = createRun("lake-fins-" + dev);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "A", device });

await run.step("join and walk onto the pier", async () => {
  await joinVillage(p, "핀", "2026-11-03T12:30");
  for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
  await walkAndWait(p, 112, -14.6, 20000, 1.5);
  // first person on the pier, looking out north over the lake and down at the water (where the fins went missing: a caught fish held
  // up in the view against the water)
  await p.page.keyboard.press("KeyV");
  await sleep(900);
  await p.page.evaluate(async ([yaw, pitch]) => {
    const { viewState } = await window.__imp("/src/game/viewState.ts");
    viewState.fpYaw = yaw;
    viewState.fpPitch = pitch;
  }, [Number(opt("yaw", "0")), Number(opt("pitch", "0.45"))]);
  await sleep(1500);
  await run.shot(p, `fins-${dev}-view.png`);
});

/** Put species `k` in front of the game camera, turned by `yaw` from side on; returns its box on the page (CSS px). */
const place = (k, yaw, cm) =>
  p.page.evaluate(
    async ([k, yaw, cm]) => {
      const T = window.__cvThree();
      const props = await window.__imp("/src/lake/lakeProps.ts");
      const proto = await window.__imp("/src/lake/lakeProtocol.ts");
      for (let i = 0; i < 100 && !props.lakeGearReady(); i++) {
        void props.loadLakeGear();
        await new Promise((r) => setTimeout(r, 100));
      }
      const st = (window.__finState ??= {});
      if (st.model && st.k !== k) {
        T.scene.remove(st.model.root);
        st.model.dispose();
        st.model = null;
      }
      if (!st.model) {
        st.model = props.createFishModel();
        st.k = k;
        const sp = proto.species(k);
        st.model.setCm(cm);
        st.model.setKind(k, sp.color);
        st.model.setFlex(0, 0, 0);
        T.scene.add(st.model.root);
        st.fins = [];
        st.model.root.traverse((o) => {
          // the near model's fins (the far LOD's are hidden at this distance)
          if (o.isMesh && /^M_fin/.test(o.material?.name ?? "") && !/_lod1/.test(o.parent?.name ?? "") && !/_lod1/.test(o.name)) st.fins.push(o);
        });
        st.id = sp.id;
      }
      const cam = T.camera;
      cam.updateMatrixWorld();
      const V3 = cam.position.constructor;
      const eye = new V3().setFromMatrixPosition(cam.matrixWorld);
      const fwd = new V3(0, 0, -1).applyQuaternion(cam.quaternion);
      const up = new V3(0, 1, 0).applyQuaternion(cam.quaternion);
      const right = new V3(1, 0, 0).applyQuaternion(cam.quaternion);
      const len = props.fishDrawnLen(cm);
      // far enough out that the whole fish is in the view (the phone's narrow view too)
      const aspect = cam.aspect ?? 1;
      const dist = Math.max(1.2, (len * 0.75) / Math.tan(((cam.fov ?? 50) * Math.PI) / 360) / Math.min(1, aspect));
      const at = eye.clone().addScaledVector(fwd, dist);
      const root = st.model.root;
      root.position.copy(at);
      const toCam = fwd.clone().negate();
      const z = right.clone().multiplyScalar(Math.cos(yaw)).addScaledVector(toCam, -Math.sin(yaw)).normalize();
      const x = up.clone().cross(z).normalize();
      const y = z.clone().cross(x).normalize();
      root.quaternion.setFromRotationMatrix(new (cam.matrixWorld.constructor)().makeBasis(x, y, z));
      root.updateMatrixWorld(true);
      // the box on the page
      const el = T.gl.domElement;
      const r = el.getBoundingClientRect();
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
      for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.55, 0.55]) {
        const q = new V3(sx * 0.3, sy * 0.6, sz).applyMatrix4(root.matrixWorld).project(cam);
        const px = r.left + ((q.x + 1) / 2) * r.width, py = r.top + ((1 - q.y) / 2) * r.height;
        x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      }
      x0 = Math.max(r.left, x0); y0 = Math.max(r.top, y0); x1 = Math.min(r.right, x1); y1 = Math.min(r.bottom, y1);
      return { id: st.id, finMeshes: st.fins.length, box: { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) } };
    },
    [k, yaw, cm],
  );
/** The fin meshes: "on" (as the game draws them), "off" (hidden), "solid" (drawn fully opaque: the reference for their opacity). */
const fins = (mode) =>
  p.page.evaluate(async (mode) => {
    for (const f of window.__finState.fins) {
      f.visible = mode !== "off";
      const m = f.material;
      m.userData.keep ??= { transparent: m.transparent, alphaTest: m.alphaTest };
      const solid = mode === "solid";
      m.transparent = solid ? false : m.userData.keep.transparent;
      m.alphaTest = solid ? 0.5 : m.userData.keep.alphaTest;
      m.needsUpdate = true;
    }
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r))));
  }, mode);
const grab = async (box) => {
  const buf = await p.page.screenshot({ type: "png", clip: { x: box.x, y: box.y, width: Math.max(8, box.w), height: Math.max(8, box.h) } });
  const { data, info } = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { buf, data, info };
};
const px = (a, b, i) => Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);

/**
 * Over the pixels the fully opaque fins cover (they differ from the fins-off frame by more than the water's own motion), how much of
 * that difference the game's fins make: their opacity as seen (1 = as solid as an opaque fin, 0 = invisible), and the share of those
 * pixels where the fins show at all.
 */
function finOpacity(on, off, off2, solid) {
  let n = 0, shown = 0, sum = 0;
  for (let i = 0; i < on.data.length; i += 3) {
    const ref = px(solid, off, i);
    if (ref < 60 || px(off, off2, i) > 18) continue;
    n++;
    const d = px(on, off, i);
    if (d > 24) shown++;
    sum += Math.min(1, d / ref);
  }
  return { finPx: n, shown: n ? +(shown / n).toFixed(3) : 0, alpha: n ? +(sum / n).toFixed(3) : 0 };
}

await run.step("every species: its fins show, nearly opaque (side, 3/4, from the tail)", async () => {
  const rows = [];
  for (let k = 1; k <= 11; k++) {
    for (const [view, yaw] of [["side", 0], ["34", 0.6], ["tail", 1.15]]) {
      const pl = await place(k, yaw, CM);
      // a new species: its materials compile on the first frame it is drawn — let it show before measuring
      if (view === "side") await sleep(700);
      await fins("on");
      const on = await grab(pl.box);
      await fins("off");
      const off = await grab(pl.box);
      const off2 = await grab(pl.box);
      await fins("solid");
      const solid = await grab(pl.box);
      await fins("on");
      rows.push({ id: pl.id, view, finMeshes: pl.finMeshes, ...finOpacity(on, off, off2, solid) });
      writeFileSync(join(OUT, `fins-${dev}-${pl.id}-${view}.png`), on.buf);
    }
  }
  await p.page.evaluate(() => {
    const st = window.__finState;
    if (st?.model) {
      st.model.root.removeFromParent();
      st.model.dispose();
    }
  });
  writeFileSync(join(OUT, `fins-${dev}.json`), JSON.stringify(rows, null, 1));
  for (const x of rows) {
    run.check(`${x.id} ${x.view}: has fin meshes`, x.finMeshes > 0, x.finMeshes);
    run.check(`${x.id} ${x.view}: the fins cover pixels on the screen (>= 400)`, x.finPx >= 400, x);
    // owner: 75-90 % opaque membranes, only the outer edge fading (the old fins measured 0.75-0.83 here and read as too clear)
    run.check(`${x.id} ${x.view}: the fins show over >= 90% of where solid fins would`, x.shown >= 0.9, x);
    run.check(`${x.id} ${x.view}: the fins are >= 85% as opaque as solid fins`, x.alpha >= 0.85, x);
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
