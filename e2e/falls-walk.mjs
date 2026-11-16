/**
 * e2e/falls-walk.mjs — B1 폭포 W5: walking at the waterfall's rest area (폭포 쉼터), the collisions, the camera keep-out, click
 * movement (a click on the pool walks to the nearest shore) and the stone seats, in the real game (docs/designs/waterfall/design.md
 * section 8, 9.1, 9.3). The waterfall's art is not in yet, so the script drops PLACEHOLDERS into the scene (dev only, named w5_*,
 * flat colours: the pocket's ground, the pool's water, the flat rocks, the two stones, a grey cliff along the camera wall) that
 * give the pictures and the click picks something to land on. They are drawn from the layout's numbers and prove nothing by
 * themselves; every check below runs on the app's real geometry and the real avatar.
 *
 *   server:  PORT=3001 npx tsx src/index.ts   (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3001 npx vite --port 5601 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5601 node e2e/falls-walk.mjs [--out=<folder>] [--phone] [--time=2026-11-03T21:00]
 *                                                              [--only=walk,push,perimeter,pool,seats,camera] [--camera-full]
 *
 * The camera pass writes camera-<tag>.json (every camera position seen) for the rock check (python, falls_shape.py).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PHONE, DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const phone = process.argv.includes("--phone");
const time = arg("time") ?? "2026-11-03T12:30";
const only = (arg("only") ?? "walk,push,perimeter,pool,seats,camera").split(",");
const tagTime = time.slice(11, 13) + "h";
const tag = `${phone ? "phone" : "pc"}-${tagTime}`;
const run = createRun(`falls-walk-${tag}`);
const OUT = arg("out") ?? run.evidence;
mkdirSync(OUT, { recursive: true });
const r2 = (n) => Math.round(n * 100) / 100;

// the village's own shader (a D3D11 compile warning of the real GPU; present on the branch without this work too)
run.allow("D3D11 X3595 gradient-in-loop shader warning", /X3595|WebGLProgram: Program Info Log/);
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device: phone ? PHONE : DESKTOP });
const shot = (name) => p.page.screenshot({ path: join(OUT, `${name}-${tag}.png`) });

// ───────────────────────────────────────────── in-page helpers ─────────────────────────────────────────────

await run.step("join", async () => {
  await joinVillage(p, "폭포", time);
  await p.page.waitForFunction(() => performance.getEntriesByType("resource").some((r) => r.name.split("?")[0].endsWith("/village/fallsWalk.ts")), null, { timeout: 30000 });
});

/** Everything the page needs, once: the layout's waterfall numbers and the rule functions. */
await p.page.evaluate(async () => {
  const lay = await window.__imp("/village/villageLayout.ts");
  const fw = await window.__imp("/village/fallsWalk.ts");
  const am = await window.__imp("/src/game/activeMap.ts");
  const cp = await window.__imp("/src/game/clickPlan.ts");
  const cm = await window.__imp("/src/game/clickMove.ts");
  const vs = await window.__imp("/src/game/viewState.ts");
  const W = lay.VILLAGE_LAYOUT.backdrop.waterfall;
  window.__w5 = {
    lay,
    fw,
    am,
    cp,
    cm,
    vs,
    W,
    /** W0's rule for a standing centre (falls_shape.py walk_surface_ok, without the outlet). */
    surfaceOk: (x, z) => fw.fallsWalkSurfaceOk(lay.VILLAGE_LAYOUT, x, z),
    /** collision.ts circleIntersectsAABB over every obstacle (slack 0): the exact test the server drops a Move by. */
    blocked: (x, z, r = 0.4) =>
      lay.villageGeometry.obstacles.some((b) => {
        const dx = x - Math.min(Math.max(x, b.minX), b.maxX);
        const dz = z - Math.min(Math.max(z, b.minZ), b.maxZ);
        return dx * dx + dz * dz < r * r;
      }),
    /** Plan a click on the ground at (x, z) exactly as the game does (clickPlan.ts) and walk it (the same target a click sets). */
    walk: (x, z, y = 0.01) => {
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const plan = cp.planClickMove(at.x, at.z, { x, y, z, ny: 1 }, map.geometry.obstacles, am.activeBounds(), false, { furniture: map.furniture, farFirst: false, shore: map.shore });
      if (plan.ok) cm.setClickTarget(plan.x, plan.z, plan.y, plan.via);
      return plan;
    },
  };
});

const waterfall = await p.page.evaluate(() => JSON.parse(JSON.stringify(window.__w5.W)));
const POCKET = waterfall.pocket;
const W = () => waterfall;
/** Plan and walk to (x, z); wait for the avatar to stop; returns the plan and where it stands. */
async function goTo(x, z, ms = 60000) {
  const plan = await p.page.evaluate(([x, z]) => window.__w5.walk(x, z), [x, z]);
  console.log("  goTo", x, z, plan.ok ? "ok" : plan.reason, "from", JSON.stringify(await pos(p)));
  if (!plan.ok) return { plan, at: await pos(p) };
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    await sleep(200);
    if ((await p.page.evaluate(() => window.__cvClickTarget())) === null) break;
  }
  await sleep(250);
  return { plan, at: await pos(p) };
}
/** Walk a list of waypoints (each planned from where the avatar stands). */
async function route(points) {
  for (const [x, z] of points) {
    for (let k = 0; k < 3; k++) {
      const { at } = await goTo(x, z);
      if (Math.hypot(at.x - x, at.z - z) < 1) break;
      if (k === 2) {
        // a tree or a corner the plan could not get round: step aside and try again
        for (const [dx, dz] of [[8, 8], [-8, 8], [8, -8], [-8, -8]]) {
          const here = await pos(p);
          if ((await goTo(here.x + dx, here.z + dz)).plan.ok) break;
        }
        const { at: again } = await goTo(x, z);
        if (Math.hypot(again.x - x, again.z - z) < 1) break;
      }
    }
  }
}
/** To the pocket's east end by the entry, unless already there (the way in is long: 130 m). */
async function toPocket() {
  if ((await pos(p)).x > -88) await route([[-30, -5], [-62, -22], [-84, -50], [-92, -78]]);
  await goTo(-96.5, -78);
}
/** Sample the avatar's place while `fn` runs: returns how many samples lay inside what a body cannot stand in. */
async function watchBody(fn) {
  await p.page.evaluate(() => {
    clearInterval(window.__w5watch);
    window.__w5bad = [];
    window.__w5n = 0;
    window.__w5watch = setInterval(() => {
      const a = window.__cv.getPos();
      window.__w5n++;
      // a body must be clear of every collider (a hair of slack for the slide's rounding) and on W0's walk surface
      if (a.x < -95 && (window.__w5.blocked(a.x, a.z, 0.4 - 0.02) || !window.__w5.surfaceOk(a.x, a.z))) window.__w5bad.push([a.x, a.z].map((n) => Math.round(n * 100) / 100));
    }, 50);
  });
  const out = await fn();
  const res = await p.page.evaluate(() => {
    clearInterval(window.__w5watch);
    return { n: window.__w5n, bad: window.__w5bad.slice(0, 10), badCount: window.__w5bad.length };
  });
  return { out, ...res };
}

// ───────────────────────────── the placeholders: ground, water, rocks, stones, a grey cliff ─────────────────────────────

await run.step("placeholders", async () => {
  await p.page.evaluate(async () => {
    const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
    const { scene } = window.__cvThree();
    const { W } = window.__w5;
    const g = new THREE.Group();
    g.name = "w5_placeholders";
    const mat = (c) => new THREE.MeshBasicMaterial({ color: c });
    const add = (geo, color, x, y, z, name, rotY = 0) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set(x, y, z);
      m.rotation.y = rotY;
      m.name = name;
      g.add(m);
      return m;
    };
    // the pocket's ground: sand at y 0 (the village's ground ends at x -95)
    const P = W.pocket;
    const ground = add(new THREE.PlaneGeometry(P.maxX - P.minX + 14, P.maxZ - P.minZ + 12), 0xb8a77c, (P.minX + P.maxX) / 2 - 7, 0.05, (P.minZ + P.maxZ) / 2, "w5_ground");
    ground.rotation.x = -Math.PI / 2;
    // the pool: an ellipse at the water line (y -0.25), turquoise
    const pool = add(new THREE.CircleGeometry(1, 96), 0x1aa6a0, W.pool.centre.x, 0.1, W.pool.centre.z, "w5_pool");
    pool.rotation.x = -Math.PI / 2;
    pool.scale.set(W.pool.radiusX, W.pool.radiusZ, 1);
    // the flat rocks: grey ellipses a hair over the ground, turned by their yaw (game yaw: x' = x cos - z sin ...)
    for (const s of W.slabs) {
      const m = add(new THREE.CircleGeometry(1, 48), 0x8c8c8c, s.centre.x, s.top, s.centre.z, `w5_${s.id}`);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = s.yaw;
      m.scale.set(s.radiusX, s.radiusZ, 1);
    }
    // the stones: boxes seatTop high
    for (const s of W.seats) add(new THREE.BoxGeometry(s.size.x, s.seatTop, s.size.z), 0x6f6a62, s.centre.x, s.seatTop / 2, s.centre.z, `w5_${s.id}`);
    // the rock: the camera wall's extrusion (a grey wall 36 m up); only to see where the camera may not go
    const shape = new THREE.Shape();
    const w = W.cameraWall;
    shape.moveTo(W.site.minX, -W.site.minZ);
    // shape coordinates (x, -z) so that extruding along +y and rotating gives game z
    shape.moveTo(w[0].x, -w[0].z);
    for (const q of w) shape.lineTo(q.x, -q.z);
    shape.lineTo(W.site.minX, -w[w.length - 1].z);
    shape.lineTo(W.site.minX, -w[0].z);
    const cliff = add(new THREE.ExtrudeGeometry(shape, { depth: 36, bevelEnabled: false }), 0x7d7f86, 0, 0, 0, "w5_cliff");
    cliff.rotation.x = -Math.PI / 2;
    cliff.material.side = THREE.DoubleSide;
    // the OLD backdrop (the pre-W6 cliff card and pond in village.glb) stands where the new falls will: hide it so the placeholders are what is seen and clicked
    const S = W.site;
    const hidden = [];
    scene.traverse((o) => {
      if (!o.isMesh || !/backdrop|village_lm/i.test(o.name)) return;
      const b = new THREE.Box3().setFromObject(o);
      if (b.max.x > S.minX && b.min.x < S.maxX && b.max.z > S.minZ && b.min.z < S.maxZ) {
        o.visible = false;
        hidden.push(o.name);
      }
    });
    console.log("hidden old village meshes in the site box:", hidden.join(","));
    scene.add(g);
  });
  await sleep(500);
});

// ───────────────────────────────────────────── 1. the way in and out ─────────────────────────────────────────────

if (only.includes("walk"))
  await run.step("walk: plaza -> the entry -> the rest area -> the front rock -> out and back to the plaza", async () => {
    await shot("00-plaza");
    const to = await watchBody(() => route([[-30, -5], [-62, -22], [-84, -50], [-92, -78]]));
    run.check("reached the village's west edge by the entry", Math.hypot((await pos(p)).x + 92, (await pos(p)).z + 78) < 1.2, await pos(p));
    await shot("01-entry-outside");
    const inn = await watchBody(() => route([[-96, -78], [-100, -79], [-102.5, -77.4]]));
    const at = await pos(p);
    run.check("walked in through the entry onto the front rock (S6 -> S7 -> S8)", Math.hypot(at.x + 102.5, at.z + 77.4) < 1.2, at);
    run.check("every sample of the walk in stood on W0's walk surface, clear of the pool and the stones", to.badCount === 0 && inn.badCount === 0, { samples: to.n + inn.n, bad: [...to.bad, ...inn.bad] });
    await shot("02-front-rock");
    const out = await watchBody(() => route([[-100, -79], [-95.5, -78], [-92, -78]]));
    const back = await pos(p);
    run.check("and out again through the entry", Math.hypot(back.x + 92, back.z + 78) < 1.2, back);
    run.check("every sample of the way out stood clear too", out.badCount === 0, { samples: out.n, bad: out.bad });
  });

// ───────────────────────────────── 2. pushing against everything: it holds ─────────────────────────────────

if (only.includes("push"))
  await run.step("push: straight at the pool, the cliff, the north and south edges, the stones — the body never goes in", async () => {
    await toPocket();
    const targets = [
      ["the pool's middle", -111, -78],
      ["the impact point", W().impact.x, W().impact.z],
      ["the cliff", -125, -78],
      ["the north-west bank", -112, -94],
      ["the south-west bank", -110, -62],
      ["the north edge", -100, -97],
      ["the south edge", -100, -64],
      ["the north stone (from the east)", -99.5, -87.6],
      ["the south stone (from the west)", -103, -69.6],
    ];
    for (const [name, x, z] of targets) {
      // back to the middle of the pocket first (its east part), then a raw click target the planner never saw: the body slides and stops
      await goTo(-98, -78);
      const r = await watchBody(async () => {
        await p.page.evaluate(([x, z]) => window.__w5.cm.setClickTarget(x, z), [x, z]);
        const t0 = Date.now();
        while (Date.now() - t0 < 25000) {
          await sleep(250);
          if ((await p.page.evaluate(() => window.__cvClickTarget())) === null) break;
        }
        await sleep(300);
        return pos(p);
      });
      run.check(`pushing at ${name}: never inside, rests at ${r2(r.out.x)}, ${r2(r.out.z)}`, r.badCount === 0, { samples: r.n, bad: r.bad });
    }
    await shot("03-pushed");
  });


// ───────────────────────────────── 3. all the way round the edge: no snag, no way out ─────────────────────────────────

if (only.includes("perimeter"))
  await run.step("perimeter: the pocket's whole edge and the shore, 1.5 m legs — every leg arrives, nothing snags", async () => {
    const legs = await p.page.evaluate(() => {
      const { W, blocked, surfaceOk } = window.__w5;
      const P = W.pocket;
      const free = (x, z) => x >= P.minX + 0.45 && x <= P.maxX - 0.45 && z >= P.minZ + 0.45 && z <= P.maxZ - 0.45 && !blocked(x, z, 0.46);
      // a walk along the free region's rim: from the east end go along the north edge west, down the west edge / the shore, back along the south edge
      const pts = [];
      for (let x = P.maxX - 1; x >= P.minX + 0.5; x -= 1.5) pts.push([x, P.minZ + 0.55]);
      // the shore: sweep angles of the pool's grown ellipse from north to south through the east tip
      const { pool } = W;
      for (let a = -Math.PI / 2 - 0.5; a <= Math.PI / 2 + 0.5; a += 0.12) {
        const rx = pool.radiusX + pool.keepOut - 0.1 + 0.45 + 0.25;
        const rz = pool.radiusZ + pool.keepOut - 0.1 + 0.45 + 0.25;
        const x = pool.centre.x + rx * Math.cos(a);
        const z = pool.centre.z + rz * Math.sin(a);
        pts.push([x, z]);
      }
      for (let x = P.minX + 0.5; x <= P.maxX - 1; x += 1.5) pts.push([x, P.maxZ - 0.55]);
      return pts.filter(([x, z]) => free(x, z) && surfaceOk(x, z));
    });
    run.check("a ring of legs round the pocket was found", legs.length > 20, legs.length);
    await toPocket();
    let failed = 0;
    const log = [];
    const r = await watchBody(async () => {
      for (const [x, z] of legs) {
        // a direct leg (the way the stick or keys would go): the raw target, the body's own slide
        await p.page.evaluate(([x, z]) => window.__w5.cm.setClickTarget(x, z), [x, z]);
        const t0 = Date.now();
        while (Date.now() - t0 < 9000) {
          await sleep(120);
          if ((await p.page.evaluate(() => window.__cvClickTarget())) === null) break;
        }
        const at = await pos(p);
        if (Math.hypot(at.x - x, at.z - z) > 0.6) {
          failed++;
          log.push([r2(x), r2(z), r2(at.x), r2(at.z)]);
        }
      }
    });
    run.check(`every one of ${legs.length} legs round the pocket's rim arrived (a leg that does not is a snag)`, failed === 0, log.slice(0, 8));
    run.check("and not a sample of the whole round stood inside the pool, a stone or past the pocket", r.badCount === 0, { samples: r.n, bad: r.bad });
    await shot("04-perimeter-end");
  });

// ───────────────────────────────── 4. a click on the pool: to the nearest shore ─────────────────────────────────

if (only.includes("pool"))
  await run.step("pool: real clicks (mouse / finger) on the water from several camera yaws walk to the nearest shore, the ring on the shore", async () => {
    await toPocket();
    const sam = [
      ["near the front rock", -108, -80],
      ["the middle", -112, -78],
      ["under the plunge", W().impact.x, W().impact.z],
      ["the north part", -110, -86],
      ["the south part", -110, -70],
      ["the far side", -117, -78],
    ];
    const yaws = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
    let n = 0;
    for (const yaw of yaws) {
      for (const [name, wx, wz] of sam) {
        await p.page.evaluate(([yaw]) => {
          window.__w5.vs.viewState.orbitGoal = { yaw, pitch: 0.7, distance: 9 };
        }, [yaw]);
        await sleep(1300);
        // back on the east side of the pocket, so every click has somewhere to walk from
        await goTo(-98, -78);
        await sleep(300);
        const scr = await p.page.evaluate(
          async ([wx, wz, y]) => {
            const THREE = await window.__imp("/node_modules/.vite/deps/three.js");
            const { camera, gl } = window.__cvThree();
            camera.updateMatrixWorld();
            const v = new THREE.Vector3(wx, y, wz).project(camera);
            const r = gl.domElement.getBoundingClientRect();
            return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, inFront: v.z < 1, onScreen: Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95 };
          },
          [wx, wz, 0.1],
        );
        if (!scr.inFront || !scr.onScreen) continue; // not in view from this yaw
        n++;
        if (p.touch) await p.page.touchscreen.tap(scr.x, scr.y);
        else await p.page.mouse.click(scr.x, scr.y);
        await sleep(700);
        const pick = await p.page.evaluate(() => {
          const c = window.__cvClickPick();
          return c && { name: c.pick?.name, x: c.pick?.x, y: c.pick?.y, z: c.pick?.z, plan: c.plan };
        });
        const target = await p.page.evaluate(() => window.__cvClickTarget());
        const okPlan = !!pick?.plan?.ok;
        const t0 = Date.now();
        while (Date.now() - t0 < 20000 && (await p.page.evaluate(() => window.__cvClickTarget())) !== null) await sleep(250);
        await sleep(300);
        const at = await pos(p);
        const rule = await p.page.evaluate(([x, z]) => ({ blocked: window.__w5.blocked(x, z, 0.4 - 0.02), ok: window.__w5.surfaceOk(x, z) }), [at.x, at.z]);
        run.check(
          `${name} @yaw ${r2(yaw)}: a click on the water (${r2(pick?.x ?? NaN)}, ${r2(pick?.z ?? NaN)} on ${pick?.name}) walks to the shore (${r2(at.x)}, ${r2(at.z)})`,
          okPlan && !rule.blocked && rule.ok && Math.hypot(at.x - (pick.plan.x ?? 1e9), at.z - (pick.plan.z ?? 1e9)) < 0.6,
          { plan: pick?.plan, target, rule },
        );
        if (n === 1 || n === 7) await shot(`05-poolclick-${n}`);
      }
    }
    run.check("the clicks were really made (at least 12 in view over the 4 yaws)", n >= 12, n);
  });

// ───────────────────────────────── 5. the stone seats: from both sides ─────────────────────────────────

if (only.includes("seats"))
  await run.step("seats: the stone seats are sat on from the west and the east, the other side is not offered", async () => {
    await toPocket();
    const all = await p.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s, i) => ({ i, ...s })).filter((s) => s.bench.startsWith("falls_seat_")));
    run.check("eight stone seats", all.length === 8, all.length);
    for (const s of all) {
      const side = s.yaw > 0 ? "east" : "west";
      await goTo(s.standX, s.standZ, 40000);
      await sleep(400);
      const offered = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
      run.check(`${s.bench} ${side} seat #${s.i}: 앉기 is offered at its get-up spot`, offered.includes("앉기"), offered);
      await act(p);
      const ok = await p.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, s.i, { timeout: 8000 }).then(() => true, () => false);
      await sleep(1500); // the avatar glides onto the seat (the sit-down clip)
      const seated = await pos(p);
      run.check(`${s.bench} ${side} seat #${s.i}: seated by the server, at the seat's point`, ok && Math.hypot(seated.x - s.x, seated.z - s.z) < 0.05, { at: [seated.x, seated.z], seat: [s.x, s.z] });
      if (ok) {
        await sleep(1600);
        if (s.i === all[0].i || s.i === all[2].i || s.i === all[7].i) await shot(`06-sit-${s.bench}-${side}`);
        await p.page.keyboard.press("KeyE"); // stand up (the same key, now offered as 일어나기)
        const stood = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 8000 }).then(() => true, () => false);
        await sleep(800);
        const at = await pos(p);
        run.check(`${s.bench} ${side} seat #${s.i}: gets up onto free ground in the rest area`, stood && !(await p.page.evaluate(([x, z]) => window.__w5.blocked(x, z, 0.4 - 0.02), [at.x, at.z])) && at.x < -95, [at.x, at.z]);
      }
    }
  });

// ───────────────────────────────── 6. the camera: 8 yaws x pitches, never in the rock ─────────────────────────────────

if (only.includes("camera")) {
  await run.step("camera: at the rest area's spots, 8 yaws x pitches x distances — recorded for the rock check", async () => {
    await toPocket();
    const SPOTS = [
      ["S6 entry", -95.5, -78],
      ["S7 middle", -100, -79],
      ["S8 front rock", -103.6, -77.6],
      ["S9 north end", -100, -88.6],
      ["S10 south end", -100, -69.4],
      ["NW corner", -105.4, -89.4],
      ["SW corner", -105.4, -68.6],
    ];
    const lite = process.argv.includes("--camera-lite");
    const pitches = process.argv.includes("--camera-full") ? [0.05, 0.2, 0.35, 0.6, 1.0] : lite ? [0.2, 1.0] : [0.2, 0.6, 1.0];
    const dists = lite ? [6, 18] : [3.2, 6, 18];
    const rec = [];
    for (const [name, x, z] of lite ? SPOTS.slice(1, 5) : SPOTS) {
      const { at } = await goTo(x, z, 40000);
      await sleep(300);
      let shots = 0;
      for (let k = 0; k < 8; k++) {
        const yaw = (k * Math.PI) / 4;
        for (const pitch of pitches) {
          for (const distance of dists) {
            await p.page.evaluate(([yaw, pitch, distance]) => {
              const o = window.__cv.getOrbit();
              window.__w5.vs.viewState.orbitGoal = { yaw, pitch, distance };
            }, [yaw, pitch, distance]);
            await sleep(lite ? 700 : distance > 10 ? 1500 : 1000);
            const c = await p.page.evaluate(() => window.__cvCamera());
            const me = await pos(p);
            rec.push({ spot: name, yaw: r2(yaw), pitch, distance, cam: [c.x, c.y, c.z].map((n) => r2(n)), player: [r2(me.x), r2(me.z)] });
            // pictures: every spot at pitch 0.2 and 1.0, the 8 yaws, distance 6 and 18 -> the sheet of the interesting ones
            if ((pitch === 0.2 && distance === 18) || (pitch === 0.2 && distance === 6 && k % 2 === 0) || (pitch === 1.0 && distance === 6 && k % 4 === 0)) {
              if (shots < 40 && (process.argv.includes("--camera-full") || ["S8 front rock", "S9 north end", "S10 south end"].includes(name))) {
                await shot(`cam-${name.split(" ")[0]}-y${k}-p${pitch}-d${distance}`);
                shots++;
              }
            }
          }
        }
      }
      console.log(name, "recorded", rec.length);
    }
    writeFileSync(join(OUT, `camera-${tag}.json`), JSON.stringify(rec));
    run.check("camera positions recorded", rec.length > 100, rec.length);
    // the walls the spring arm uses: no camera east of... every camera is either outside the wall's keep-out boxes (it never ends inside one)
    const inBox = await p.page.evaluate((rec) => {
      const boxes = window.__w5.am.getActiveMap().geometry.cameraBoxes.filter((b) => b.maxX < -100 && b.minX < -130);
      return rec.filter((r) => boxes.some((b) => r.cam[0] > b.minX && r.cam[0] < b.maxX && r.cam[2] > b.minZ && r.cam[2] < b.maxZ && r.cam[1] < (b.height ?? 2.6))).length;
    }, rec);
    run.check("not one camera position inside a camera-wall box", inBox === 0, inBox);
  });
}

if (only.includes("home") || only.length > 1)
  await run.step("home: from the rest area all the way back to the plaza", async () => {
    const out = await watchBody(() => route([[-96, -78], [-92, -78], [-84, -50], [-62, -22], [-30, -5], [0, 8]]));
    const back = await pos(p);
    run.check("back at the plaza", Math.hypot(back.x, back.z - 8) < 2, back);
    run.check("every sample of the way back stood clear", out.badCount === 0, { samples: out.n, bad: out.bad });
  });

const code = run.finish();
await browser.close();
process.exit(code);
