// 클릭 이동의 목적지 링 (owner 2026-11-10: "찍은 부분의 동그라미가 간혹 안 나타나거나 제대로 표시가 안 된다").
//
// A sweep of real clicks (a mouse on a PC, CDP finger taps on a phone) over the canvas in 케이슨 마을 (the plaza, the
// lane and forecourt, a plot lawn, the creek), the memorial hall's interior, the legacy world and the escape hall, plus
// named cases (the fountain, the own avatar, a house wall, the memorial, a lane, the forecourt, a plot lawn, clicks from a
// bench seat, the creek, past the creek, past the area) and a long walk toward a far ring.
//
//   server/: TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json PORT=2697 npx tsx src/index.ts   (the path is the repo root's)
//   client/: VITE_SERVER_URL=http://localhost:2697 npx vite --port 5297 --strictPort
//   CV_CLIENT_URL=http://localhost:5297 node e2e/click-marker.mjs
//     CM_DEVICES=desktop,phone   CM_PLACES=village,hall,legacy,hub,cases,walk   CM_EVIDENCE=<dir>   CM_TAG=<name>   CM_CASES=<id,...>
//
// Every click is judged from the player's side by an oracle that does not use the app's picker:
//  - under the cursor: the first visible surface along the click ray (see-through things skipped: sprites, shadows,
//    decals, water, glass that writes no depth, colliders). Whether an alpha-tested surface (a leaf card) is really
//    drawn at that pixel is asked of the GPU, not of the texture: the frame is rendered for that one pixel with the
//    mesh and without it (round 2 review: the oracle used to share the app's blind spot and passed refused clicks on
//    the lawn seen between leaves). The surface is "ground" — what a body can stand on, the walk rule of the spec —
//    when it is low ground (facing up, n.y >= 0.8, no higher than 12 cm) inside the area and clear of every collider
//    grown by the player's radius, or out in the open (no collider) a raised flat up to a step's 46 cm (the bridge's
//    deck, the memorial's steps) or a curb's side (a face no higher than 12 cm). Otherwise it is an avatar, a solid
//    thing (a wall, a bench, a roof, leaves), low ground in a collider or past the area, or nothing. Two cases may go
//    either way and are never "missing": leaves the camera's near fade dithers ("leafy": the dither follows the screen
//    pixel), ground seen through a gap right at a leaf's edge ("ground-leafedge": a neighbouring pixel shows it), and
//    a click right at a body's outline ("avatar-edge": a body 2 px away; the idle pose moves it between look and click).
//  - the ring: where it is (its centre against the surface under the cursor, its size as drawn) and how much of it
//    reaches the screen. Three renders of the same frame (as drawn / the ring forced on top / the ring hidden) give the
//    drawn fraction; rays from the camera to 17 points of the ring (weighted by their area on the screen) give the
//    fraction a solid thing above 15 cm may hide (a bench, a wall, an avatar, leaves; where a sample looks through
//    leaves its whole share, since one pixel cannot say how much of its sector they cover). Ground or a curb in front of
//    the ring never excuses a hidden ring.
// Fails: a clean ground click with no ring (missing); a ring drawn less than the oracle allows (hidden; "sunk" too when
// ground or a curb is what covers it, or the ring lies under the clicked surface); a ring off the screen or too small
// to read (tiny: under 6 px tall); a ring away from the click or on a non-ground click that the avatar then does not
// reach (misleading); a ring that is lost while the avatar walks to it (pop-in).

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { CLIENT_URL, DESKTOP, PHONE, REPO, createRun, joinAsTeacher, openPlayer, pos, sleep, walkAndWait } from "./lib/escape.mjs";
import { enterHall, joinVillage } from "./lib/village.mjs";

const require = createRequire(join(REPO, "package.json"));
const { PNG } = require("playwright-core/lib/utilsBundle");

const DEVICES = (process.env.CM_DEVICES || "desktop,phone").split(",");
const PLACES = (process.env.CM_PLACES || "village,hall,legacy,hub,cases,walk").split(",");
/** Only these named cases (debugging; default all). */
const CASES = process.env.CM_CASES?.split(",");
const wantCase = (id) => !CASES || CASES.includes(id);
const TAG = process.env.CM_TAG || "run";
const run = createRun(`click-marker-${TAG}`);
if (process.env.CM_EVIDENCE) run.evidence = process.env.CM_EVIDENCE;
mkdirSync(join(run.evidence, "rings"), { recursive: true });

/** Drawn fraction allowed below the oracle's expectation (antialiasing at the ring's edge, the oracle's 17 samples). */
const VIS_SLACK = 0.12;
/** A ring this far (m) from the surface under the cursor is "moved": the avatar must then reach it. */
const AT_CLICK_M = 0.15;
/** Arrival: the walk ends within this of the ring (the game's arrival radius is 0.35 m). */
const ARRIVE_M = 0.45;
/** A ring drawn less than this tall on the screen (CSS px) cannot be read (a far ring is a thin ellipse). */
const TINY_PX = 4;

const r2 = (n) => (n == null ? n : Math.round(n * 100) / 100);
const all = [];

// ───────────────────────────────────────────── the in-page oracle ─────────────────────────────────────────────

async function installProbe(p) {
  await p.page.evaluate(async () => {
    const f = await window.__imp("/@react-three_fiber.js");
    const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
    const am = await window.__imp("/src/game/activeMap.ts");
    // the village's foliage thins out near the camera (a screen-door dither between these view depths; main has none)
    const fadeBand = (await window.__imp("/src/village/villageModelPrep.ts").catch(() => null))?.FOLIAGE_NEAR_FADE ?? null;
    const canvas = document.querySelector(".cv-canvas canvas");
    const root = f._roots.get(canvas) ?? [...f._roots.values()].pop();
    const st = () => root.store.getState();
    const R = 0.4; // PLAYER_RADIUS
    const ray = new THREE.Raycaster();
    const n = new THREE.Vector3();
    const m4 = new THREE.Matrix4();
    const im = new THREE.Matrix4();
    const nm = new THREE.Matrix3();

    function markerParts() {
      let ring = null;
      st().scene.traverse((o) => {
        if (!ring && o.isMesh && o.geometry?.type === "RingGeometry" && Math.abs(o.geometry.parameters.innerRadius - 0.3) < 1e-6) ring = o;
      });
      if (!ring) return null;
      return { ring, group: ring.parent, meshes: ring.parent.children.filter((c) => c.isMesh) };
    }
    // One pixel of the frame, rendered on its own (the camera's view offset to that pixel), with `hide` hidden. The
    // shadow map is held as it is, the destination ring hidden, so only `hide` can change the pixel.
    const rt = new THREE.WebGLRenderTarget(1, 1);
    const pcam = new THREE.PerspectiveCamera();
    const pixA = new Uint8Array(4);
    const pixB = new Uint8Array(4);
    function renderPixel(sx, sy, hide, out) {
      const { gl, scene, camera } = st();
      const r = gl.domElement.getBoundingClientRect();
      pcam.copy(camera);
      pcam.setViewOffset(r.width, r.height, sx - 0.5, sy - 0.5, 1, 1);
      pcam.updateProjectionMatrix();
      const mk = markerParts();
      const mkVis = mk?.group.visible;
      if (mk) mk.group.visible = false;
      const was = hide ? hide.visible : null;
      if (hide) hide.visible = false;
      const auto = gl.shadowMap.autoUpdate;
      gl.shadowMap.autoUpdate = false;
      const prev = gl.getRenderTarget();
      gl.setRenderTarget(rt);
      gl.clear(true, true, true);
      gl.render(scene, pcam);
      gl.readRenderTargetPixels(rt, 0, 0, 1, 1, out);
      gl.setRenderTarget(prev);
      gl.shadowMap.autoUpdate = auto;
      if (hide) hide.visible = was;
      if (mk) mk.group.visible = mkVis;
    }
    /** Whether `obj` is drawn at canvas pixel (sx, sy): the pixel changes when it is hidden. */
    function drawnAt(obj, sx, sy) {
      renderPixel(sx, sy, null, pixA);
      renderPixel(sx, sy, obj, pixB);
      return Math.max(Math.abs(pixA[0] - pixB[0]), Math.abs(pixA[1] - pixB[1]), Math.abs(pixA[2] - pixB[2])) > 2;
    }
    /** A material that may draw only part of its surface (an alpha-tested card, a hashed one). */
    const cutout = (mat) => !!mat && (mat.alphaTest > 0 || !!mat.alphaMap || !!mat.alphaHash);
    /** The canvas pixel a world point projects to (null behind the camera). */
    function canvasPx(v3) {
      const { camera, gl } = st();
      const r = gl.domElement.getBoundingClientRect();
      const v = v3.clone().project(camera);
      if (v.z > 1) return null;
      return [((v.x + 1) / 2) * r.width, ((1 - v.y) / 2) * r.height];
    }
    function inMarker(o) {
      const mk = markerParts();
      for (let a = o; a; a = a.parent) if (mk && a === mk.group) return true;
      return false;
    }
    const shown = (o) => {
      for (let a = o; a; a = a.parent) if (a.visible === false) return false;
      return true;
    };
    const matOf = (h) => {
      const ms = Array.isArray(h.object.material) ? h.object.material : [h.object.material];
      return ms[h.face?.materialIndex ?? 0] ?? ms[0];
    };
    function seeThrough(o, mat) {
      if (o.isSprite || o.isPoints || o.isLine) return true;
      if (/^col__/.test(o.name)) return true;
      if (!mat || mat.visible === false || mat.type === "ShadowMaterial" || mat.colorWrite === false) return true;
      return !!(mat.transparent && mat.depthWrite === false);
    }
    function isAvatar(o) {
      for (let a = o; a; a = a.parent) if (a.isSkinnedMesh || a.userData?.clickPick === "block") return true;
      return false;
    }
    function upNormal(h, dir) {
      if (!h.face) return 0;
      m4.copy(h.object.matrixWorld);
      if (h.object.isInstancedMesh && h.instanceId !== undefined) {
        h.object.getMatrixAt(h.instanceId, im);
        m4.multiply(im);
      }
      nm.getNormalMatrix(m4);
      n.copy(h.face.normal).applyMatrix3(nm).normalize();
      if (n.dot(dir) > 0) n.negate();
      return n.y;
    }
    /**
     * `glass`: also stop at blended surfaces that write no depth but still tint what is behind them (glass, a gate).
     * `fromCamera`: the ray is the camera's through a pixel, so a cut-out surface (leaves) is checked on the GPU.
     */
    /** After first(): whether its line of sight crossed leaves (a cut-out card passed at a gap, or a dithered one). */
    let lastLeafy = false;
    /** After first(): the cut-out meshes it looked through at a gap (for the leaf-edge check). */
    let lastGaps = [];
    function first(origin, dir, near, far, glass = false, fromCamera = false) {
      ray.set(origin, dir);
      ray.camera = st().camera; // sprites (name tags) refuse a ray without it
      ray.near = near;
      ray.far = far;
      lastLeafy = false;
      lastGaps = [];
      const drawn = new Map();
      for (const h of ray.intersectObjects(st().scene.children, true)) {
        if (!shown(h.object) || inMarker(h.object)) continue;
        const mat = matOf(h);
        const tints = glass && mat && mat.visible !== false && mat.transparent && mat.opacity > 0.05 && !mat.isShadowMaterial && !h.object.isSprite && !h.object.isPoints && h.point.y > 0.15;
        if (!tints && seeThrough(h.object, mat)) continue;
        // leaves near the camera are dithered out (the branch's villageModelPrep FOLIAGE_NEAR_FADE): gone nearer than
        // the band, partly drawn inside it (the dither follows the screen pixel: neither a ray nor a one-pixel render can
        // tell which) — a hit there is "leafy"
        const fading = typeof mat?.userData?.nearFade === "number" && fadeBand;
        if (fading && h.distance < fadeBand[0]) continue;
        if (fading && h.distance < fadeBand[1]) {
          lastLeafy = true;
          return { x: h.point.x, y: h.point.y, z: h.point.z, dist: h.distance, ny: upNormal(h, dir), name: h.object.name || h.object.type, mat: mat?.name || mat?.type, avatar: false, fadeBand: true };
        }
        if (cutout(mat)) lastLeafy = true;
        if (fromCamera && cutout(mat)) {
          if (!drawn.has(h.object)) {
            const at = canvasPx(h.point);
            drawn.set(h.object, !at || drawnAt(h.object, at[0], at[1]));
            if (!drawn.get(h.object)) lastGaps.push(h.object);
          }
          if (!drawn.get(h.object)) continue; // nothing of it at this pixel: the gap between the leaves
        }
        return { x: h.point.x, y: h.point.y, z: h.point.z, dist: h.distance, ny: upNormal(h, dir), name: h.object.name || h.object.type, mat: mat?.name || mat?.type, avatar: isAvatar(h.object) };
      }
      return null;
    }
    function classify(hit) {
      if (!hit) return "nothing";
      if (hit.avatar) return "avatar";
      const b = am.activeBounds();
      const outside = hit.x < b.minX + R || hit.x > b.maxX - R || hit.z < b.minZ + R || hit.z > b.maxZ - R;
      const inCollider = am.getActiveMap().geometry.obstacles.some((o) => hit.x > o.minX - R && hit.x < o.maxX + R && hit.z > o.minZ - R && hit.z < o.maxZ + R);
      const low = hit.ny >= 0.8 && hit.y <= 0.12;
      // out in the open, a body stands on a raised flat up to a step (the bridge's deck, the memorial's steps) and on a curb's side
      const open = (hit.ny >= 0.8 && hit.y <= 0.46) || (hit.y > 0 && hit.y <= 0.12);
      if (!low && !(open && !outside && !inCollider)) return "solid";
      if (outside) return "ground-outside";
      if (inCollider) return "ground-in-collider";
      // the ground at the avatar's own feet (within the game's 0.35 m arrival radius): already there, no ring needed
      const me = window.__cv.getPos();
      if (Math.hypot(hit.x - me.x, hit.z - me.z) < 0.35) return "ground-here";
      return "ground";
    }
    const round = (h) => h && { ...h, x: +h.x.toFixed(3), y: +h.y.toFixed(3), z: +h.z.toFixed(3), dist: +h.dist.toFixed(2), ny: +h.ny.toFixed(2) };
    function analyze(sx, sy) {
      const { gl, camera } = st();
      const r = gl.domElement.getBoundingClientRect();
      ray.setFromCamera(new THREE.Vector2(((sx - r.left) / r.width) * 2 - 1, -(((sy - r.top) / r.height) * 2 - 1)), camera);
      // three keeps a skinned mesh's bounds from the pose it first measured: measure them again in this pose
      st().scene.traverse((m) => {
        if (m.isSkinnedMesh) {
          m.boundingSphere = null;
          m.boundingBox = null;
        }
      });
      const o = ray.ray.origin.clone();
      const d = ray.ray.direction.clone();
      const hit = first(o, d, camera.near, camera.far, false, true);
      let kind = classify(hit);
      // Right at a body's outline (a head's top, a hand) the idle pose moves a few cm between this look and the click:
      // a pixel 2 px away on a body (or off it) makes it a coin toss, fair either way.
      if (kind !== "avatar" && kind !== "nothing") {
        const bodies = [];
        st().scene.traverse((m) => m.isSkinnedMesh && shown(m) && bodies.push(m));
        for (const [dx, dy] of [[-2, 0], [2, 0], [0, -2], [0, 2]]) {
          ray.setFromCamera(new THREE.Vector2(((sx + dx - r.left) / r.width) * 2 - 1, -(((sy + dy - r.top) / r.height) * 2 - 1)), camera);
          const b = ray.intersectObjects(bodies, false)[0];
          if (b && (!hit || b.distance < hit.dist)) kind = "avatar-edge";
        }
      }
      // Leaves dithered near the camera, or ground seen through a gap right at a leaf's edge (a neighbouring pixel
      // shows the leaf: the app samples the texture, the GPU a filtered mip of it): either outcome is fair there.
      if (hit?.fadeBand) kind = "leafy";
      else if (kind === "ground" && lastGaps.length) {
        const cx = sx - r.left, cy = sy - r.top;
        const near8 = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
        if (lastGaps.some((obj) => near8.some(([dx, dy]) => drawnAt(obj, cx + dx, cy + dy)))) kind = "ground-leafedge";
      }
      return { hit: round(hit), kind };
    }
    /** The ring as drawn: its centre and its size (the world scale of its mesh: 1 = 0.42 m outer radius; the pulse is held at 1 while probing). */
    function ring() {
      const mk = markerParts();
      if (!mk || !shown(mk.group)) return null;
      mk.ring.updateWorldMatrix(true, false);
      const v = new THREE.Vector3().setFromMatrixPosition(mk.ring.matrixWorld);
      const s = new THREE.Vector3().setFromMatrixScale(mk.ring.matrixWorld).x;
      return { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3), s: +s.toFixed(3) };
    }
    /**
     * What may hide the ring: a ray from the camera to the middle of each of 16 sectors of the band and to the dot,
     * each weighted by its area on the screen (a far ring is a thin ellipse whose ends hold most of its pixels).
     */
    function ringOracle() {
      const rg = ring();
      if (!rg) return null;
      const { camera, gl } = st();
      const cam = camera.position.clone();
      const rect = gl.domElement.getBoundingClientRect();
      const px = (x, z) => {
        const v = new THREE.Vector3(x, rg.y, z).project(camera);
        return [((v.x + 1) / 2) * rect.width, ((1 - v.y) / 2) * rect.height];
      };
      const area = (pts) => {
        let a = 0;
        for (let i = 0; i < pts.length; i++) {
          const [x1, y1] = pts[i];
          const [x2, y2] = pts[(i + 1) % pts.length];
          a += x1 * y2 - x2 * y1;
        }
        return Math.abs(a) / 2;
      };
      const samples = [];
      const N = 16;
      for (let k = 0; k < N; k++) {
        const a0 = (k / N) * Math.PI * 2, a1 = ((k + 1) / N) * Math.PI * 2, am = (a0 + a1) / 2;
        const ri = 0.3 * rg.s, ro = 0.42 * rg.s, rm = 0.36 * rg.s;
        const w = area([px(rg.x + Math.cos(a0) * ri, rg.z + Math.sin(a0) * ri), px(rg.x + Math.cos(a0) * ro, rg.z + Math.sin(a0) * ro), px(rg.x + Math.cos(a1) * ro, rg.z + Math.sin(a1) * ro), px(rg.x + Math.cos(a1) * ri, rg.z + Math.sin(a1) * ri)]);
        samples.push([rg.x + Math.cos(am) * rm, rg.z + Math.sin(am) * rm, w]);
      }
      const dd = 0.07 * rg.s;
      const dot = area([px(rg.x - dd, rg.z - dd), px(rg.x + dd, rg.z - dd), px(rg.x + dd, rg.z + dd), px(rg.x - dd, rg.z + dd)]);
      samples.push([rg.x, rg.z, dot]);
      let legit = 0, sunk = 0, leafy = 0, total = 0;
      const what = {};
      for (const [x, z, w] of samples) {
        total += w;
        const dir = new THREE.Vector3(x, rg.y, z).sub(cam);
        const dist = dir.length();
        dir.normalize();
        const h = first(cam, dir, camera.near, dist + 0.2, true, true);
        // a line of sight through leaves: one pixel per sector cannot say how much of the sector they cover
        if (lastLeafy && (!h || h.dist < dist - 0.03 || h.fadeBand)) leafy += w;
        if (!h || h.dist >= dist - 0.03) continue;
        if (h.y > 0.15 || h.avatar) legit += w; // a solid thing (or an avatar's feet, or glass) in front of the ring
        else sunk += w; // ground or a curb in front of the ring: the ring is under it
        what[h.mat] = (what[h.mat] ?? 0) + 1;
      }
      if (!total) return { legit: 0, sunk: 0, leafy: 0, what };
      return { legit: +(legit / total).toFixed(3), sunk: +(sunk / total).toFixed(3), leafy: +(leafy / total).toFixed(3), what };
    }
    /** The ring's screen rectangle (client px) and centre. */
    function ringRect(rad) {
      const rg = ring();
      if (!rg) return null;
      const { gl, camera } = st();
      const r = gl.domElement.getBoundingClientRect();
      const v = new THREE.Vector3();
      let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, behind = false;
      for (let k = 0; k < 32; k++) {
        const a = (k / 32) * Math.PI * 2;
        v.set(rg.x + Math.cos(a) * rad * rg.s, rg.y, rg.z + Math.sin(a) * rad * rg.s).project(camera);
        if (v.z > 1) behind = true;
        const px = r.left + ((v.x + 1) / 2) * r.width;
        const py = r.top + ((1 - v.y) / 2) * r.height;
        minX = Math.min(minX, px); maxX = Math.max(maxX, px); minY = Math.min(minY, py); maxY = Math.max(maxY, py);
      }
      v.set(rg.x, rg.y, rg.z).project(camera);
      return { minX, minY, maxX, maxY, cx: r.left + ((v.x + 1) / 2) * r.width, cy: r.top + ((1 - v.y) / 2) * r.height, behind, vw: r.width, vh: r.height };
    }
    const saved = new Map();
    /** "normal" | "ontop" (no depth test, drawn last) | "hidden"; the pulse is held at 1 while probing. */
    function markerMode(mode) {
      const mk = markerParts();
      if (!mk) return false;
      if (!mk.group.__frozen) {
        mk.group.__frozen = true;
        mk.group.scale.set = function () {
          this.x = 1; this.y = 1; this.z = 1;
          return this;
        };
        mk.group.scale.set();
      }
      for (const mesh of mk.meshes) {
        if (!saved.has(mesh)) saved.set(mesh, { ro: mesh.renderOrder, dt: mesh.material.depthTest, vis: mesh.material.visible });
        const s0 = saved.get(mesh);
        mesh.renderOrder = mode === "ontop" ? 10000 : s0.ro;
        mesh.material.depthTest = mode === "ontop" ? false : s0.dt;
        mesh.material.visible = mode === "hidden" ? false : s0.vis;
      }
      return true;
    }
    function camInfo() {
      const { camera } = st();
      return { x: +camera.position.x.toFixed(2), y: +camera.position.y.toFixed(2), z: +camera.position.z.toFixed(2) };
    }
    function screenOf(x, y, z) {
      const { camera, gl } = st();
      const v = new THREE.Vector3(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, behind: v.z > 1 };
    }
    async function freeze(on) {
      const u = await window.__imp("/src/game/uiCapture.ts");
      if (on) u.acquireUiCapture("cm-probe");
      else u.releaseUiCapture("cm-probe");
    }
    async function clearTarget() {
      (await window.__imp("/src/game/clickMove.ts")).clearClickTarget();
    }
    // A look-half tap's walk starts from a 300 ms timer (CameraRig, the double-tap wait). Wrap the next such timer so
    // the avatar is held in the same task that sets its target: no frame walks it before the ring is measured (a ring
    // half a metre from the avatar was otherwise reached, and gone, before the probe could hold it).
    const uiCap = await window.__imp("/src/game/uiCapture.ts");
    const hold = { armed: false, fired: false };
    if (!window.__cmTimerWrapped) {
      window.__cmTimerWrapped = true;
      const orig = window.setTimeout.bind(window);
      window.setTimeout = (fn, ms, ...rest) => {
        if (window.__cmHold?.armed && typeof fn === "function" && /canTapWalk/.test(String(fn))) {
          const h = window.__cmHold;
          h.armed = false;
          return orig(() => {
            fn(...rest);
            h.fired = true;
            uiCap.acquireUiCapture("cm-probe");
          }, ms);
        }
        return orig(fn, ms, ...rest);
      };
    }
    window.__cmHold = hold;
    const holdNextWalk = () => {
      hold.armed = true;
      hold.fired = false;
    };
    const walkFired = () => hold.fired;
    /** The first visible surface straight down at (x, z) (a roof, a step, the creek's bed under the water). */
    function topAt(x, z, from = 60) {
      const h = first(new THREE.Vector3(x, from, z), new THREE.Vector3(0, -1, 0), 0, 200);
      return h && [h.x, h.y, h.z];
    }
    /** The first visible surface along a level ray from (x0, y, z0) toward (x1, y, z1) (a wall's face). */
    function faceAt(x0, z0, x1, z1, y) {
      const d = new THREE.Vector3(x1 - x0, 0, z1 - z0).normalize();
      const h = first(new THREE.Vector3(x0, y, z0), d, 0, 200);
      return h && [h.x, h.y, h.z];
    }
    /**
     * A pixel where a plain raycast meets an alpha-tested card (leaves) first but the GPU draws the ground behind it
     * there: the gap between the leaves (round 2 review blocker). Scans the screen; null when there is none.
     */
    function findLeafGap() {
      const { gl, camera } = st();
      const r = gl.domElement.getBoundingClientRect();
      for (let gy = 0.3; gy < 0.92; gy += 0.03)
        for (let gx = 0.03; gx < 0.97; gx += 0.03) {
          const sx = Math.round(r.width * gx), sy = Math.round(r.height * gy);
          ray.setFromCamera(new THREE.Vector2((sx / r.width) * 2 - 1, -((sy / r.height) * 2 - 1)), camera);
          const o = ray.ray.origin.clone(), d = ray.ray.direction.clone();
          const raw = first(o, d, camera.near, camera.far, false, false);
          if (!raw || !/^M_leaf/.test(raw.mat ?? "")) continue;
          const seen = first(o, d, camera.near, camera.far, false, true);
          if (seen && classify(seen) === "ground" && seen.dist > raw.dist + 0.5) return { x: r.left + sx, y: r.top + sy, leaf: raw.mat, ground: round(seen) };
        }
      return null;
    }
    window.__cm = { analyze, ring, ringOracle, ringRect, markerMode, camInfo, screenOf, freeze, clearTarget, topAt, faceAt, holdNextWalk, walkFired, findLeafGap };
  });
}

// ───────────────────────────────────────────── measuring a ring ─────────────────────────────────────────────

const target = (p) => p.page.evaluate(() => window.__cvClickTarget?.() ?? null);
const appPick = (p) => p.page.evaluate(() => window.__cvClickPick?.() ?? null);

function diff(a, b, i) {
  return Math.abs(a.data[i] - b.data[i]) + Math.abs(a.data[i + 1] - b.data[i + 1]) + Math.abs(a.data[i + 2] - b.data[i + 2]);
}

/** Drawn fraction of the ring: as drawn against forced on top, over the pixels the ring changes at all. */
async function ringVisibility(p, label, keep) {
  const rect = await p.page.evaluate(() => window.__cm.ringRect(0.44));
  if (!rect) return { onScreen: false, reason: "no ring" };
  if (rect.behind) return { onScreen: false, reason: "behind the camera", rect };
  const x0 = Math.max(0, Math.floor(rect.minX - 3)), y0 = Math.max(0, Math.floor(rect.minY - 3));
  const x1 = Math.min(rect.vw, Math.ceil(rect.maxX + 3)), y1 = Math.min(rect.vh, Math.ceil(rect.maxY + 3));
  const centreOn = rect.cx >= 0 && rect.cx <= rect.vw && rect.cy >= 0 && rect.cy <= rect.vh;
  if (x1 - x0 < 2 || y1 - y0 < 2 || !centreOn) return { onScreen: false, reason: "off screen", rect };
  const clip = { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
  const shots = {};
  for (const mode of ["normal", "ontop", "hidden"]) {
    await p.page.evaluate((m) => window.__cm.markerMode(m), mode);
    await sleep(110);
    shots[mode] = PNG.sync.read(await p.page.screenshot({ clip }));
  }
  await p.page.evaluate(() => window.__cm.markerMode("normal"));
  const A = shots.normal, B = shots.ontop, C = shots.hidden;
  let mask = 0, vis = 0;
  for (let i = 0; i < B.data.length; i += 4) {
    const dBC = diff(B, C, i);
    if (dBC < 60) continue;
    mask++;
    if (diff(A, B, i) < dBC / 2) vis++;
  }
  if (keep && label) {
    // the strip: as drawn | forced on top | hidden, three times larger (in device pixels: a phone's are 2 per CSS px)
    const W = A.width, H = A.height, S = W > clip.width ? 2 : 3;
    const out = new PNG({ width: W * 3 * S + 8, height: H * S });
    out.data.fill(255);
    [A, B, C].forEach((img, k) => {
      for (let y = 0; y < H * S; y++)
        for (let x = 0; x < W * S; x++) {
          const si = (Math.floor(y / S) * W + Math.floor(x / S)) * 4;
          const di = (y * out.width + (k * (W * S + 4) + x)) * 4;
          out.data[di] = img.data[si]; out.data[di + 1] = img.data[si + 1]; out.data[di + 2] = img.data[si + 2]; out.data[di + 3] = 255;
        }
    });
    writeFileSync(join(run.evidence, "rings", `${label}.png`), PNG.sync.write(out));
  }
  return { onScreen: true, maskPx: mask, visibleFrac: mask ? +(vis / mask).toFixed(3) : 0, centre: { x: r2(rect.cx), y: r2(rect.cy) }, tall: r2(rect.maxY - rect.minY), wide: r2(rect.maxX - rect.minX), clip };
}

/** A tap (CDP touch) or a mouse click at client (sx, sy). */
async function pressAt(p, sx, sy) {
  if (p.touch) {
    const cdp = p.cdp ?? (p.cdp = await p.ctx.newCDPSession(p.page));
    await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: sx, y: sy, id: 1, radiusX: 4, radiusY: 4, force: 1 }] });
    await sleep(60);
    await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.page.mouse.move(sx, sy);
    await p.page.mouse.down();
    await sleep(50);
    await p.page.mouse.up();
  }
}

/**
 * One click at (sx, sy): what is under it (oracle), the ring that appears (frozen in place: the avatar does not walk),
 * how much of the ring is drawn, then the target is dropped. `walk`: instead of dropping it, let the avatar walk and
 * record where it ends.
 */
async function probe(p, sx, sy, ctx, { walk = false, label = null } = {}) {
  const over = await p.page.evaluate(([x, y]) => {
    const e = document.elementFromPoint(x, y);
    return e ? `${e.tagName}.${e.className?.baseVal ?? e.className ?? ""}` : null;
  }, [sx, sy]);
  const row = { ...ctx, device: p.touch ? "phone" : "desktop", screen: { x: sx, y: sy } };
  if (!/^CANVAS/.test(over ?? "") && !/cv-stick-zone/.test(over ?? "")) return { ...row, skipped: over };
  const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [sx, sy]);
  row.kind = a.kind;
  row.hit = a.hit;
  const start = await pos(p);
  row.start = { x: r2(start.x), z: r2(start.z) };
  // Hold the avatar so the ring stays put while it is measured. A mouse click and a tap on the stick half walk at
  // once and ignore the hold; a tap on the look half is held back 300 ms (double tap) and refused under the hold, so
  // it is held the moment its walk starts, in the same task (window.__cm.holdNextWalk), before a frame can move it.
  const lookHalf = p.touch && sx >= p.page.viewportSize().width / 2;
  if (lookHalf) await p.page.evaluate(() => window.__cm.holdNextWalk());
  else await p.page.evaluate(() => window.__cm.freeze(true));
  await pressAt(p, sx, sy);
  if (lookHalf) {
    const t0 = Date.now();
    while (Date.now() - t0 < 900 && !(await p.page.evaluate(() => window.__cm.walkFired()))) await sleep(15);
    await p.page.evaluate(() => window.__cm.freeze(true)); // also when no walk came (nothing to hold, but symmetric)
  }
  await sleep(110);
  if (start.seatIndex >= 0 && (await target(p))) {
    // A click from a seat gets the body up first (the hold does not stop that): measure once it stands still.
    await p.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).catch(() => {});
    await sleep(1600);
  }
  const tgt = await target(p);
  const rg = await p.page.evaluate(() => window.__cm.ring());
  row.target = tgt ? { x: r2(tgt.x), z: r2(tgt.z), y: tgt.y == null ? null : r2(tgt.y) } : null;
  row.ring = rg;
  row.pick = await appPick(p);
  if (tgt && rg) {
    row.oracle = await p.page.evaluate(() => window.__cm.ringOracle());
    row.vis = await ringVisibility(p, label, !!label);
    row.fromClick = a.hit ? r2(Math.hypot(tgt.x - a.hit.x, tgt.z - a.hit.z)) : null;
    // the ring's height against the surface under it (a column ray straight down at the ring's centre)
    row.lift = a.hit && row.fromClick !== null && row.fromClick < 0.05 ? r2(rg.y - a.hit.y) : null;
  }
  if (!tgt && row.kind === "ground" && row.pick?.plan?.reason === "unreachable") {
    // The app says the avatar cannot even get going toward this ground. Check it for real: set the target directly
    // (no planner) and watch the walk — a fair refusal moves under half a metre and never arrives.
    await p.page.evaluate(() => window.__cm.freeze(false));
    await p.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [a.hit.x, a.hit.z]);
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && (await target(p))) await sleep(100);
    await p.page.evaluate(() => window.__cm.clearTarget());
    const end = await pos(p);
    row.rawWalk = { moved: r2(Math.hypot(end.x - start.x, end.z - start.z)), endToClick: r2(Math.hypot(end.x - a.hit.x, end.z - a.hit.z)) };
    row.fairRefusal = row.rawWalk.moved < 0.6 && row.rawWalk.endToClick > ARRIVE_M;
  }
  if (walk && tgt) {
    await p.page.evaluate(() => window.__cm.freeze(false));
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && (await target(p))) await sleep(150);
    const end = await pos(p);
    row.end = { x: r2(end.x), z: r2(end.z) };
    row.endToTarget = r2(Math.hypot(end.x - tgt.x, end.z - tgt.z));
  } else {
    await p.page.evaluate(() => window.__cm.clearTarget());
    await p.page.evaluate(() => window.__cm.freeze(false));
  }
  await sleep(60);
  judge(row);
  return row;
}

/**
 * The verdict of one click (see the header). Clicks whose ring is moved or on a non-ground surface are marked
 * `needsWalk` when they were not walked: the caller walks a sample of them.
 */
function judge(row) {
  const fails = [];
  const ringShown = !!(row.target && row.ring);
  if (!ringShown) {
    if (row.kind === "ground" && !row.fairRefusal) fails.push("missing");
    row.outcome = "no ring";
  } else {
    const v = row.vis;
    if (!v?.onScreen) fails.push("offscreen");
    else {
      const expected = 1 - (row.oracle?.legit ?? 0);
      // behind leaves the 17 samples cannot measure the cover: their share may be hidden too
      const hidden = v.visibleFrac < expected - (row.oracle?.leafy ?? 0) - VIS_SLACK;
      // ground or a curb in front of the ring (the oracle's sunk share) is never an excuse: then it is a sunk ring
      if ((hidden && row.oracle && row.oracle.sunk > 0.05) || (row.lift != null && row.lift < -0.001)) fails.push("sunk");
      if (row.lift != null && row.lift > 0.1) fails.push("floating"); // drawn in the air above the clicked surface
      if (hidden) fails.push("hidden");
      if (v.tall < TINY_PX) fails.push("tiny");
      row.expected = r2(expected);
    }
    const moved = row.fromClick === null || row.fromClick > AT_CLICK_M || row.kind !== "ground";
    row.outcome = moved ? "ring moved/off-ground" : "ring at click";
    if (row.endToTarget != null && row.endToTarget > ARRIVE_M) fails.push("misleading");
    if (moved && row.endToTarget == null) row.needsWalk = true;
  }
  row.fails = fails;
  row.ok = fails.length === 0;
}

function logRow(row) {
  if (row.skipped) return;
  const h = row.hit;
  const v = row.vis;
  const tail = row.target
    ? `ring (${row.target.x},${row.target.z}) y=${row.ring?.y} s=${row.ring?.s} d=${row.fromClick} vis=${v?.onScreen ? v.visibleFrac : v?.reason}${v?.onScreen ? ` ${v.wide}x${v.tall}px` : ""} exp=${row.expected ?? "-"}${row.oracle?.sunk ? ` sunk=${row.oracle.sunk}` : ""}${row.endToTarget != null ? ` end=${row.endToTarget}` : ""}`
    : `no ring${row.pick?.plan && !row.pick.plan.ok ? ` (${row.pick.plan.reason})` : ""}`;
  const line = `${row.ok ? "  ok " : "  BAD"} ${row.place}/${row.pose} (${row.screen.x},${row.screen.y}) ${row.kind}${h ? ` ${h.mat}@${h.y} d${h.dist}` : ""} -> ${tail}${row.fails.length ? "  [" + row.fails.join(",") + "]" : ""}`;
  if (!row.ok || process.env.CM_VERBOSE) console.log(line);
}

// ───────────────────────────────────────────── moving around ─────────────────────────────────────────────

async function setOrbitGoal(p, yaw, pitch, distance) {
  await p.page.evaluate(async ([yaw, pitch, distance]) => {
    (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch, distance };
  }, [yaw, pitch, distance]);
  for (let k = 0; k < 40; k++) {
    await sleep(150);
    if (!(await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal))) break;
  }
  await sleep(900);
}

async function walkRoute(p, route) {
  let at = null;
  for (const [x, z] of route) at = await walkAndWait(p, x, z, 40000, 1.0);
  return at;
}

async function waitScene(p, screen) {
  await p.page.waitForFunction((s) => window.__cv?.getScreen?.() === s, screen, { timeout: 60000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvClickTarget, null, { timeout: 30000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
}

// ───────────────────────────────────────────── the sweep ─────────────────────────────────────────────

function grid(p, cols, rows) {
  const vp = p.page.viewportSize();
  const pts = [];
  for (const fy of rows) for (const fx of cols) pts.push([Math.round(vp.width * fx), Math.round(vp.height * fy)]);
  return pts;
}

/** Sweep one camera pose at a spot; then walk a sample of the moved / off-ground rings (re-clicked from the same pose). */
async function sweepPose(p, place, spot, [yaw, pitch, dist], pts, walkMax = 2) {
  const poseTag = `y${Math.round(yaw * 100)}_p${Math.round(pitch * 100)}_d${dist}`;
  await setOrbitGoal(p, yaw, pitch, dist);
  const dev = p.touch ? "phone" : "desk";
  await p.page.screenshot({ path: join(run.evidence, `view_${dev}_${place}_${poseTag}.png`) });
  const rows = [];
  for (const [sx, sy] of pts) {
    const row = await probe(p, sx, sy, { place, pose: poseTag }, { label: `${dev}_${place}_${poseTag}_${sx}_${sy}` });
    rows.push(row);
    all.push(row);
    logRow(row);
  }
  // the honesty check: a ring that is not at the click (or not on ground) must be where the avatar then stops
  const toWalk = rows.filter((r) => r.needsWalk).slice(0, walkMax);
  // and a couple of plain ground rings walk too
  toWalk.push(...rows.filter((r) => r.outcome === "ring at click").filter((_, i) => i % 9 === 4).slice(0, 1));
  for (const r of toWalk) {
    if (spot) await walkAndWait(p, spot[0], spot[1], 30000, 0.6);
    await setOrbitGoal(p, yaw, pitch, dist);
    const w = await probe(p, r.screen.x, r.screen.y, { place, pose: poseTag, walked: true }, { walk: true, label: `${dev}_${place}_${poseTag}_${r.screen.x}_${r.screen.y}_walk` });
    all.push(w);
    logRow(w);
    if (w.target) r.walkedEnd = w.endToTarget;
  }
  if (spot) await walkAndWait(p, spot[0], spot[1], 30000, 0.8);
  return rows;
}

async function launch() {
  return chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
}

async function newPlayer(browser, device, tag) {
  const p = await openPlayer(browser, run, { tag, device, settings: { graphics: "auto" } });
  return p;
}

async function joinLegacy(p) {
  await p.page.goto(`${CLIENT_URL}/?world=legacy`, { waitUntil: "domcontentloaded" });
  await p.page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 40000 });
  await sleep(1200);
  await p.page.locator("input.cv-input").first().fill(("cm" + Math.floor(Math.random() * 9000 + 1000)).slice(0, 8));
  if (p.touch) await p.page.locator(".cv-submit").tap();
  else await p.page.locator(".cv-submit").click();
  await waitScene(p, "world");
}

const DESK_COLS = [0.12, 0.3, 0.5, 0.7, 0.88];
const DESK_ROWS = [0.45, 0.55, 0.65, 0.78, 0.9];
const PHONE_COLS = [0.12, 0.3, 0.5, 0.7, 0.88];
const PHONE_ROWS = [0.4, 0.5, 0.62, 0.75, 0.88];

const VILLAGE_SPOTS = [
  { id: "plaza", route: [[0, 18]], yaw: 0, poses: [[0.35, 6], [0.7, 12]] },
  { id: "forecourt", route: [[-20, 5], [-14, -20], [0, -33], [0, -40]], yaw: 0, poses: [[0.35, 6]] },
  { id: "plotlawn", route: [[0, 28], [30, 24], [44, 15]], yaw: -Math.PI / 2, poses: [[0.35, 6]] },
  { id: "creek", route: [[30, 24], [0, 28], [-11, 28], [-24, 46], [-12, 64]], yaw: Math.PI, poses: [[0.35, 6]] },
];

async function villageSweep(p, phone) {
  const spots = phone ? VILLAGE_SPOTS.slice(0, 1) : VILLAGE_SPOTS;
  for (const s of spots) {
    await run.step(`${phone ? "phone" : "desktop"} village ${s.id}`, async () => {
      await walkRoute(p, s.route);
      const at = s.route[s.route.length - 1];
      for (const pose of s.poses) {
        const pts = grid(p, phone ? PHONE_COLS : DESK_COLS, phone ? PHONE_ROWS : DESK_ROWS);
        const rows = await sweepPose(p, `village-${s.id}`, at, [s.yaw, ...pose], pts);
        summarizeCheck(`village ${s.id} ${pose.join("/")}`, rows);
      }
    });
  }
}

async function hallSweep(p, phone) {
  await run.step(`${phone ? "phone" : "desktop"} memorial hall`, async () => {
    await enterHall(p);
    await installProbe(p);
    const poses = phone ? [[0, 0.35, 6]] : [[0, 0.35, 6], [Math.PI / 2, 0.6, 6]];
    for (const [yaw, pitch, dist] of poses) {
      await walkAndWait(p, 300, 1.5, 15000, 0.6);
      const pts = grid(p, phone ? [0.15, 0.5, 0.85] : [0.12, 0.31, 0.5, 0.69, 0.88], [0.3, 0.45, 0.6, 0.75, 0.88]);
      const rows = await sweepPose(p, "hall", [300, 1.5], [yaw, pitch, dist], pts);
      summarizeCheck(`hall yaw ${r2(yaw)}`, rows);
    }
  });
}

async function otherSweep(p, which, phone) {
  await run.step(`${phone ? "phone" : "desktop"} ${which}`, async () => {
    if (which === "legacy") await joinLegacy(p);
    else {
      await joinAsTeacher(p, ("cm" + Math.floor(Math.random() * 9000 + 1000)).slice(0, 8));
      await waitScene(p, "hub");
    }
    await installProbe(p);
    const home = await pos(p);
    const poses = phone ? [[0, 0.35, 6]] : [[0, 0.35, 6], [Math.PI / 2, 0.8, 10]];
    for (const [yaw, pitch, dist] of poses) {
      const pts = grid(p, phone ? [0.15, 0.5, 0.85] : [0.12, 0.31, 0.5, 0.69, 0.88], [0.45, 0.6, 0.75, 0.88]);
      const rows = await sweepPose(p, which, [home.x, home.z], [yaw, pitch, dist], pts);
      summarizeCheck(`${which} yaw ${r2(yaw)}`, rows);
    }
  });
}

/** Named village cases: each one clicked for real, then walked. A ring must be where the avatar stops, or none. */
async function villageCases(p) {
  const out = [];
  /**
   * Stand on `from`'s last point, find a camera yaw (the given one, then up to 1 rad either side) from which the first
   * visible surface under the aimed point is the aimed thing (no tree, roof or own body in the way), click it for real
   * and let the avatar walk. A case whose aim cannot be seen fails as a setup error ("aim").
   */
  const caseAt = async (id, aim, from, yaw = 0, pitch = 0.35, dist = 6) => {
    if (!wantCase(id)) return null;
    if (from) await walkRoute(p, from);
    // an aim is a point, or ["top", x, z] / ["low", x, z] (under the eaves: from 1 m up) / ["face", x0, z0, x1, z1, y]:
    // the visible surface found there in the scene
    const world =
      aim[0] === "top" || aim[0] === "low"
        ? await p.page.evaluate(([x, z, from]) => window.__cm.topAt(x, z, from), [aim[1], aim[2], aim[0] === "low" ? 1 : 60])
        : aim[0] === "face"
          ? await p.page.evaluate((a) => window.__cm.faceAt(...a), aim.slice(1))
          : aim;
    let s = null;
    let seen = null;
    const tries = [];
    for (const dp of [0, 0.35]) for (const dy of [0, 0.5, -0.5, 1, -1]) tries.push([dy, dp]);
    for (const [dy, dp] of world ? tries : []) {
      await setOrbitGoal(p, yaw + dy, pitch + dp, dist);
      s = await p.page.evaluate(([x, y, z]) => window.__cm.screenOf(x, y, z), world);
      const vp = p.page.viewportSize();
      if (s.behind || s.x < 0 || s.y < 0 || s.x > vp.width || s.y > vp.height) continue;
      const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [Math.round(s.x), Math.round(s.y)]);
      const cam = await p.page.evaluate(() => window.__cm.camInfo());
      const tol = Math.max(0.6, 0.03 * Math.hypot(world[0] - cam.x, world[2] - cam.z));
      if (a.hit && Math.hypot(a.hit.x - world[0], a.hit.y - world[1], a.hit.z - world[2]) < tol) {
        seen = dy;
        break;
      }
      if (process.env.CM_VERBOSE) console.log(`    ${id} yaw+${dy} pitch+${dp}: aim ${world.map(r2)} hit ${a.hit ? `${a.hit.mat}@${[a.hit.x, a.hit.y, a.hit.z].map(r2)}` : "none"}`);
    }
    const row =
      seen === null
        ? { place: "case", pose: id, device: p.touch ? "phone" : "desktop", ok: false, fails: ["aim"], kind: "unseen" }
        : await probe(p, Math.round(s.x), Math.round(s.y), { place: "case", pose: id }, { walk: true, label: `case_${p.touch ? "phone" : "desk"}_${id}` });
    row.id = id;
    row.aimed = world && world.map((v) => r2(v));
    all.push(row);
    out.push(row);
    console.log(`  ${row.ok ? "ok " : "BAD"} case ${id}: ${row.kind} ${row.hit ? `${row.hit.mat}@(${row.hit.x},${row.hit.y},${row.hit.z})` : ""} -> ${row.target ? `ring (${row.target.x},${row.target.z}) vis=${row.vis?.onScreen ? row.vis.visibleFrac : row.vis?.reason} end=${row.endToTarget}` : "no ring"}${row.pick?.plan && !row.pick.plan.ok ? ` (${row.pick.plan.reason})` : ""}${row.fails?.length ? " [" + row.fails.join(",") + "]" : ""}`);
    return row;
  };
  await run.step("village cases", async () => {
    await caseAt("fountain_rim", [0, 0.5, 6.2], [[0, 16]]);
    await caseAt("fountain_water", ["top", 2, 3], [[0, 16]], 0, 0.7); // the basin's floor seen through the water
    await walkRoute(p, [[0, 16]]);
    const me = await pos(p);
    await caseAt("own_avatar", [me.x, 1.1, me.z], null);
    await caseAt("plaza_far", [-2, 0.01, 12], [[0, 26]], 0, 0.2);
    // house_5 (centre (-46, -8), 8 x 6, door east): its east wall at x = -42, seen from the plaza's west side
    await caseAt("house_wall", ["face", -36, -6, -46, -6, 1.2], [[-20, 5], [-34, -8]], Math.PI / 2);
    await caseAt("lane_concrete", [0, 0.017, -44], [[-20, 5], [-14, -20], [0, -33], [0, -40]], 0.5);
    await caseAt("forecourt_stone", [1, 0.03, -49.6], [[0, -42]], 0.5);
    // the memorial (front wall z = -52, steps 0.3 / 0.45 m) from its arrival point, the camera close (the lane's
    // cherries stand between it and a camera 6 m back)
    await caseAt("memorial_step", ["top", -5, -52], [[0, -46], [0, -49.4]], 0.3, 0.5, 3);
    await caseAt("memorial_wall", ["face", 3, -49, 3, -60, 2.0], [[0, -49.4]], -0.3, 0.25, 3);
    // the memorial's step in front of its door (a free spot, 30 cm up): walked to as clicked
    await caseAt("memorial_stairs", ["low", 0, -52.3], [[0, -49.4]], 0, 0.5, 3);
    // the ring road's 11 cm curb (z -30.7..-30.9 at x = 2.6): rings on the road beyond it and on the paving before it
    await caseAt("curb_road", [2.6, 0.01, -31.15], [[0, -40], [0, -33], [2.6, -28.5]], 0, 0.5, 7);
    await caseAt("curb_walk", [2.6, 0.01, -30.55], [[2.6, -28.5]], 0, 0.5, 7);
    await caseAt("plot_lawn", [56, 0.02, 13], [[0, -33], [-14, -20], [-20, 5], [0, 28], [30, 24], [44, 15]], -Math.PI / 2);
    // the lawn seen between a street tree's leaves (round 2 review blocker: refused as "a leaf" and no walk)
    if (wantCase("leaf_gap")) {
      await walkRoute(p, [[44, 15]]);
      let gap = null;
      for (const [yaw, pitch] of [[-Math.PI / 2, 0.35], [-Math.PI / 2 + 0.3, 0.35], [-Math.PI / 2 - 0.3, 0.45], [-Math.PI / 2, 0.55]]) {
        await setOrbitGoal(p, yaw, pitch, 6);
        gap = await p.page.evaluate(() => window.__cm.findLeafGap());
        if (gap) break;
      }
      const row = gap
        ? await probe(p, gap.x, gap.y, { place: "case", pose: "leaf_gap" }, { walk: true, label: "case_desk_leaf_gap" })
        : { place: "case", pose: "leaf_gap", device: "desktop", ok: false, fails: ["aim"], kind: "unseen" };
      row.id = "leaf_gap";
      row.gap = gap;
      all.push(row);
      out.push(row);
      console.log(`  ${row.ok ? "ok " : "BAD"} case leaf_gap: ${gap ? `through ${gap.leaf} at (${gap.x},${gap.y})` : "no gap found"} -> ${row.target ? `ring (${row.target.x},${row.target.z}) vis=${row.vis?.visibleFrac} end=${row.endToTarget}` : "no ring"}${row.fails?.length ? " [" + row.fails.join(",") + "]" : ""}`);
    }
    // Seated on a plaza bench (seat 8, plaza_5, facing the fountain; the seat lies inside the bench's collider): a click
    // on the paving ahead of it and one behind it get the avatar up and walk it to the ring (planned from the bench's
    // dismount point, where getting up puts the body).
    const sitOn = async (index, route) => {
      await walkRoute(p, route);
      const s = await p.page.evaluate(async (i) => (await window.__imp("/src/game/activeMap.ts")).activeSeats()[i], index);
      await walkAndWait(p, s.standX, s.standZ, 30000, 0.3);
      await sleep(500);
      await p.page.keyboard.press("KeyE");
      const ok = await p.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, index, { timeout: 8000 }).then(() => true, () => false);
      run.check(`seated on bench seat ${index} for the seated click`, ok, await pos(p));
      await sleep(1800); // the sit-down clip and the camera glide
    };
    if (wantCase("seated_ahead")) {
      await sitOn(8, [[30, 24], [0, 28], [-2.7, 13]]);
      await caseAt("seated_ahead", [-2.25, 0.01, 7.9], null, 0, 0.45, 6);
    }
    if (wantCase("seated_behind")) {
      await sitOn(8, [[30, 24], [0, 28], [-2.7, 13]]);
      await caseAt("seated_behind", [-4.6, 0.01, 13.6], null, Math.PI, 0.45, 6);
    }
    // Getting up: a click from the seat stands the body up, and a second click while the stand-up clip still carries
    // it off the bench (behind the bench) must be planned from where that glide lands (round 2 review): a ring the
    // avatar then reaches, or none.
    if (wantCase("stand_glide")) {
      await sitOn(8, [[30, 24], [0, 28], [-2.7, 13]]);
      await setOrbitGoal(p, Math.PI, 0.45, 6);
      await p.page.keyboard.press("KeyE"); // get up (no target of its own)
      await p.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).catch(() => {});
      // the click lands while the stand-up clip carries the body off the bench (main has no such hook: it clicks at once)
      await p.page
        .waitForFunction(async () => (await window.__imp("/src/game/seatMotion.ts")).localGlide?.current != null, null, { timeout: 1500, polling: 16 })
        .catch(() => {});
      const behind = await p.page.evaluate((w) => window.__cm.screenOf(...w), [-4.6, 0.01, 13.6]);
      const gliding = await p.page.evaluate(async () => (await window.__imp("/src/game/seatMotion.ts")).localGlide?.current != null);
      const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [Math.round(behind.x), Math.round(behind.y)]);
      await pressAt(p, Math.round(behind.x), Math.round(behind.y));
      await sleep(120);
      const tgt = await target(p);
      const row = { place: "case", pose: "stand_glide", id: "stand_glide", device: "desktop", kind: a.kind, hit: a.hit, gliding, target: tgt && { x: r2(tgt.x), z: r2(tgt.z) }, pick: await appPick(p) };
      if (tgt) {
        const t0 = Date.now();
        while (Date.now() - t0 < 30000 && (await target(p))) await sleep(150);
        const end = await pos(p);
        row.end = { x: r2(end.x), z: r2(end.z) };
        row.endToTarget = r2(Math.hypot(end.x - tgt.x, end.z - tgt.z));
      }
      row.fails = tgt && row.endToTarget > ARRIVE_M ? ["misleading"] : !tgt && a.kind === "ground" && row.pick?.plan?.reason !== "unreachable" ? ["missing"] : [];
      row.ok = row.fails.length === 0;
      all.push(row);
      out.push(row);
      console.log(`  ${row.ok ? "ok " : "BAD"} case stand_glide: clicked while gliding=${gliding}, ${a.kind} -> ${tgt ? `ring (${row.target.x},${row.target.z}) end=${row.endToTarget}` : "no ring"}${row.fails.length ? " [" + row.fails.join(",") + "]" : ""}`);
    }
    // the creek (z 72-78 at x = -6, its collider z 69-81) from its north bank
    await caseAt("creek_bed", ["top", -6, 77], [[0, 28], [-6, 50], [-6, 66]], Math.PI, 0.6, 5);
    await caseAt("far_bank", ["top", -6, 85], [[-6, 66]], Math.PI);
    await caseAt("beyond_bounds", ["top", -6, 105], [[-6, 66]], Math.PI, 0.25);
    // the bridge (x -26..-22, z 72..78): its deck's crown is 13-15 cm up — the creek's only crossing must take a click
    await caseAt("bridge_deck", ["top", -24, 75], [[-12, 64], [-24, 46], [-24, 66]], Math.PI, 0.5, 6);
    for (const r of out) run.check(`case ${r.id}: ${r.target ? "ring where the avatar stops" : "no ring"}`, r.ok, { kind: r.kind, target: r.target, endToTarget: r.endToTarget, fails: r.fails });
  });
}

/** A long walk toward a far ring: the ring must stay drawn the whole way (no pop-in). */
async function walkIn(p) {
  await run.step(`${p.touch ? "phone" : "desktop"} walk toward a far ring`, async () => {
    await walkAndWait(p, -14, 20, 30000, 0.5);
    await setOrbitGoal(p, -Math.PI / 2 + 0.75, 0.35, 6);
    // 28 m east along the plaza. A phone's narrow screen does not show that point: there the farthest plaza paving
    // straight up the screen's middle column, at least 14 m off (well past where the old ring vanished, ~8 m).
    let s;
    if (!p.touch) s = await p.page.evaluate((w) => window.__cm.screenOf(...w), [14, 0.01, 20]);
    else {
      const vp = p.page.viewportSize();
      const me = await pos(p);
      for (let y = Math.round(vp.height * 0.3); y < vp.height * 0.7 && !s; y += 6) {
        const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [Math.round(vp.width * 0.62), y]);
        if (a.kind === "ground" && a.hit.mat === "LM_plaza" && Math.hypot(a.hit.x - me.x, a.hit.z - me.z) >= 14) s = { x: vp.width * 0.62, y };
      }
      if (!run.check("a far plaza point is on the phone's screen", !!s, {})) return;
    }
    await pressAt(p, Math.round(s.x), Math.round(s.y));
    await sleep(p.touch ? 450 : 80);
    const tgt = await target(p);
    if (!run.check("the far plaza click sets a ring", !!tgt, { tgt, screen: s, pick: await appPick(p) })) return;
    const series = [];
    for (let k = 0; k < 40 && (await target(p)); k++) {
      await p.page.evaluate(() => window.__cm.freeze(true));
      await sleep(60);
      if (!(await target(p))) break;
      const oracle = await p.page.evaluate(() => window.__cm.ringOracle());
      const v = await ringVisibility(p, k % 4 === 0 ? `walkin_${p.touch ? "phone" : "desk"}_${k}` : null, k % 4 === 0);
      const at = await pos(p);
      series.push({ k, dist: r2(Math.hypot(at.x - tgt.x, at.z - tgt.z)), vis: v.onScreen ? v.visibleFrac : v.reason, expected: oracle ? r2(1 - oracle.legit) : null, leafy: oracle?.leafy ?? 0 });
      await p.page.evaluate(() => window.__cm.freeze(false));
      await sleep(450);
    }
    await p.page.evaluate(() => window.__cm.freeze(false)); // the loop may end while the avatar is held
    const bad = series.filter((s) => typeof s.vis !== "number" || s.vis < (s.expected ?? 1) - (s.leafy ?? 0) - VIS_SLACK);
    console.log("  walk-in:", series.map((s) => `${s.dist}m:${s.vis}`).join(" "));
    all.push({ place: "walkin", device: p.touch ? "phone" : "desktop", target: tgt, series, ok: bad.length === 0, fails: bad.length ? ["pop-in"] : [] });
    run.check("the ring stays drawn over the whole walk", bad.length === 0, { samples: series.length, bad: bad.slice(0, 6) });
  });
}

/** First person, a ground point ~20 m ahead: the ring must be drawn and readable (round 2 review: a 2 px line). */
async function firstPersonFar(p) {
  await run.step("desktop first person: a far ring", async () => {
    await walkAndWait(p, 0, 28, 30000, 0.6);
    await setOrbitGoal(p, 0, 0.35, 6);
    await p.page.keyboard.press("KeyV");
    await sleep(1500);
    const vp = p.page.viewportSize();
    let s = null;
    for (let y = Math.round(vp.height * 0.48); y < vp.height * 0.8 && !s; y += 4) {
      const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [Math.round(vp.width / 2), y]);
      if (a.kind === "ground" && a.hit.dist > 16 && a.hit.dist < 26) s = { x: Math.round(vp.width / 2), y, d: a.hit.dist };
    }
    if (run.check("a ground point 16-26 m ahead is on the first-person screen", !!s, {})) {
      const row = await probe(p, s.x, s.y, { place: "fp", pose: "far" }, { label: "fp_far" });
      row.id = "fp_far";
      all.push(row);
      logRow(row);
      run.check(`the far first-person ring reads (${row.vis?.wide}x${row.vis?.tall} px at ${r2(s.d)} m, vis ${row.vis?.visibleFrac})`, row.ok && row.vis?.tall >= 6, { fails: row.fails, vis: row.vis });
    }
    await p.page.keyboard.press("KeyV");
    await sleep(1200);
  });
}

/** A phone tap on the look half while a walk is under way: its ring shows at once, not 300 ms later (round 2 review). */
async function retapWhileWalking(p) {
  await run.step("phone: a second tap while walking shows its ring at once", async () => {
    await walkAndWait(p, 0, 18, 30000, 0.6);
    await setOrbitGoal(p, 0, 0.35, 6);
    const vp = p.page.viewportSize();
    const pts = [];
    for (let y = Math.round(vp.height * 0.45); y < vp.height * 0.7 && pts.length < 2; y += 10) {
      const x = Math.round(vp.width * (pts.length ? 0.85 : 0.65));
      const a = await p.page.evaluate(([x, y]) => window.__cm.analyze(x, y), [x, y]);
      if (a.kind === "ground" && a.hit.dist > 9) pts.push([x, y]);
    }
    if (!run.check("two far plaza points on the look half", pts.length === 2, { pts })) return;
    await pressAt(p, ...pts[0]);
    await p.page.waitForFunction(() => !!window.__cvClickTarget?.(), null, { timeout: 2000 }).catch(() => {});
    await sleep(250); // walking to A
    await pressAt(p, ...pts[1]);
    await sleep(60); // well inside the 300 ms double-tap wait
    const rg = await p.page.evaluate(() => window.__cm.ring());
    const plan = (await appPick(p))?.plan;
    const atB = !!(rg && plan?.ok && Math.hypot(rg.x - plan.x, rg.z - plan.z) < 0.05);
    run.check("the ring is at the new tap within 60 ms (while the double-tap wait runs)", atB, { ring: rg, plan });
    all.push({ place: "retap", device: "phone", ok: atB, fails: atB ? [] : ["late"], target: rg });
    await sleep(600);
    await p.page.evaluate(() => window.__cm.clearTarget());
  });
}

function summarizeCheck(label, rows) {
  const used = rows.filter((r) => !r.skipped);
  const bad = used.filter((r) => !r.ok);
  const by = {};
  for (const r of used) for (const f of r.fails) by[f] = (by[f] ?? 0) + 1;
  run.check(`${label}: every click judged ok (${used.length - bad.length}/${used.length})`, bad.length === 0, by);
}

// ───────────────────────────────────────────── main ─────────────────────────────────────────────

// The app's own warnings that are not this script's business, and the second copy of three the probe's import may load.
run.allow("legacy world: PCFSoftShadowMap deprecation", /PCFSoftShadowMap has been deprecated/);
run.allow("the probe's own three import", /Multiple instances of Three\.js being imported/);

/** One browser per place: a long run of WebGL scenes in one browser ends with Chrome refusing new contexts. */
async function inBrowser(fn) {
  const browser = await launch();
  try {
    await fn(browser);
  } finally {
    await browser.close();
  }
}

for (const device of DEVICES) {
  const phone = device === "phone";
  const dev = phone ? PHONE : DESKTOP;
  if (PLACES.some((x) => ["village", "hall", "cases", "walk"].includes(x))) {
    await inBrowser(async (browser) => {
      const p = await newPlayer(browser, dev, `${device}-village`);
      await run.step(`${device} join the village`, async () => {
        await joinVillage(p, "cm");
        await waitScene(p, "village");
        await installProbe(p);
      });
      if (PLACES.includes("walk")) await walkIn(p);
      if (PLACES.includes("walk") && phone) await retapWhileWalking(p);
      if (PLACES.includes("walk") && !phone) await firstPersonFar(p);
      if (PLACES.includes("village")) await villageSweep(p, phone);
      if (PLACES.includes("cases") && !phone) await villageCases(p);
    });
    if (PLACES.includes("hall"))
      await inBrowser(async (browser) => {
        const p = await newPlayer(browser, dev, `${device}-hall`);
        await run.step(`${device} join the village for the hall`, async () => {
          await joinVillage(p, "cm");
          await waitScene(p, "village");
          await installProbe(p);
        });
        await hallSweep(p, phone);
      });
  }
  for (const which of ["legacy", "hub"]) {
    if (!PLACES.includes(which)) continue;
    await inBrowser(async (browser) => {
      const p = await newPlayer(browser, dev, `${device}-${which}`);
      await otherSweep(p, which, phone);
    });
  }
}

// totals per device x place
const totals = {};
for (const r of all) {
  if (r.skipped || !r.fails) continue;
  const key = `${r.device}/${r.place}`;
  const t = (totals[key] ??= { clicks: 0, ok: 0, rings: 0, refused: 0 });
  t.clicks++;
  if (r.ok) t.ok++;
  if (r.target) t.rings++;
  else t.refused++;
  for (const f of r.fails) t[f] = (t[f] ?? 0) + 1;
}
console.log("\ntotals (device/place: clicks, ok, rings, refused, failures by kind)");
for (const [k, t] of Object.entries(totals)) console.log(`  ${k}: ${JSON.stringify(t)}`);
writeFileSync(join(run.evidence, `click-marker-${TAG}.json`), JSON.stringify({ totals, rows: all }, null, 1));
process.exit(run.finish({ totals }));
