/**
 * e2e/village-bus-look.mjs — 마을버스 셰이더가 실제 GPU에서 TS 식대로 그리는지 (버스 4차 다듬기 검토 r1).
 *
 * 단위 시험(client/src/village/villageBusPrep.test.ts)은 GLSL을 돌리지 못해 셰이더 글과 TS 식만 본다. 여기서는 게임이
 * 버스에 입힌 재질 그대로를 시험용 장면(빨간 바탕에 평면 하나)에 그려 화소를 읽는다. 두 등급(화려하게·가볍게) 각각:
 *   - cover: 유리의 표지판 덮개(SIGN_PARS의 busOverSign)를 켠 그림과 끈 그림(표지판 법선 0)의 차이가, 화소마다 TS
 *     busOverSign이 "표지판 앞"이라고 하는 자리와 같은지. 옆 표지판 앞 평면(정면·비스듬히·위에서), 뒤 표지판 앞 평면,
 *     반대편에서 본 옆 평면(덮개 없음), 표지판 뒤(실내 쪽) 평면(덮개 없음). 상자 경계 ±2 mm 안의 화소는 셈에서 뺀다.
 *   - pool: 바닥 판 셰이더(GROUND_PARS·GROUND_OUT)가 더하는 불빛(1x1 초록 지도, 밤 노출 1.95와 게임의 지금 노출)이
 *     busPoolAdds와 1/255 안인지. 가벼운 등급은 sRGB 캔버스에서 톤 곡선을 거친 차이(음수는 0), 화려한 등급은 빛 그대로.
 *
 *   npm run dev   (다른 창에서; 또는 CV_CLIENT_URL=http://localhost:<포트>)
 *   node e2e/village-bus-look.mjs [--only=low,high] [--out=<폴더>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
const only = opt("only", "low,high").split(",");
const run = createRun("village-bus-look");
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
// ANGLE's D3D shader compiler warns about the bloom pass's loop (known, not the bus's; e2e/village-desktop.mjs logs it too)
run.allow("D3D X3595 (bloom shader, known)", /warning X3595: gradient instruction used in a loop/);

const AFTERNOON = "2026-06-21T15:30";
const NIGHT_EXPOSURE = 1.95; // the village's full night (× the brightness 1.0)

/**
 * The cover's views, bus-local (the bus's centre at the origin, nose -z, doors +x): the sign whose pane is drawn, the
 * pane's offset from the sign's face (m, + outward: the windows stand 3.5-4.2 cm in front of the signs), the eye, and
 * whether any of the pane clears.
 */
const COVER_VIEWS = [
  { name: "side_headon", sign: "+x", plane: 0.038, eye: [7, 2.0, 0], fov: 22, expect: true },
  { name: "side_aft", sign: "+x", plane: 0.038, eye: [3.2, 1.6, 5.5], fov: 24, expect: true },
  { name: "side_high_fore", sign: "+x", plane: 0.038, eye: [2.4, 3.4, -3.5], fov: 34, expect: true },
  { name: "rear_behind", sign: "+z", plane: 0.038, eye: [0.4, 1.6, 8], fov: 18, expect: true },
  { name: "rear_aside", sign: "+z", plane: 0.038, eye: [3.5, 2.2, 5.5], fov: 28, expect: true },
  // the kerb-side pane seen from the far side, across the cabin, at the sign's back: never clear
  { name: "side_from_far_side", sign: "+x", plane: 0.038, eye: [-7, 2.3, 0], fov: 22, expect: false },
  // a pane between the sign and the cabin, seen from the kerb (the sign in front of it): never clear
  { name: "side_pane_behind_sign", sign: "+x", plane: -0.06, eye: [7, 2.0, 0], fov: 22, expect: false },
];

/** Page code shared by both probes: a test scene with one quad of the bus's own material, drawn straight to the canvas. */
const PAGE_HELPERS = `
window.__busLook = {
  meshOf(n) { let m = null; n.root.traverse((o) => { if (!m && o.isMesh) m = o; }); return m; },
  quad(n, corners, material) {
    const any = this.meshOf(n);
    const g = new any.geometry.constructor();
    const Attr = any.geometry.attributes.position.constructor;
    const order = [0, 1, 2, 0, 2, 3];
    g.setAttribute("position", new Attr(new Float32Array(order.flatMap((i) => corners[i].toArray())), 3));
    g.setAttribute("uv", new Attr(new Float32Array(order.length * 2), 2));
    g.computeVertexNormals();
    return new any.constructor(g, material);
  },
  /** Draw \`mesh\` alone on a plain background with \`cam\`; the drawing buffer's pixels (RGBA, top row first). */
  draw(mesh, cam, bg) {
    const { gl, scene } = window.__cvThree();
    const test = new scene.constructor();
    test.background = bg;
    test.add(mesh);
    const keep = { autoClear: gl.autoClear, target: gl.getRenderTarget() };
    gl.autoClear = true;
    gl.setRenderTarget(null);
    gl.render(test, cam);
    const W = gl.domElement.width, H = gl.domElement.height;
    const cv = document.createElement("canvas");
    cv.width = W;
    cv.height = H;
    const x = cv.getContext("2d");
    x.drawImage(gl.domElement, 0, 0);
    gl.autoClear = keep.autoClear;
    gl.setRenderTarget(keep.target);
    test.remove(mesh);
    return { W, H, cv, data: x.getImageData(0, 0, W, H).data };
  },
};`;

/** In the page: the cover's GPU picture against busOverSign (TS), one view. */
function coverView(p, view) {
  return p.page.evaluate(async (v) => {
    const prep = await window.__imp("/src/village/villageBusPrep.ts");
    const L = window.__busLook;
    const { gl, camera } = window.__cvThree();
    const n = window.__cvBus();
    const u = gl.properties.get(n.glass)?.uniforms;
    if (!u?.uBusSignN) return { error: "the glass has no sign cover (its uniforms)" };
    const sign = n.signs.find((s) => (v.sign === "+x" ? s.normal.x > 0.5 : s.normal.z > 0.5));
    if (!sign) return { error: `no ${v.sign} sign among ${n.signs.length}` };
    const c = n.root.position;
    const mid = sign.lo.clone().add(sign.hi).multiplyScalar(0.5);
    const axis = v.sign === "+x" ? 0 : 2;
    const at = mid.getComponent(axis) + v.plane;
    // the pane round the sign: 0.9 m up and down, 1.6 m (side) or 1.2 m (rear) across
    const half = { y: 0.45, across: axis === 0 ? 0.8 : 0.6 };
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([s, t]) => {
      const q = mid.clone();
      q.setComponent(axis, at);
      q.y += t * half.y;
      q.setComponent(axis === 0 ? 2 : 0, q.getComponent(axis === 0 ? 2 : 0) + s * half.across);
      return q;
    });
    const pane = L.quad(n, corners, n.glass);
    const cam = camera.clone();
    cam.fov = v.fov;
    cam.aspect = gl.domElement.width / gl.domElement.height;
    cam.position.set(c.x + v.eye[0], v.eye[1], c.z + v.eye[2]);
    cam.lookAt(mid);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const red = new n.glass.color.constructor(1, 0, 0);
    const normals = u.uBusSignN.value.map((x) => x.clone());
    const on = L.draw(pane, cam, red);
    u.uBusSignN.value.forEach((x) => x.set(0, 0, 0));
    const off = L.draw(pane, cam, red);
    u.uBusSignN.value.forEach((x, i) => x.copy(normals[i]));
    pane.geometry.dispose();
    // per pixel: the GPU's clear patch (the two pictures differ) against busOverSign at the pixel centre's ray through
    // the pane, with the signs' boxes shrunk and grown by 2 mm (pixels on the boundary are left out)
    const { W, H } = on;
    const eps = 0.002;
    const grow = (d) => n.signs.map((s) => ({ lo: s.lo.clone().subScalar(d), hi: s.hi.clone().addScalar(d), normal: s.normal }));
    const inner = grow(-eps);
    const outer = grow(eps);
    const V = mid.constructor;
    const eye = cam.position.clone();
    const pt = new V();
    const dir = new V();
    let gpuClear = 0, agreeClear = 0, agreeTint = 0, ambiguous = 0, offPane = 0, mismatchCount = 0;
    const bad = [];
    const img = new ImageData(W, H);
    for (let py = 0; py < H; py++) {
      for (let px = 0; px < W; px++) {
        const i = (py * W + px) * 4;
        const d = Math.max(Math.abs(on.data[i] - off.data[i]), Math.abs(on.data[i + 1] - off.data[i + 1]), Math.abs(on.data[i + 2] - off.data[i + 2]));
        const gpu = d > 6;
        if (gpu) gpuClear++;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, d * 3);
        img.data[i + 3] = 255;
        // the pixel centre's ray, met with the pane's plane
        pt.set(((px + 0.5) / W) * 2 - 1, 1 - ((py + 0.5) / H) * 2, 0.5).unproject(cam);
        dir.subVectors(pt, eye);
        const k = (at - eye.getComponent(axis)) / dir.getComponent(axis);
        if (!(k > 0)) continue;
        pt.copy(eye).addScaledVector(dir, k);
        const a = pt.y - mid.y;
        const b = pt.getComponent(axis === 0 ? 2 : 0) - mid.getComponent(axis === 0 ? 2 : 0);
        // on the pane, 1 cm in from its edges
        if (Math.abs(a) > half.y - 0.01 || Math.abs(b) > half.across - 0.01) {
          if (gpu) offPane++;
          continue;
        }
        const sure = prep.busOverSign(eye, pt, inner);
        const maybe = prep.busOverSign(eye, pt, outer);
        if (sure !== maybe) {
          ambiguous++;
          continue;
        }
        if (sure === gpu) {
          if (gpu) agreeClear++;
          else agreeTint++;
        } else {
          mismatchCount++;
          if (bad.length < 8) bad.push({ px, py, gpu, ts: sure, d });
          img.data[i] = 255;
          img.data[i + 1] = img.data[i + 2] = 0;
        }
      }
    }
    const dc = document.createElement("canvas");
    dc.width = W;
    dc.height = H;
    dc.getContext("2d").putImageData(img, 0, 0);
    return {
      gpuClear,
      agreeClear,
      agreeTint,
      ambiguous,
      offPane,
      mismatchCount,
      mismatches: bad,
      on: on.cv.toDataURL("image/png"),
      diff: dc.toDataURL("image/png"),
    };
  }, view);
}

/** In the page: the ground quad's added light on the GPU against busPoolAdds, at several strengths and two exposures. */
function poolProbe(p, tier) {
  return p.page.evaluate(async ([tier, nightExposure]) => {
    const prep = await window.__imp("/src/village/villageBusPrep.ts");
    const L = window.__busLook;
    const { gl, camera } = window.__cvThree();
    const n = window.__cvBus();
    const u = gl.properties.get(n.ground)?.uniforms;
    if (!u?.uBusGlowColor) return { error: "the ground quad's shader has no glow uniforms" };
    // a 1x1 map: no darkness (red 0), the pool's full green; the strength from the uniform
    const px = document.createElement("canvas");
    px.width = px.height = 1;
    const x = px.getContext("2d");
    x.fillStyle = "rgb(0,255,0)";
    x.fillRect(0, 0, 1, 1);
    const tex = new n.ground.map.constructor(px);
    tex.needsUpdate = true;
    const keep = { map: n.ground.map, glow: n.groundGlow.value, exposure: n.groundExposure.value };
    const V = n.root.position.constructor;
    const cam = camera.clone();
    cam.fov = 40;
    cam.aspect = gl.domElement.width / gl.domElement.height;
    cam.position.set(0, 10, 0.001);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    const quad = L.quad(n, [new V(-20, 0, -20), new V(-20, 0, 20), new V(20, 0, 20), new V(20, 0, -20)], n.ground);
    const bg = new n.glass.color.constructor(0.02, 0.03, 0.05);
    const colour = u.uBusGlowColor.value;
    const rows = [];
    let worst = 0;
    let negatives = 0;
    try {
      n.ground.map = tex;
      for (const exposure of [nightExposure, keep.exposure]) {
        n.groundExposure.value = exposure;
        for (const k of [0.02, 0.05, 0.1, 0.153, 0.25, 0.5, 0.75, 1, 1.5]) {
          const glow = 0.035 * k;
          n.groundGlow.value = glow;
          const on = L.draw(quad, cam, bg);
          n.groundGlow.value = 0;
          const off = L.draw(quad, cam, bg);
          const c = ((on.H >> 1) * on.W + (on.W >> 1)) * 4;
          const got = [0, 1, 2].map((j) => on.data[c + j] - off.data[c + j]);
          const light = [colour.r, colour.g, colour.b].map((v) => v * glow);
          const want = prep.busPoolAdds(tier, light, exposure).map((v) => v * 255);
          const err = Math.max(...got.map((v, j) => Math.abs(v - want[j])));
          if (tier === "low") {
            const raw = prep.busDisplay(light.map((v, j) => v + prep.BUS_LOOK.nightAsphalt[j]), exposure);
            const bare = prep.busDisplay(prep.BUS_LOOK.nightAsphalt, exposure);
            if (raw.some((v, j) => v < bare[j])) negatives++;
          }
          worst = Math.max(worst, err);
          rows.push({ exposure: +exposure.toFixed(3), k, got, want: want.map((v) => +v.toFixed(2)), err: +err.toFixed(2) });
        }
      }
    } finally {
      n.ground.map = keep.map;
      n.groundGlow.value = keep.glow;
      n.groundExposure.value = keep.exposure;
      quad.geometry.dispose();
      tex.dispose();
    }
    return { rows, worst: +worst.toFixed(2), negatives, gameExposure: +keep.exposure.toFixed(3) };
  }, [tier, NIGHT_EXPOSURE]);
}

const save = (file, dataUrl) => writeFileSync(join(run.evidence, file), Buffer.from(dataUrl.split(",")[1], "base64"));

const browser = await launchBrowser();
const report = {};
try {
  for (const tier of only) {
    await run.step(`${tier}: the bus's shaders on the GPU against their TS`, async () => {
      const p = await openPlayer(browser, run, { tag: tier, device: DESKTOP, settings: { graphics: tier } });
      await joinVillage(p, tier === "high" ? "화려" : "가벼", AFTERNOON);
      const came = await p.page.waitForFunction(() => !!window.__cvBus && !!window.__cvThree, null, { timeout: 90000 }).then(() => true, () => false);
      run.check("the bus is in the village", came);
      const gfx = await p.page.evaluate(() => window.__cvBus().body.type);
      run.check(`the ${tier} tier's bus (its paint: ${tier === "high" ? "MeshPhysicalMaterial" : "MeshStandardMaterial"})`, gfx === (tier === "high" ? "MeshPhysicalMaterial" : "MeshStandardMaterial"), gfx);
      await sleep(2500);
      await p.page.addScriptTag({ content: PAGE_HELPERS });
      report[tier] = { cover: {} };
      for (const v of COVER_VIEWS) {
        const r = await coverView(p, v);
        if (r.on) save(`${tier}-cover-${v.name}.png`, r.on);
        if (r.diff) save(`${tier}-cover-${v.name}-diff.png`, r.diff);
        delete r.on;
        delete r.diff;
        report[tier].cover[v.name] = r;
        if (r.error) {
          run.check(`cover ${v.name}: the glass's cover is there`, false, r.error);
          continue;
        }
        run.check(
          `cover ${v.name}: the GPU clears the pane exactly where busOverSign says (${v.expect ? "a clear patch" : "none"})`,
          r.mismatchCount === 0 && r.offPane === 0 && (v.expect ? r.agreeClear > 400 : r.gpuClear === 0) && r.agreeTint > 2000,
          r,
        );
      }
      const pool = await poolProbe(p, tier);
      report[tier].pool = pool;
      run.check(
        `pool: the ground quad adds busPoolAdds("${tier}") within 1/255, from the faint edge to past full (exposures ${NIGHT_EXPOSURE}, ${pool.gameExposure})`,
        // (the full pool, k = 1, adds about 53/255 of red on the light tier's canvas and its linear 9/255 on the rich tier's)
        !pool.error && pool.worst <= 1 && pool.rows.length === 18 && pool.rows.every((r) => r.k !== 1 || r.got[0] >= (tier === "low" ? 30 : 5)),
        pool.error ?? { worst: pool.worst, negatives: pool.negatives, sample: pool.rows.filter((r) => [0.1, 0.153, 1].includes(r.k)) },
      );
      if (tier === "low") run.check("pool: the faint edge (where the rich tier's sum loses blue) is among the samples, and adds no less than 0", pool.negatives > 0 && pool.rows.every((r) => r.got.every((v) => v >= 0)), pool.negatives);
      await p.ctx.close();
    });
  }
} finally {
  await browser.close();
}
writeFileSync(join(run.evidence, "bus-look.json"), JSON.stringify(report, null, 1));
process.exit(run.finish({ only }));
