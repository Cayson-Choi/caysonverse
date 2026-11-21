/**
 * e2e/solid-audit.mjs — "is everything you can see at body height also solid, and is every solid something you can see?"
 * (owner 2026-11-21: trees on a path, flowerbeds, lamp posts, a hedge and benches were walked through, one report after another:
 * "뭐 이렇게 문제가 많은거야"). Instead of a list of props somebody remembered, this looks at what the game DRAWS.
 *
 * The running scene is rendered from straight above with an orthographic camera whose near and far planes cut a slab out of it,
 * tile by tile (51.2 m, 5 cm a pixel):
 *
 *  1. WALKED THROUGH: the slab 0.5 .. 1.3 m over the ground (a walker's shins to chest). A drawn pixel where the body's centre may
 *     stand (inside the bounds, no collider within the player's radius) is something you can walk through. The pixels are
 *     clustered and each cluster is named (a ray cast down into the scene; what no ray names is found by hiding the scene's
 *     drawables one at a time). A cluster of MIN_AREA or more that is not on the allow list (ALLOW: what is meant to be walked
 *     under or through, each with its reason) FAILS the run.
 *  2. INVISIBLE WALLS: the slab 0.04 .. 2.5 m. Every collider up to 60 m2 is measured: the share of its box that holds anything
 *     drawn. Under 15 % is listed (a thin post or a fence line is expected there; a whole empty box is a collider with no prop).
 *
 * Two things make "what the game draws" hold still:
 *  - each tile is drawn as the game draws it AND once more with a plain two-sided material on everything but the plants: a closed
 *    volume that stands right through the slab (a wall, a post, a booth) shows a camera inside it nothing at all otherwise;
 *  - the game's own camera is parked over each tile first, twice (close by: the nearest level of detail of everything; and high
 *    above with the whole tile in view: instanced props are culled one by one against the game camera's frustum), and the lot
 *    buildings are held at their nearest level. What either view shows counts.
 *
 *   CV_CLIENT_URL=http://localhost:5581 node e2e/solid-audit.mjs [--park] [--phone] [--out=<folder>] [--report] [--tiles]
 *     --report            list only, never fail
 *     --ybot= --ytop=     another slab (e.g. 0.12 .. 0.5: kerbs and low beds); always a report
 *     --tiles [--tile=64] also save plan photographs of the ground with everything over 1.6 m cut away (paths, trunks, beds in plan)
 *
 * Output: <out>/solid-audit-<area>[-phone].json (the clusters with their names and verdicts, the colliders with nothing drawn).
 * The plants' own colliders come from the same idea, asked of the game directly: e2e/veg-colliders.mjs.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const park = process.argv.includes("--park");
const phone = process.argv.includes("--phone");
const report = process.argv.includes("--report"); // list only, never fail (the "before" numbers)
const outArg = process.argv.find((a) => a.startsWith("--out="));
const area = park ? "park" : "village";
const num = (k, d) => Number((process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=")[1] ?? d);
const Y_BOT = num("ybot", 0.5), Y_TOP = num("ytop", 1.3);
const sfx = Y_BOT === 0.5 && Y_TOP === 1.3 ? "" : `-${Y_BOT}-${Y_TOP}`;
const run = createRun(`solid-audit-${area}${phone ? "-phone" : ""}`);
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

/** A cluster smaller than this (m2 of drawn, walkable slab) is a leaf tip or a pixel seam, not a prop. */
const MIN_AREA = 0.02;
/** A bush's or a trunk's fringe up to this size (m2) is leaf tips and bark flare past its box: brushed, not walked through. */
const FRINGE_AREA = 0.15;
/** What may be drawn at body height where a walker stands: [name pattern, why]. Everything else fails the run. */
const ALLOW = [
  [/village_bus/, "the bus: a moving solid (shared busBody.ts pushes every body out of it, parked or driving)"],
  [/avatar|^Rig\b| < Rig /, "people (the guides and the driver stand on their own colliders; other players block on each client)"],
  [/veg_willow|M_veg_willow/, "a willow's hanging fronds: a curtain one walks through"],
  [/veg_leaf|M_veg_leaves|M_veg_blossom|M_veg_twigs|veg_(village|plaza|young|street|orchard)[a-z_]*_\d|_mid\b|_near\b|_far\b/, "a tree's leaves and twigs where a low branch hangs to shoulder height"],
  [/veg_flowers|M_veg_flowers|park_planting_blooms/, "flowers and grass on the ground (no kerb: lawn one walks on)"],
  [/not drawn a second time/, "leaves the shader bends away from the camera (seen from the audit's camera only)"],
  [/lake_grass|M_lake_tall/, "the reeds at the lake's edge: grass one wades through"],
  [/fishing_chair/, "the lake's folding chairs: the seat's box is the collider, the armrest tips reach 5 cm past it (seat approach, lakeLayout.ts)"],
];
/** The rides' own ground (fix/moonboat-seats owns their structures and railings): reported, not judged here. [x, z, radius, name] */
const RIDE_ZONES = park ? [[110, -135, 28, "carousel"], [205, -138, 22, "wheel"], [-95, -140, 26, "moon boat"], [-75, -88, 14, "drop tower"], [2, -6, 20, "coaster station"]] : [];
const verdict = (c) => {
  const what = c.what ?? "?";
  const zone = RIDE_ZONES.find(([x, z, r]) => Math.hypot(c.cx - x, c.cz - z) < r);
  if (zone) return `ride: ${zone[3]}`;
  const hit = ALLOW.find(([re]) => re.test(what));
  if (hit) return `allowed: ${hit[1]}`;
  if (/veg_bush|M_veg_bush|veg_bark|M_veg_bark|lakehi_shrub|M_leaf_green/.test(what) && c.area < FRINGE_AREA) return "fringe: leaf tips / bark flare past the box";
  return "FAIL";
};

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
async function goTo(p, x, z, tol = 1.2) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(400);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 90000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "high" } });
let result = null;

await run.step("join", async () => {
  await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(A);
  await A.page.locator("input.cv-input").first().fill(`Au${Math.floor(Math.random() * 900 + 100)}`);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(15000);
  const lotsIn = await until(async () => await A.page.evaluate(() => !!window.__cvLots?.()?.ready), 120000 * SLOW);
  run.check("the lot buildings are loaded", lotsIn);
  await until(async () => await A.page.evaluate(() => !!window.__cvVegDrawn?.()), 120000 * SLOW);
  await sleep(6000);
});

if (park)
  await run.step("enter the park", async () => {
    const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
    await goTo(A, g.x, g.z - 0.5, 1.0);
    await act(A);
    const inPark = await until(async () => (await areaOf(A)) === "park", 30000 * SLOW);
    run.check("in the park", inPark);
    await sleep(20000);
  });

await run.step("audit", async () => {
  result = await A.page.evaluate(
    async ({ area, Y_BOT, Y_TOP }) => {
      const T = await window.__imp("/three.js");
      const self = window.__cvSelfGroup();
      const st = self.__r3f.root.getState();
      const gl = st.gl;
      const scene = st.scene;
      const am = await window.__imp("/src/game/activeMap.ts");
      const obstacles = am.getActiveMap().geometry.obstacles;
      let bounds = am.activeBounds();
      const R = 0.4;
      // the village bounds also hold the hall and the house rooms far to the east: the outdoor village (and its lake) only
      if (area === "village") bounds = { minX: Math.max(bounds.minX, -100), maxX: Math.min(bounds.maxX, 190), minZ: Math.max(bounds.minZ, -100), maxZ: Math.min(bounds.maxZ, 100) };
      const CELL = 0.05, N = 1024, TILE = N * CELL;
      const G = 2;
      const grid = new Map();
      for (const o of obstacles) {
        const x0 = Math.max(Math.floor((o.minX - R) / G), -300), x1 = Math.min(Math.floor((o.maxX + R) / G), 300);
        const z0 = Math.max(Math.floor((o.minZ - R) / G), -300), z1 = Math.min(Math.floor((o.maxZ + R) / G), 300);
        for (let gx = x0; gx <= x1; gx++)
          for (let gz = z0; gz <= z1; gz++) {
            const k = gx * 1000 + gz;
            let l = grid.get(k);
            if (!l) grid.set(k, (l = []));
            l.push(o);
          }
      }
      const hit = (x, z, r) => {
        const l = grid.get(Math.floor(x / G) * 1000 + Math.floor(z / G));
        if (!l) return false;
        for (const o of l) {
          const cx = x < o.minX ? o.minX : x > o.maxX ? o.maxX : x;
          const cz = z < o.minZ ? o.minZ : z > o.maxZ ? o.maxZ : z;
          const dx = x - cx, dz = z - cz;
          if (dx * dx + dz * dz < (r - 0.01) * (r - 0.01)) return true;
        }
        return false;
      };
      const standable = (x, z) => x > bounds.minX + R && x < bounds.maxX - R && z > bounds.minZ + R && z < bounds.maxZ - R && !hit(x, z, R);

      const cam = new T.OrthographicCamera(-TILE / 2, TILE / 2, TILE / 2, -TILE / 2, 0, Y_TOP - Y_BOT);
      cam.up.set(0, 0, -1);
      const rt = new T.WebGLRenderTarget(N, N, { depthBuffer: true });
      const px = new Uint8Array(N * N * 4);
      const tiny = new T.OrthographicCamera(-0.1, 0.1, 0.1, -0.1, 0, Y_TOP - Y_BOT);
      tiny.up.set(0, 0, -1);
      const rt2 = new T.WebGLRenderTarget(4, 4, { depthBuffer: true });
      const p4 = new Uint8Array(64);
      const prevBg = scene.background, prevFog = scene.fog, prevVis = self.visible, prevClear = gl.getClearAlpha();
      const prevColor = new T.Color();
      gl.getClearColor(prevColor);
      const quiet = () => {
        scene.background = null;
        scene.fog = null;
        self.visible = false;
      };
      const shoot = (c, target, buf, n, x, z, y = Y_TOP) => {
        c.position.set(x, y, z);
        c.lookAt(x, 0, z);
        c.updateMatrixWorld(true);
        gl.setRenderTarget(target);
        gl.setClearColor(0x000000, 0);
        gl.clear(true, true, true);
        gl.render(scene, c);
        gl.readRenderTargetPixels(target, 0, 0, n, n, buf);
        gl.setRenderTarget(null);
      };
      // A closed volume that stands right through the slab (a wall, a post, a booth) shows the camera only its INSIDE, which a
      // one-sided material does not draw. So each tile is drawn twice: as the game draws it (the plants' leaf cards keep their
      // cut-out shapes), and once more with a plain two-sided material on everything but the plants (their solid cross-sections).
      const solidMat = new T.MeshBasicMaterial({ color: 0xffffff, side: T.DoubleSide });
      const plants = [];
      scene.traverse((o) => { if (/^village_vegetation$|^park_planting_blooms$/.test(o.name)) plants.push(o); });
      const shootSolid = (c, target, buf, n, x, z, y = Y_TOP) => {
        const shown = plants.map((o) => o.visible);
        plants.forEach((o) => { o.visible = false; });
        scene.overrideMaterial = solidMat;
        try {
          shoot(c, target, buf, n, x, z, y);
        } finally {
          scene.overrideMaterial = null;
          plants.forEach((o, i) => { o.visible = shown[i]; });
        }
      };
      const count4 = () => {
        let c = 0;
        for (let i = 3; i < 64; i += 4) if (p4[i] > 8) c++;
        return c;
      };
      const seenAt = (x, z) => {
        shoot(tiny, rt2, p4, 4, x, z);
        const a = count4();
        shootSolid(tiny, rt2, p4, 4, x, z);
        return a + count4();
      };
      const px2 = new Uint8Array(N * N * 4);
      // the other way round: a collider with nothing drawn in it is an invisible wall. Each tile is drawn a third time from 2.5 m
      // down to 4 cm over the ground (kerbs, beds, props, walls: everything but the ground itself and its paving), and every
      // collider up to 60 m2 whose middle lies in the tile is measured: the share of its box that holds something drawn.
      const GH_TOP = 2.5, GH_BOT = 0.04;
      const camG = new T.OrthographicCamera(-TILE / 2, TILE / 2, TILE / 2, -TILE / 2, 0, GH_TOP - GH_BOT);
      camG.up.set(0, 0, -1);
      const empty = [];
      const ray = new T.Raycaster();
      ray.camera = cam;
      const down = new T.Vector3(0, -1, 0);
      const nameOf = (o) => {
        const parts = [];
        for (let p = o, d = 0; p && d < 6; p = p.parent, d++) if (p.name) parts.push(p.name);
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        return `${parts.join(" < ") || o.type}${m?.name ? ` [${m.name}]` : ""}${o.isInstancedMesh ? " (inst)" : ""}`;
      };
      // every level-of-detail rule judges from the camera of the game: it is parked over each tile first (the photo camera,
      // __cvShot in CameraRig), and the lot buildings are held at their nearest level, so what a walker THERE sees is what is audited
      window.__cvLotsForce?.(2);
      // after the game camera moves: the game's own frames must run (its culling and level-of-detail rules act in them); counted
      // in frames, not seconds (a loaded machine draws one in 300 ms)
      const settle = async () => {
        for (let f = 0; f < 14; f++) await new Promise((r) => requestAnimationFrame(r));
        await new Promise((r) => setTimeout(r, 500));
        for (let f = 0; f < 4; f++) await new Promise((r) => requestAnimationFrame(r));
      };
      const clusters = [];
      let drawn = 0, total = 0, tiles = 0, flaggedPixels = 0;
      try {
        for (let tx = bounds.minX; tx < bounds.maxX; tx += TILE)
          for (let tz = bounds.minZ; tz < bounds.maxZ; tz += TILE) {
            const cx = tx + TILE / 2, cz = tz + TILE / 2;
            // Two looks at every tile, and what either shows counts: from close by (a walker's distance: the nearest level of
            // detail of everything) and from straight above with the whole tile in view (the lamp posts and other instanced
            // props are culled one by one against the game camera's frustum: outside its view they are not drawn at all).
            const NEAR = { x: cx, y: 9, z: cz + 7, tx: cx, ty: 0, tz: cz, fov: 60 };
            const OVER = { x: cx, y: 46, z: cz + 0.5, tx: cx, ty: 0, tz: cz, fov: 76 };
            const cov = new Uint8Array(N * N); // drawn in the walker's slab: 1 from close by, 2 only from above
            const covG = new Uint8Array(N * N); // drawn anywhere from the ground to 2.5 m
            for (const view of [NEAR, OVER]) {
              window.__cvShot = view;
              await settle();
              quiet();
              // (the plants are judged from close by only: from 46 m up their far level of detail is drawn, fuller than the bush a walker meets)
              const shown = plants.map((o) => o.visible);
              if (view === OVER) plants.forEach((o) => { o.visible = false; });
              shoot(camG, rt, px, N, cx, cz, GH_TOP);
              shootSolid(camG, rt, px2, N, cx, cz, GH_TOP);
              for (let k = 0; k < N * N; k++) if (px[k * 4 + 3] > 8 || px2[k * 4 + 3] > 8) covG[k] |= view === NEAR ? 1 : 2;
              shoot(cam, rt, px, N, cx, cz);
              shootSolid(cam, rt, px2, N, cx, cz);
              for (let k = 0; k < N * N; k++) if (!cov[k] && (px[k * 4 + 3] > 8 || px2[k * 4 + 3] > 8)) cov[k] = view === NEAR ? 1 : 2;
              plants.forEach((o, i) => { o.visible = shown[i]; });
            }
            // (the game camera is over the tile now: what only that view drew is named first, then the close view comes back)
            const flag = new Uint8Array(N * N);
            for (let j = 0; j < N; j++)
              for (let i = 0; i < N; i++) {
                if (!cov[j * N + i]) continue;
                const x = tx + (i + 0.5) * CELL;
                const z = tz + TILE - (j + 0.5) * CELL;
                if (x > bounds.maxX || z > bounds.maxZ) continue;
                drawn++;
                if (standable(x, z)) { flag[j * N + i] = 1; flaggedPixels++; }
              }
            total += N * N;
            tiles++;
            // the clusters of this tile (8-neighbourhood, bridging gaps of 2 cells), named while the tile is still in focus
            const mine = [];
            for (let s = 0; s < N * N; s++) {
              if (flag[s] !== 1) continue;
              const stack = [s];
              flag[s] = 2;
              let n = 0, i0 = N, i1 = -1, j0 = N, j1 = -1, si = 0, sj = 0;
              while (stack.length) {
                const k = stack.pop();
                const i = k % N, j = (k - i) / N;
                n++; si += i; sj += j;
                if (i < i0) i0 = i;
                if (i > i1) i1 = i;
                if (j < j0) j0 = j;
                if (j > j1) j1 = j;
                for (let dj = -2; dj <= 2; dj++)
                  for (let di = -2; di <= 2; di++) {
                    const ii = i + di, jj = j + dj;
                    if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
                    const q = jj * N + ii;
                    if (flag[q] === 1) { flag[q] = 2; stack.push(q); }
                  }
              }
              const wx = (i) => Math.round((tx + (i + 0.5) * CELL) * 100) / 100;
              const wz = (j) => Math.round((tz + TILE - (j + 0.5) * CELL) * 100) / 100;
              const si0 = s % N, sj0 = (s - si0) / N;
              mine.push({ over: cov[s] === 2, n, area: Math.round(n * CELL * CELL * 1000) / 1000, minX: wx(i0), maxX: wx(i1), minZ: wz(j1), maxZ: wz(j0), cx: wx(si / n), cz: wz(sj / n), at: [wx(si0), wz(sj0)], what: null });
            }
            mine.sort((a, b) => b.n - a.n);
            let drawables = [];
            const sphere = new T.Sphere();
            const listDrawables = () => {
            drawables = [];
            scene.traverse((o) => {
              if (!(o.isMesh || o.isPoints || o.isSprite || o.isLine) || !o.visible) return;
              let far = false;
              for (let q = o; q; q = q.parent) if (!q.visible) far = true;
              if (far) return;
              // (an instanced mesh is kept whatever its bounds; another one only when its bounding sphere reaches the tile)
              if (!o.isInstancedMesh && o.geometry) {
                if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
                sphere.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
                o.__auditSphere = [sphere.center.x, sphere.center.z, sphere.radius];
              } else o.__auditSphere = null;
              drawables.push(o);
            });
            };
            listDrawables();
            let byHiding = 0;
            for (const pass of [true, false]) {
            if (!pass) {
              if (!mine.some((c) => !c.over && c.area >= 0.015)) break;
              window.__cvShot = NEAR;
              await settle();
              quiet();
              listDrawables(); // (the close view shows other levels of detail: other objects)
            }
            for (const c of mine) {
              if (c.area < 0.015 || c.over !== pass) continue;
              for (const [x, z] of [[c.cx, c.cz], c.at]) {
                ray.set(new T.Vector3(x, Y_TOP, z), down);
                ray.far = Y_TOP - Y_BOT + 0.02;
                const hits = ray.intersectObjects(scene.children, true).filter((h) => h.object.visible && h.object !== self);
                if (hits.length) { c.what = nameOf(hits[0].object); break; }
              }
              // what no ray names (shader-placed geometry, sprites): hide the drawables one at a time over a 20 cm view of the spot
              if (!c.what && byHiding < 60) {
                byHiding++;
                const [x, z] = c.at;
                const base = seenAt(x, z);
                if (!base) { c.what = "? (not drawn a second time)"; continue; }
                for (const o of drawables) {
                  const sp = o.__auditSphere;
                  if (sp && Math.hypot(sp[0] - x, sp[1] - z) > sp[2] + 0.3) continue;
                  o.visible = false;
                  const now = seenAt(x, z);
                  o.visible = true;
                  if (now < base) { c.what = nameOf(o) + " (by hiding)"; break; }
                }
                c.what ??= "? (nothing hidden takes it away)";
              }
            }
            }
            for (const c of mine) delete c.over;
            clusters.push(...mine);
            // the colliders of this tile against what is drawn in them
            for (const o of obstacles) {
              const ox = (o.minX + o.maxX) / 2, oz = (o.minZ + o.maxZ) / 2;
              if (ox < tx || ox >= tx + TILE || oz < tz || oz >= tz + TILE) continue;
              if (ox < bounds.minX || ox > bounds.maxX || oz < bounds.minZ || oz > bounds.maxZ) continue;
              if ((o.maxX - o.minX) * (o.maxZ - o.minZ) > 60) continue;
              const i0 = Math.max(0, Math.floor((o.minX - tx) / CELL)), i1 = Math.min(N - 1, Math.ceil((o.maxX - tx) / CELL) - 1);
              const j0 = Math.max(0, Math.floor((tz + TILE - o.maxZ) / CELL)), j1 = Math.min(N - 1, Math.ceil((tz + TILE - o.minZ) / CELL) - 1);
              let n = 0, c = 0, cNear = 0, cOver = 0;
              for (let j = j0; j <= j1; j++)
                for (let i = i0; i <= i1; i++) {
                  n++;
                  if (covG[j * N + i]) c++;
                  if (covG[j * N + i] & 1) cNear++;
                  if (covG[j * N + i] & 2) cOver++;
                }
              if (n > 0 && c / n < 0.15) empty.push({ box: o, cover: Math.round((c / n) * 100) / 100, near: cNear, over: cOver, n });
            }
          }
      } finally {
        window.__cvShot = null;
        window.__cvLotsForce?.(null);
        scene.background = prevBg;
        scene.fog = prevFog;
        self.visible = prevVis;
        gl.setClearColor(prevColor, prevClear);
        rt.dispose();
        rt2.dispose();
        solidMat.dispose();
      }
      clusters.sort((a, b) => b.n - a.n);
      return { bounds, obstacles: obstacles.length, drawnShare: drawn / total, hidden: [], tiles, flaggedPixels, clusters, empty };
    },
    { area, Y_BOT, Y_TOP },
  );
  if (result.error) {
    run.check("the audit ran", false, result);
    return;
  }
  const big = result.clusters.filter((c) => c.area >= MIN_AREA);
  console.log(`obstacles ${result.obstacles}, tiles ${result.tiles}, drawn share ${(result.drawnShare * 100).toFixed(2)} %, hidden ${JSON.stringify(result.hidden)}`);
  console.log(`walk-through pixels ${result.flaggedPixels}; clusters ${result.clusters.length}, of ${MIN_AREA} m2 or more: ${big.length}`);
  const byWhat = {};
  for (const c of big) {
    const k = c.what ?? "?";
    (byWhat[k] ??= { count: 0, area: 0, eg: [] }).count++;
    byWhat[k].area += c.area;
    if (byWhat[k].eg.length < 5) byWhat[k].eg.push(`(${c.cx}, ${c.cz}) ${c.area}m2`);
  }
  for (const [k, v] of Object.entries(byWhat).sort((a, b) => b[1].area - a[1].area)) console.log(`  ${v.count} x ${k}: ${v.area.toFixed(2)} m2  e.g. ${v.eg.join("; ")}`);
  writeFileSync(join(run.evidence, `solid-audit-${area}${phone ? "-phone" : ""}${sfx}.json`), JSON.stringify(result, null, 1));
  console.log(`colliders with next to nothing drawn in them (under 15 % of the box): ${result.empty.length}`);
  for (const e of result.empty.slice(0, 60)) console.log(`  ${JSON.stringify(e.box)} drawn ${Math.round(e.cover * 100)} % (${e.near} / ${e.over} of ${e.n} px: close view / from above)`);
  const judged = {};
  for (const c of big) {
    c.verdict = verdict(c);
    (judged[c.verdict] ??= { count: 0, area: 0 }).count++;
    judged[c.verdict].area += c.area;
  }
  console.log("verdicts:");
  for (const [k, v] of Object.entries(judged).sort((a, b) => b[1].area - a[1].area)) console.log(`  ${v.count} x ${v.area.toFixed(2)} m2  ${k}`);
  writeFileSync(join(run.evidence, `solid-audit-${area}${phone ? "-phone" : ""}${sfx}.json`), JSON.stringify(result, null, 1));
  const bad = big.filter((c) => c.verdict === "FAIL");
  if (!report && sfx === "") run.check("nothing drawn at body height can be walked through", bad.length === 0, bad.slice(0, 12).map((c) => `${c.what} (${c.cx}, ${c.cz}) ${c.area} m2`));
  else console.log(`would fail: ${bad.length}${bad.length ? "  " + bad.slice(0, 20).map((c) => `${c.what} (${c.cx}, ${c.cz}) ${c.area} m2`).join("; ") : ""}`);
});

if (process.argv.includes("--tiles"))
  await run.step("plan photographs", async () => {
    // the ground from straight above with everything over 1.6 m cut away (crowns, roofs): paths, trunks, bushes, beds and props in plan
    const T_SIZE = num("tile", 64);
    const list = await A.page.evaluate(
      async ({ area, T_SIZE }) => {
        const T = await window.__imp("/three.js");
        const self = window.__cvSelfGroup();
        const st = self.__r3f.root.getState();
        const gl = st.gl, scene = st.scene;
        const am = await window.__imp("/src/game/activeMap.ts");
        let bounds = am.activeBounds();
        if (area === "village") bounds = { minX: -96, maxX: 96, minZ: -96, maxZ: 96 };
        const N = 1280;
        const cam = new T.OrthographicCamera(-T_SIZE / 2, T_SIZE / 2, T_SIZE / 2, -T_SIZE / 2, 0, 2.4);
        cam.up.set(0, 0, -1);
        const rt = new T.WebGLRenderTarget(N, N, { depthBuffer: true, colorSpace: T.SRGBColorSpace });
        const px = new Uint8Array(N * N * 4);
        const cv = document.createElement("canvas");
        cv.width = cv.height = N;
        const ctx = cv.getContext("2d");
        const prevBg = scene.background, prevFog = scene.fog, prevVis = self.visible;
        scene.background = new T.Color(0x202020);
        scene.fog = null;
        self.visible = false;
        const out = [];
        window.__cvLotsForce?.(2);
        for (let tx = bounds.minX; tx < bounds.maxX; tx += T_SIZE)
          for (let tz = bounds.minZ; tz < bounds.maxZ; tz += T_SIZE) {
            window.__cvShot = { x: tx + T_SIZE / 2, y: 9, z: tz + T_SIZE / 2 + 7, tx: tx + T_SIZE / 2, ty: 0, tz: tz + T_SIZE / 2, fov: 60 };
            await new Promise((r) => setTimeout(r, 1600));
            scene.background = new T.Color(0x202020);
            scene.fog = null;
            self.visible = false;
            cam.position.set(tx + T_SIZE / 2, 1.6, tz + T_SIZE / 2);
            cam.lookAt(tx + T_SIZE / 2, 0, tz + T_SIZE / 2);
            cam.updateMatrixWorld(true);
            gl.setRenderTarget(rt);
            gl.clear(true, true, true);
            gl.render(scene, cam);
            gl.readRenderTargetPixels(rt, 0, 0, N, N, px);
            gl.setRenderTarget(null);
            const img = ctx.createImageData(N, N);
            for (let j = 0; j < N; j++) img.data.set(px.subarray((N - 1 - j) * N * 4, (N - j) * N * 4), j * N * 4);
            for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
            ctx.putImageData(img, 0, 0);
            out.push({ tx, tz, url: cv.toDataURL("image/jpeg", 0.88) });
          }
        window.__cvShot = null;
        window.__cvLotsForce?.(null);
        scene.background = prevBg;
        scene.fog = prevFog;
        self.visible = prevVis;
        rt.dispose();
        return out;
      },
      { area, T_SIZE },
    );
    for (const t of list) writeFileSync(join(run.evidence, `plan-${area}-x${t.tx}-z${t.tz}.jpg`), Buffer.from(t.url.split(",")[1], "base64"));
    console.log(`plan tiles: ${list.map((t) => `x${t.tx} z${t.tz}`).join(", ")} (north up, ${T_SIZE} m a side)`);
  });

await b.close();
process.exit(run.finish());
