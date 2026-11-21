/**
 * e2e/interior-portal-bake.mjs — bake the REAL rooms behind the village's windows and open doors (client/src/village/portal/).
 *
 * The rooms are separate scenes far from the village (the lots' rooms at LOT_ROOM_AT, the houses' floors at x 360+, the memorial
 * hall at 300), so a window in the village cannot simply see through to them. This walks into every room by its real door (the
 * lots' pads, the houses' keypads, the memorial's door), stands a camera at the room's portal eye (portalRooms.ts: the middle of
 * the room, a standing visitor's eye), hides the people and renders the six faces of a cube into a float target: the scene's
 * linear light before the tone curve, × the room's own exposure (how the room looks to someone inside). One set at noon, one at
 * night. Faces are written as RGBE (.hdrface) next to a meta.json; docs/designs/clear-glass/tools/portal_atlas.mjs lays them into
 * one KTX2 atlas per room.
 *
 *   server:  PORT=3001 npx tsx src/index.ts          client: VITE_SERVER_URL=http://localhost:3001 npx vite --port 5601 --strictPort
 *   CV_CLIENT_URL=http://localhost:5601 CV_E2E_SLOW=6 node e2e/interior-portal-bake.mjs --out=<dir> [--face=512] [--only=lot_temple_hall,house_3_1]
 *   node docs/designs/clear-glass/tools/portal_atlas.mjs --in=<dir>
 *
 * Re-bake whenever a room's furniture or light changes.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, press, sleep, walkTo, waitIdle } from "./lib/common.mjs";
import { act, areaOf, joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const OUT = opt("out", "portal-bake");
const FACE = Number(opt("face", "512"));
const ONLY = opt("only", "").split(",").filter(Boolean);
const DATE = "2026-11-16";
const KEYS = { day: "12:30", night: "22:30" };
mkdirSync(OUT, { recursive: true });

const FACES = [
  { id: "px", f: [1, 0, 0], u: [0, 1, 0] },
  { id: "nx", f: [-1, 0, 0], u: [0, 1, 0] },
  { id: "py", f: [0, 1, 0], u: [0, 0, 1] },
  { id: "ny", f: [0, -1, 0], u: [0, 0, -1] },
  { id: "pz", f: [0, 0, 1], u: [0, 1, 0] },
  { id: "nz", f: [0, 0, -1], u: [0, 1, 0] },
];

const run = createRun("interior-portal-bake");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
const page = P.page;

async function planned(x, z, tol = 0.7) {
  for (let a = 0; a < 3; a++) {
    const plan = await page.evaluate(async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
      return r.ok ? { ok: true, pts: [...(r.via ?? []), { x: r.x, z: r.z }] } : { ok: false, why: r.reason };
    }, [x, z]);
    if (!plan.ok) return { ok: plan.why === "here", at: await pos(P), why: plan.why };
    for (const w of plan.pts) {
      await walkTo(P, w.x, w.z);
      await sleep(300);
      await waitIdle(P, 30000);
    }
    const at = await pos(P);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ok: true, at };
  }
  const at = await pos(P);
  return { ok: Math.hypot(at.x - x, at.z - z) <= tol, at };
}
async function walkWay(placeId, x, z) {
  const here = await pos(P);
  if (Math.hypot(here.x, here.z - 14) > 25) await planned(0, 14, 2);
  const h2 = await pos(P);
  const way = await page.evaluate(async ([id, x, z]) => {
    const m = await window.__imp("/src/village/villagePlaces.ts");
    return m.wayTo(m.mapPlace(id), x, z);
  }, [placeId, h2.x, h2.z]);
  for (const w of way) await planned(w.x, w.z, 1.2);
  return planned(x, z, 0.8);
}
async function waitArea(a, ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf(P)) === a) break;
    await sleep(150);
  }
  await page
    .waitForFunction(() => {
      const c = document.querySelector(".cv-house-cover");
      const f = document.querySelector(".cv-door-fade");
      return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
    }, null, { timeout: 30000 })
    .catch(() => {});
  await sleep(3000);
  return (await areaOf(P)) === a;
}
async function setTime(hhmm) {
  await page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, `${DATE}T${hhmm}`);
}

/** Render the six faces from `eye` (the current area's world) and write them; returns the exposure the room is seen at. */
async function bakeRoom(id, eye) {
  const meta = { id, eye, face: FACE, faces: FACES, keys: [] };
  for (const [key, hhmm] of Object.entries(KEYS)) {
    await setTime(hhmm);
    await sleep(4000);
    // the game's own camera at the eye first (its culling, levels and shadows follow it)
    await page.evaluate(([x, y, z]) => (window.__cvShot = { x, y, z, tx: x + 1, ty: y, tz: z, fov: 90 }), eye);
    await sleep(2500);
    const exposure = await page.evaluate(() => window.__cvThree().gl.toneMappingExposure);
    for (const f of FACES) {
      const b64 = await page.evaluate(async ({ eye, f, u, N }) => {
        const THREE = await window.__imp("/deps/three.js");
        const { scene, camera, gl } = window.__cvThree();
        const hidden = [];
        scene.traverse((o) => {
          if ((o.isSkinnedMesh || o.isSprite || o.name === "avatar__impostors" || o.name === "overview-self-marker") && o.visible) hidden.push(o);
        });
        for (const o of hidden) o.visible = false;
        window.__pbRT ??= new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
        const rt = window.__pbRT;
        const cam = new THREE.PerspectiveCamera(90, 1, 0.05, camera.far);
        cam.layers.mask = camera.layers.mask;
        cam.position.set(eye[0], eye[1], eye[2]);
        cam.up.set(u[0], u[1], u[2]);
        cam.lookAt(eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]);
        cam.updateMatrixWorld();
        const prev = gl.getRenderTarget();
        gl.setRenderTarget(rt);
        gl.clear();
        gl.render(scene, cam);
        gl.setRenderTarget(prev);
        for (const o of hidden) o.visible = true;
        const px = new Float32Array(N * N * 4);
        gl.readRenderTargetPixels(rt, 0, 0, N, N, px);
        const out = new Uint8Array(N * N * 4);
        for (let row = 0; row < N; row++) {
          const src = (N - 1 - row) * N * 4, dst = row * N * 4;
          for (let i = 0; i < N * 4; i += 4) {
            const r = px[src + i], g = px[src + i + 1], b = px[src + i + 2];
            const v = Math.max(r, g, b);
            if (!(v > 1e-32)) continue;
            const e = Math.ceil(Math.log2(v) + 1e-9);
            const s = 256 / Math.pow(2, e);
            out[dst + i] = Math.min(255, Math.max(0, Math.floor(r * s)));
            out[dst + i + 1] = Math.min(255, Math.max(0, Math.floor(g * s)));
            out[dst + i + 2] = Math.min(255, Math.max(0, Math.floor(b * s)));
            out[dst + i + 3] = e + 128;
          }
        }
        let bin = "";
        for (let i = 0; i < out.length; i += 0x8000) bin += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
        return btoa(bin);
      }, { eye, f: f.f, u: f.u, N: FACE });
      writeFileSync(join(OUT, `${id}_${key}_${f.id}.hdrface`), Buffer.from(b64, "base64"));
    }
    // a look at what was baked (the game's own frame from the eye, facing the far wall)
    await page.screenshot({ path: join(OUT, `${id}_${key}_view.png`) });
    meta.keys.push({ id: key, time: hhmm, exposure });
    console.log(`progress: ${id} ${key} exposure ${exposure.toFixed(3)}`);
  }
  await page.evaluate(() => (window.__cvShot = null));
  await setTime(KEYS.day);
  writeFileSync(join(OUT, `${id}.json`), JSON.stringify(meta, null, 1));
}

const want = (id) => !ONLY.length || ONLY.some((o) => id === o || id.startsWith(o + "_"));

try {
  await joinVillage(P, "portal", `${DATE}T12:30`);
  await page.waitForFunction(() => !!window.__cvThree && !!window.__cvLots?.()?.ready, null, { timeout: 180000 });
  await page.addStyleTag({ content: "body * {visibility:hidden!important} body canvas {visibility:visible!important}" });
  const rooms = await page.evaluate(async () => (await window.__imp("/src/village/portal/portalRooms.ts")).bakeTargets());

  // the lots' floors in the village: how high each room's floor stands (a ray down just inside its door)
  const lifts = await page.evaluate(async (rooms) => {
    const THREE = await window.__imp("/deps/three.js");
    const { scene } = window.__cvThree();
    const ray = new THREE.Raycaster();
    const out = {};
    for (const r of rooms.filter((r) => r.kind === "lot")) {
      ray.set(new THREE.Vector3(r.sill[0], 6, r.sill[1]), new THREE.Vector3(0, -1, 0));
      const hit = ray.intersectObjects(scene.children, true).find((h) => h.object.isMesh && !h.object.material?.transparent && h.point.y < 3);
      out[r.id] = hit ? +hit.point.y.toFixed(3) : null;
    }
    return out;
  }, rooms);
  console.log("lifts", JSON.stringify(lifts));
  writeFileSync(join(OUT, "lifts.json"), JSON.stringify(lifts, null, 1));

  for (const r of rooms) {
    if (r.kind === "house" ? !want(`${r.id}_1`) && !want(`${r.id}_2`) && !want(r.id) : !want(r.id)) continue;
    console.log(`progress: ${r.id} entering`);
    if (r.kind === "lot") {
      await walkWay(r.lot, r.arrival.x, r.arrival.z);
      await planned(r.pad.x, r.pad.z, 0.6);
      await sleep(1500);
      await act(P);
      if (!(await waitArea(r.area))) {
        console.log(`FAIL ${r.id}: not inside`);
        continue;
      }
      await bakeRoom(r.id, r.eye);
      await planned(r.exit.x, r.exit.z, 0.7);
      await act(P);
      await waitArea("village");
    } else if (r.kind === "hall") {
      for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await planned(x, z, 1.2);
      await act(P);
      if (!(await waitArea("hall", 60000))) {
        console.log(`FAIL ${r.id}: not inside`);
        continue;
      }
      await page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 }).catch(() => {});
      await sleep(3000);
      await bakeRoom(r.id, r.eye);
      await planned(r.exit.x, r.exit.z, 0.7);
      await act(P);
      await waitArea("village");
    } else if (r.kind === "house") {
      const at = await planned(r.pad.x, r.pad.z, 0.9);
      await act(P);
      const kp = await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
      if (!kp) {
        console.log(`FAIL ${r.id}: no keypad (at pad ${at.ok})`);
        continue;
      }
      for (const ch of "1004") await press(P, page.locator(`.cv-keypad button[data-key="${ch}"]`));
      await press(P, page.locator('.cv-keypad button[data-key="ok"]'));
      if (!(await waitArea(`house:${r.id}:1`))) {
        console.log(`FAIL ${r.id}: not inside`);
        continue;
      }
      if (want(`${r.id}_1`)) await bakeRoom(`${r.id}_1`, r.eyes[0]);
      if (want(`${r.id}_2`)) {
        await planned(r.upPad.x, r.upPad.z, 0.7);
        await act(P);
        if (await waitArea(`house:${r.id}:2`, 20000)) {
          await bakeRoom(`${r.id}_2`, r.eyes[1]);
          await act(P);
          await waitArea(`house:${r.id}:1`, 20000);
        } else console.log(`FAIL ${r.id}_2: not upstairs`);
      }
      await planned(r.exit.x, r.exit.z, 0.7);
      await act(P);
      await waitArea("village");
    }
  }
  if (run.errors.length) console.log(`console/page errors: ${JSON.stringify(run.errors.slice(0, 8), null, 1)}`);
} finally {
  await browser.close();
}
process.exit(0);
