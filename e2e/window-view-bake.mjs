/**
 * e2e/window-view-bake.mjs — bake the real village behind the walk-in rooms' windows (client/src/village/lots/windowView.ts).
 *
 * For every room in WINDOW_VIEW_UNITS and every time of day (day, the evening's golden hour, night) this joins the running
 * village (a dev stack, as the other e2e scripts), walks next to the room's building, stands the DEV photo camera at the
 * room's eye in the village (`windowViewFrame`: the middle of the building's ground floor, 1.6 m up), clips the building's
 * own walls and roof away (material clipping planes, inside its box only), hides the people (skinned meshes) and renders
 * the six faces of a cube from there into a float target: the scene's linear light before the exposure and tone curve,
 * exactly what the village's own frame is made of. The faces are written as RGBE (.hdrface) next to a meta.json; then
 * docs/designs/village-lots-v2/tools/window_view_atlas.mjs lays them into the window chart and encodes the KTX2 files.
 *
 *   server:  PORT=2895 npx tsx src/index.ts          client: VITE_SERVER_URL=http://localhost:2895 npx vite --port 5495 --strictPort
 *   CV_CLIENT_URL=http://localhost:5495 CV_E2E_SLOW=6 node e2e/window-view-bake.mjs --out=<dir> [--face=1536] [--only=lot_school_class] [--keys=day,dusk,night]
 *   node docs/designs/village-lots-v2/tools/window_view_atlas.mjs --in=<dir>
 *
 * Re-bake whenever the village around the school or the library changes (houses, trees, lamps, the sky's look).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const OUT = opt("out", "window-view-bake");
const FACE = Number(opt("face", "1536"));
const ONLY = opt("only", "");
const KEYS = opt("keys", "day,dusk,night").split(",");
const DATE = "2026-11-16";
mkdirSync(OUT, { recursive: true });

/** The cube's faces: the direction looked along and the camera's up (village axes; north is -z). */
const FACES = [
  { id: "px", f: [1, 0, 0], u: [0, 1, 0] },
  { id: "nx", f: [-1, 0, 0], u: [0, 1, 0] },
  { id: "pz", f: [0, 0, 1], u: [0, 1, 0] },
  { id: "nz", f: [0, 0, -1], u: [0, 1, 0] },
  { id: "py", f: [0, 1, 0], u: [0, 0, 1] },
  { id: "ny", f: [0, -1, 0], u: [0, 0, -1] },
];

const run = createRun("window-view-bake");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};
async function goTo(x, z, tol = 2) {
  for (let a = 0; a < 4; a++) {
    await P.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const at = window.__cv.getPos();
      const via = plan.findDetour(at.x, at.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(400);
    await until(async () => (await P.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 120000);
    const at = await pos(P);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(P);
}

/** Pin the village clock (KST "HH:mm" on DATE) and snap the look to it. */
async function setTime(hhmm) {
  await P.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, `${DATE}T${hhmm}`);
}

try {
  await joinVillage(P, "창밖", `${DATE}T12:30`);
  await P.page.waitForFunction(() => !!window.__cvThree && !!window.__cvLots?.()?.ready, null, { timeout: 180000 });
  await P.page.addStyleTag({ content: "body * {visibility:hidden!important} body canvas {visibility:visible!important}" });

  // the evening's golden hour: the minute of DATE with the strongest golden tint (the sun ~3° up, going down)
  const times = await P.page.evaluate(async (date) => {
    const { dayNightAt } = await window.__imp("/src/village/dayNightBlend.ts");
    const { pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    let best = { g: -1, t: "" };
    for (let m = 15 * 60; m < 19 * 60; m += 1) {
      const t = `${date}T${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const s = dayNightAt(pinFromSearch("?time=" + t));
      if (s.golden > best.g + 1e-6) best = { g: s.golden, t: t.slice(11) };
    }
    return { day: "12:30", dusk: best.t, night: "22:30" };
  }, DATE);
  console.log("times", JSON.stringify(times));

  const rooms = await P.page.evaluate(async () => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const W = await window.__imp("/src/village/lots/windowView.ts");
    return W.WINDOW_VIEW_UNITS.map((u) => {
      const room = L.LOT_ROOMS.find((r) => r.unit.id === u);
      const pad = L.lotDoorPoint(room.lot, room.door);
      return { ...W.windowViewFrame(room), pad: pad.pad, arrival: pad.arrival };
    });
  });

  for (const room of rooms) {
    if (ONLY && room.unit !== ONLY) continue;
    console.log(`progress: ${room.unit} eye ${room.eyeVillage.map((v) => v.toFixed(2)).join(",")}`);
    // stand a few metres out in front of the door (the avatar is hidden in the bake; the lots and trees pick their levels near the camera)
    const away = Math.hypot(room.pad.x - room.eyeVillage[0], room.pad.z - room.eyeVillage[2]);
    await goTo(room.pad.x + ((room.pad.x - room.eyeVillage[0]) / away) * 4, room.pad.z + ((room.pad.z - room.eyeVillage[2]) / away) * 4);
    const setup = await P.page.evaluate(async (clip) => {
      const THREE = await window.__imp("/deps/three.js");
      const { scene, gl } = window.__cvThree();
      gl.localClippingEnabled = true;
      const box = new THREE.Box3(new THREE.Vector3(...clip.min), new THREE.Vector3(...clip.max));
      // outward normals: a point is clipped when it is on the negative (inner) side of all six (clipIntersection)
      const planes = [
        new THREE.Plane(new THREE.Vector3(1, 0, 0), -box.max.x), new THREE.Plane(new THREE.Vector3(-1, 0, 0), box.min.x),
        new THREE.Plane(new THREE.Vector3(0, 1, 0), -box.max.y), new THREE.Plane(new THREE.Vector3(0, -1, 0), box.min.y),
        new THREE.Plane(new THREE.Vector3(0, 0, 1), -box.max.z), new THREE.Plane(new THREE.Vector3(0, 0, -1), box.min.z),
      ];
      const touched = new Map();
      const skipped = new Set();
      const hidden = [];
      const tmp = new THREE.Box3();
      scene.traverse((o) => {
        if (o.isSkinnedMesh || o.name === "overview-self-marker" || o.name === "avatar__impostors") {
          if (o.visible) hidden.push(o);
          return;
        }
        if (!o.isMesh && !o.isInstancedMesh) return;
        try {
          tmp.setFromObject(o);
        } catch {
          return;
        }
        if (tmp.isEmpty() || !tmp.intersectsBox(box)) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (!m || touched.has(m)) continue;
          if (m.isShaderMaterial && !m.clipping) {
            skipped.add(m.name || m.type);
            continue;
          }
          touched.set(m, { planes: m.clippingPlanes, inter: m.clipIntersection });
          m.clippingPlanes = planes;
          m.clipIntersection = true;
          m.needsUpdate = true;
        }
      });
      for (const o of hidden) o.visible = false;
      window.__wvRestore = () => {
        for (const [m, s] of touched) {
          m.clippingPlanes = s.planes;
          m.clipIntersection = s.inter;
          m.needsUpdate = true;
        }
        for (const o of hidden) o.visible = true;
      };
      return { materials: touched.size, skipped: [...skipped], hidden: hidden.length };
    }, room.clip);
    console.log(`clip ${JSON.stringify(setup)}`);

    const meta = { unit: room.unit, eyeVillage: room.eyeVillage, eyeRoom: room.eyeRoom, m: room.m, t: room.t, clip: room.clip, face: FACE, faces: FACES, keys: [] };
    for (const key of KEYS) {
      await setTime(times[key]);
      await sleep(3000);
      const state = await P.page.evaluate(() => {
        const s = window.__cvDayNight().outdoor;
        return { night: s.night, golden: s.golden, exposure: window.__cvThree().gl.toneMappingExposure, sunDir: s.sunDir };
      });
      for (const [i, f] of FACES.entries()) {
        const [x, y, z] = room.eyeVillage;
        // the game's own camera looks the same way first (its shadows, levels and culling follow it), then the face is drawn
        await P.page.evaluate(([x, y, z, f]) => {
          const e = f[1] !== 0 ? 0.001 : 0;
          window.__cvShot = { x, y, z, tx: x + f[0] + e, ty: y + f[1], tz: z + f[2], fov: 90 };
        }, [x, y, z, f.f]);
        await sleep(i === 0 && key === KEYS[0] ? 8000 : 1800);
        const b64 = await P.page.evaluate(async ({ eye, f, u, N }) => {
          const THREE = await window.__imp("/deps/three.js");
          const { scene, camera, gl } = window.__cvThree();
          window.__wvRT ??= new THREE.WebGLRenderTarget(N, N, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: true });
          const rt = window.__wvRT;
          const cam = new THREE.PerspectiveCamera(90, 1, 0.05, camera.far);
          cam.layers.set(0);
          cam.position.set(eye[0], eye[1], eye[2]);
          cam.up.set(u[0], u[1], u[2]);
          cam.lookAt(eye[0] + f[0], eye[1] + f[1], eye[2] + f[2]);
          cam.updateMatrixWorld();
          const prev = gl.getRenderTarget();
          gl.setRenderTarget(rt);
          gl.clear();
          gl.render(scene, cam);
          gl.setRenderTarget(prev);
          const px = new Float32Array(N * N * 4);
          gl.readRenderTargetPixels(rt, 0, 0, N, N, px);
          // RGBE, rows top first (GL reads bottom first)
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
        }, { eye: room.eyeVillage, f: f.f, u: f.u, N: FACE });
        writeFileSync(join(OUT, `${room.unit}_${key}_${f.id}.hdrface`), Buffer.from(b64, "base64"));
        console.log(`progress: ${room.unit} ${key} ${f.id}`);
      }
      meta.keys.push({ id: key, time: times[key], ...state });
    }
    await P.page.evaluate(() => {
      window.__wvRestore?.();
      window.__cvShot = null;
    });
    writeFileSync(join(OUT, `${room.unit}.json`), JSON.stringify(meta, null, 1));
  }
  if (run.errors.length) console.log(`console/page errors: ${JSON.stringify(run.errors.slice(0, 8), null, 1)}`);
} finally {
  await browser.close();
}
process.exit(0);
