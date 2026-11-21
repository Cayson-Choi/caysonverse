/**
 * e2e/cafe-enter.mjs — 케이슨 카페에 들어가기 (owner 2026-11-20: "케이슨카페에는 못 들어가?" → "들어갈 수 있게 해").
 *
 *   server:  PORT=2941 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:2941 npx vite --port 5541 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5541 CV_E2E_SLOW=6 node e2e/cafe-enter.mjs [--out=<folder>] [--only=door,walk,seats,camera,fp,leave,times,phone]
 *
 * Two players, A on a PC (mouse + keyboard) and B on a phone (375x812, touch), in the same village:
 *   door    outside: the facade (shots), the door's button ("카페 들어가기"), A taps the DOOR itself and walks in, B uses the button;
 *           inside: the entry cover lifts, the room is drawn (draws / triangles), both are in the room and see each other;
 *   walk    click-to-move to every area of the room and the far corner, never through a counter, table or wall;
 *   seats   every seat of the room (chairs, stools, the banquette's places): walk to its stand spot, the 앉기 button sits, the other player
 *           sees it, standing up lands in front (beside for a chair at its table; never behind a backrest);
 *   camera  the follow camera at every yaw / pitch / zoom stays inside the walls and under the ceiling; first person looks round;
 *   leave   a tap on the inner door walks to the exit pad and goes out; in again; out by the button; an emoji inside reaches the other;
 *   times   the room at dusk and at night (shots), the glass shows the village;
 *   phone   B's own pass at the same: door tap, walk, sit, camera, out.
 * Shots go to --out (default D:/ClaudeCode/tmpshots/cafe-enter).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle } from "./lib/common.mjs";
import { act, areaOf, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = arg("out", "D:/ClaudeCode/tmpshots/cafe-enter");
const ONLY = arg("only", "door,walk,seats,camera,fp,leave,times,phone").split(",");
mkdirSync(OUT, { recursive: true });
const run = createRun("cafe-enter");
const numbers = {};
const NOON = "2026-11-20T12:30";
const NIGHT = "2026-11-20T22:30";
const DUSK = "2026-11-20T17:00";

const browser = await launchBrowser();
// (each player in a browser of its own: two tabs of one browser throttle the hidden one, and its avatar would not walk)
const browserB = await launchBrowser();
const A = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
const B = await openPlayer(browserB, run, { tag: "phone", device: PHONE, settings: { graphics: "low" } });

/** Click-move to (x, z) the way the game does: round furniture by the tap planner's detour (a straight line catches a table), retried. */
async function walkAndWait(p, x, z, ms = 30000, tol = 0.8) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const at = window.__cv.getPos();
      const via = plan.findDetour(at.x, at.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(400);
    await waitIdle(p, ms);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
    await sleep(600);
  }
  return pos(p);
}

const shared = (p, code, a) =>
  p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); const C = await window.__imp("/shared/src/village/cafeRoom.ts"); const B = await window.__imp("/shared/src/village/benchSeats.ts"); const G = await window.__imp("/shared/src/village/villageLayout.ts"); const S = await window.__imp("/shared/src/village/standSpot.ts"); ${code} })()`), a);
const shot = (p, name) => p.page.screenshot({ path: join(OUT, `${p.tag}-${name}.png`) });
const camera = (p) => p.page.evaluate(() => window.__cvCamera());
const photo = async (p, a, b, name, fov = 70) => {
  // a fixed photo camera in the ROOM's frame (metres from its corner), looking at b
  await p.page.evaluate(([a, b, fov]) => {
    const o = window.__cvLotRoom().origin;
    window.__cvShot = { x: o.x + a[0], y: a[1], z: o.z + a[2], tx: o.x + b[0], ty: b[1], tz: o.z + b[2], fov };
  }, [a, b, fov]);
  await sleep(2200);
  await shot(p, name);
  await p.page.evaluate(() => (window.__cvShot = null));
};
const inArea = (p) => p.page.evaluate(() => window.__cafeArea?.());
const ROOM_AREA = "lot:lot_cafe_room";

/** The route from the plaza to the café's door (the road east, then the lane to the door's pad). */
async function toDoor(p, last = 1.4) {
  const d = await shared(p, `const r = L.lotRoomOf("lot:lot_cafe_room"); const d = L.lotDoorPoint(r.lot, r.door); return d;`);
  for (const [x, z] of [[20, -8], [36, -12], [42, -15.1]]) await walkAndWait(p, x, z, 80000, 1.3);
  const at = await walkAndWait(p, d.pad.x - last, d.pad.z, 60000, 0.9);
  // (the room starts to build when the avatar comes near; a slow machine needs a while: the entry cover gives up after 20 s)
  await p.page.waitForFunction(() => window.__cvCafeReady?.(), null, { timeout: 300000 }).catch(() => {});
  return { d, at };
}

/** A real tap / click on the screen where the world point (x, y, z) shows. */
async function tapWorld(p, x, y, z) {
  const s = await p.page.evaluate(async ([x, y, z]) => {
    const THREE = await window.__imp("/deps/three.js");
    const { camera, gl } = window.__cvThree();
    camera.updateMatrixWorld();
    const v = new THREE.Vector3(x, y, z).project(camera);
    const r = gl.domElement.getBoundingClientRect();
    return { px: r.left + ((v.x + 1) / 2) * r.width, py: r.top + ((1 - v.y) / 2) * r.height, z: v.z, w: window.innerWidth, h: window.innerHeight };
  }, [x, y, z]);
  if (s.z > 1 || s.px < 0 || s.px > s.w || s.py < 0 || s.py > s.h) return { ok: false, s };
  if (p.touch) await p.page.touchscreen.tap(s.px, s.py);
  else await p.page.mouse.click(s.px, s.py);
  return { ok: true, s };
}

// (the area getter is cached in the page: a waitForFunction whose predicate is async resolves at once, whatever it finds)
const hookArea = (p) => p.page.evaluate(async () => (window.__cafeArea = (await window.__imp("/src/village/villageArea.ts")).localArea));
const waitArea = (p, area, ms = 90000) => p.page.waitForFunction((a) => window.__cafeArea?.() === a, area, { timeout: ms }).then(() => true, () => false);
const waitRoom = (p, ms = 240000) => p.page.waitForFunction(() => !!window.__cvLotRoom?.(), null, { timeout: ms }).then(() => true, () => false);
const seatIndexNow = async (p) => (await pos(p)).seatIndex;

try {
  await joinVillage(A, "kafeA", NOON);
  await joinVillage(B, "kafeB", NOON);
  await hookArea(A);
  await hookArea(B);
  numbers.start = { a: await pos(A), b: await pos(B) };

  // ───────────────────────────────── door ─────────────────────────────────
  if (ONLY.includes("door")) {
    await run.step("1. outside: the facade, the door's button, a tap on the door goes in", async () => {
      const { d, at } = await toDoor(A);
      await sleep(800);
      await A.page.evaluate((d) => (window.__cvShot = { x: d.arrival.x - 5.5, y: 2.2, z: d.arrival.z + 2.4, tx: d.centre.x, ty: 1.6, tz: d.centre.z, fov: 62 }), d);
      await sleep(2500);
      await shot(A, "outside-facade");
      await A.page.evaluate(() => (window.__cvShot = null));
      const t = await targets(A);
      run.check("A at the café's door is offered '카페 들어가기'", t.some((x) => x.id === "lotenter:lot_cafe_main" && /카페/.test(x.label)), { t, at: [r2(at.x), r2(at.z)] });
      // A walks a few metres back; then a real click on the door itself (the camera behind the avatar)
      const back = await walkAndWait(A, d.pad.x - 4.5, d.pad.z, 40000, 0.9);
      numbers.backAt = back;
      await sleep(600);
      // the camera looks from behind A toward the door (east)
      await A.page.evaluate(async (d) => {
        const vs = await window.__imp("/src/game/viewState.ts");
        vs.viewState.orbitGoal = { yaw: -Math.PI / 2, pitch: 0.35 };
      }, d);
      await sleep(2500);
      const o = await A.page.evaluate(() => window.__cv.getOrbit());
      const tap = await tapWorld(A, d.centre.x - 0.05, 1.3, d.centre.z);
      numbers.doorTap = tap;
      run.check("the door is on A's screen (a real click on it)", tap.ok, tap.s);
      const went = await waitArea(A, ROOM_AREA, 120000);
      run.check("a click on the door: A walks up and goes in (the café's room)", went, { area: await inArea(A), orbit: o });
      if (!went) {
        // fall back to the button so the rest of the run can go on
        await walkAndWait(A, d.pad.x, d.pad.z, 30000, 0.9);
        await act(A);
        await waitArea(A, ROOM_AREA, 120000);
      }
      await waitRoom(A);
      await sleep(3000);
      const info = await A.page.evaluate(() => window.__cvLotRoom());
      numbers.roomPc = info;
      run.check("the room is drawn: at most 45 draws, under 160k triangles (PC: the baked GLB room, 2026-11-21)", info && info.visible.draws <= 45 && info.visible.triangles < 160000, info?.visible);
      await shot(A, "enter-arrival");
    });

    await run.step("2. B (phone) walks up, the button goes in, both see each other", async () => {
      const { d } = await toDoor(B, 0.6);
      await sleep(600);
      const t = await targets(B);
      run.check("B at the door is offered the button", t.some((x) => x.id === "lotenter:lot_cafe_main"), t);
      await shot(B, "outside-door");
      await act(B);
      const went = await waitArea(B, ROOM_AREA, 120000);
      run.check("B (phone) goes in with the button", went, await inArea(B));
      await waitRoom(B);
      await sleep(4000);
      numbers.roomPhone = await B.page.evaluate(() => window.__cvLotRoom());
      await shot(B, "enter-arrival");
      const sees = await B.page.evaluate(() => Object.keys(window.__cv.getRemoteDrawn()).length);
      const seenBy = await A.page.evaluate(() => Object.keys(window.__cv.getRemoteDrawn()).length);
      run.check("both are in the room and see each other", sees >= 1 && seenBy >= 1, { sees, seenBy });
    });
  }

  // ───────────────────────────────── walk ─────────────────────────────────
  const info = await shared(A, `const r = L.lotRoomOf("lot:lot_cafe_room"); const seats = B.VILLAGE_SEATS.map((s, i) => ({ ...s, index: i })).filter((s) => s.area === r.area); const sol = L.lotRoomSolids(r); return { origin: r.origin, bounds: r.bounds, ceiling: r.ceiling, seats, solids: sol, exit: L.lotRoomDoor(r).exitPad, door: r.spec.doorX };`);
  const O = info.origin;
  const at = (x, z) => [O.x + x, O.z + z];
  // B steps away from the door (an avatar in front of the door takes the click: it is a body, not a door)
  if ((await inArea(B)) === ROOM_AREA) await walkAndWait(B, ...at(5.0, 5.8), 60000, 0.8);
  if (ONLY.includes("walk")) {
    await run.step("3. walk round every area, click-to-move to the far corner, nothing walked through", async () => {
      const spots = {
        "by the door": [6.8, 1.6],
        "the window table": [11.6, 1.2],
        "the banquette front": [12.6, 2.6],
        "the counter (customer side)": [9.2, 4.4],
        "the stools": [8.6, 3.8],
        "the kitchen door": [5.4, 7.2],
        "the stair's foot": [0.6, 2.9],
        "the aisle by the stair": [3.0, 5.0],
        "the table row by the stair": [3.0, 2.4],
        "the far corner": [0.8, 0.9],
      };
      for (const [name, [x, z]] of Object.entries(spots)) {
        const [wx, wz] = at(x, z);
        const got = await walkAndWait(A, wx, wz, 60000, 0.7);
        run.check(`A walks to ${name}`, Math.hypot(got.x - wx, got.z - wz) < 0.9, { want: [r2(wx), r2(wz)], got: [r2(got.x), r2(got.z)] });
      }
      // into the counter: the avatar stops in front of it (never inside its box)
      const c = info.solids.find((s) => s.name === "counter");
      await A.page.evaluate(async ([cx, cz]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(cx, cz), [(c.minX + c.maxX) / 2, (c.minZ + c.maxZ) / 2]);
      await sleep(6000);
      const p = await pos(A);
      const inside = p.x > c.minX && p.x < c.maxX && p.z > c.minZ && p.z < c.maxZ;
      run.check("a click on the counter: A stops at its edge, not inside", !inside, { p: [r2(p.x), r2(p.z)], counter: c });
      // every solid: nothing walks inside a solid's box
      let bad = 0;
      for (const s of info.solids) {
        for (const [px, pz] of [[(s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2]]) {
          await A.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [px, pz]);
          await sleep(3500);
          const q = await pos(A);
          if (q.x > s.minX && q.x < s.maxX && q.z > s.minZ && q.z < s.maxZ) bad++;
        }
      }
      run.check("a click on the middle of every table, plant and the bar: A is never inside one", bad === 0, { bad });
      await shot(A, "walk-done");
    });
  }

  // ───────────────────────────────── seats ─────────────────────────────────
  if (ONLY.includes("seats")) {
    await run.step("4. every seat: walk up, 앉기, the other sees it, stand up in front", async () => {
      const results = [];
      // B watches A: A's drawn pose in B's scene
      for (const s of info.seats) {
        await walkAndWait(A, s.standX, s.standZ, 60000, 0.45);
        await walkAndWait(A, s.standX, s.standZ, 20000, 0.3);
        const before = await pos(A);
        // (a tap on a seat prefers it; walking up to its stand spot with the keys does the same through the nearest seat)
        await A.page.evaluate(async (i) => (await window.__imp("/src/game/seatPreference.ts")).setPreferredSeat(i), s.index);
        await act(A);
        const sat = await A.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, s.index, { timeout: 12000 }).then(() => true, () => false);
        await sleep(1800);
        const drawn = await B.page.evaluate(() => Object.values(window.__cv.getRemoteDrawn()).map((d) => ({ x: d.x, z: d.z, y: d.y ?? null })));
        const seenSat = drawn.some((d) => Math.hypot(d.x - s.x, d.z - s.z) < 0.9);
        if (sat && (/chair_1:1$|chair_6:1$|stool_2:1:back$|banquette:2$/.test(s.id))) await shot(A, `sit-${s.id.replace(/[:\/]/g, "_")}`);
        // 1st person on this seat: the view from the chair is inside the room
        await act(A);
        const stood = await A.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 12000 }).then(() => true, () => false);
        await sleep(1200);
        const up = await pos(A);
        const side = await shared(A, `return S.standSide(a.seat, a.x, a.z);`, { seat: s, x: up.x, z: up.z });
        const backed = s.kind === "backed";
        results.push({ id: s.id, kind: s.kind, sat, seenSat, stood, side, stand: [r2(s.standX), r2(s.standZ)], up: [r2(up.x), r2(up.z)] });
        run.check(`seat ${s.id}: sits, B sees it, stands up (${side}${backed ? "" : ""})`, sat && stood && seenSat && (!backed || side !== "behind"), results[results.length - 1]);
      }
      numbers.seats = results;
      writeFileSync(join(OUT, "seats.json"), JSON.stringify(results, null, 1));
    });
  }

  // ───────────────────────────────── camera ─────────────────────────────────
  if (ONLY.includes("camera")) {
    await run.step("5. the follow camera never leaves the walls or the ceiling", async () => {
      const b = info.bounds;
      const spots = [[6.8, 1.6], [12.6, 0.8], [0.8, 0.8], [12.8, 7.0], [3.0, 6.8], [6.8, 4.2], [9.4, 6.5], [3.2, 5.4]];
      let worst = { out: 0, up: 0 };
      let samples = 0;
      for (const [x, z] of spots) {
        const [wx, wz] = at(x, z);
        await walkAndWait(A, wx, wz, 60000, 0.8);
        for (const pitch of [0.05, 0.5, 1.2]) {
          for (let k = 0; k < 8; k++) {
            await A.page.evaluate(async ([k, pitch]) => {
              const vs = await window.__imp("/src/game/viewState.ts");
              vs.viewState.orbitGoal = { yaw: (k * Math.PI) / 4, pitch };
            }, [k, pitch]);
            await sleep(1100);
            const c = await camera(A);
            const outX = Math.max(b.minX - c.x, c.x - b.maxX, 0);
            const outZ = Math.max(b.minZ - c.z, c.z - b.maxZ, 0);
            const out = Math.max(outX, outZ);
            const up = Math.max(c.y - info.ceiling, 0);
            worst = { out: Math.max(worst.out, out), up: Math.max(worst.up, up) };
            samples++;
            if (out > 0.02 || up > 0.02) run.check(`camera outside at (${r2(x)}, ${r2(z)}) yaw ${k} pitch ${pitch}`, false, { c: [r2(c.x), r2(c.y), r2(c.z)], b, ceiling: info.ceiling });
          }
        }
        if (x === 6.8 && z === 1.6) await shot(A, "camera-door");
        if (x === 12.8) await shot(A, "camera-corner");
      }
      run.check(`${samples} camera spots (8 yaws x 3 pitches x ${spots.length} places): none outside the walls, none above the ceiling`, worst.out <= 0.02 && worst.up <= 0.02, worst);
      numbers.cameraWorst = worst;
    });
  }

  if (ONLY.includes("fp")) {
    await run.step("6. first person: looking round inside, no wall or beam in the lens", async () => {
      const b = info.bounds;
      await walkAndWait(A, ...at(6.8, 3.4), 30000, 0.8);
      await A.page.evaluate(async () => {
        const vs = await window.__imp("/src/game/viewState.ts");
        if (vs.viewState.mode !== "fp") vs.enterFp(0);
      });
      await sleep(1500);
      let worst = 0;
      for (let k = 0; k < 8; k++) {
        await A.page.evaluate(async (k) => {
          const vs = await window.__imp("/src/game/viewState.ts");
          vs.viewState.fpYawGoal?.call?.(vs, (k * Math.PI) / 4);
          window.__cvFpYaw = (k * Math.PI) / 4;
        }, k);
        await A.page.keyboard.down(k % 2 ? "KeyZ" : "KeyC");
        await sleep(700);
        await A.page.keyboard.up(k % 2 ? "KeyZ" : "KeyC");
        const c = await camera(A);
        worst = Math.max(worst, Math.max(b.minX - c.x, c.x - b.maxX, b.minZ - c.z, c.z - b.maxZ, c.y - info.ceiling, 0));
        if (k % 2 === 0) await shot(A, `fp-${k}`);
      }
      run.check("first person: the lens stays inside the room", worst <= 0.02, { worst });
      await A.page.evaluate(async () => {
        const vs = await window.__imp("/src/game/viewState.ts");
        if (vs.viewState.mode === "fp") vs.exitFp(window.__cvOrbitLive?.());
      });
      await sleep(1200);
    });
  }

  // ───────────────────────────────── leave ─────────────────────────────────
  if (ONLY.includes("leave")) {
    await run.step("7. an emoji inside; a tap on the inner door goes out; in again; out by the button", async () => {
      await A.page.evaluate(async () => (await window.__imp("/src/net/connection.ts")).sendEmoji(2));
      const seenB = await B.page.waitForFunction(() => window.__cv.getEmojis().length > 0, null, { timeout: 8000 }).then(() => true, () => false);
      run.check("an emoji inside the café reaches the other player", seenB);
      await sleep(2500);
      // a tap on the door from inside
      await walkAndWait(A, ...at(info.door, 3.6), 40000, 0.8);
      await A.page.evaluate(async () => {
        const vs = await window.__imp("/src/game/viewState.ts");
        vs.viewState.orbitGoal = { yaw: 0, pitch: 0.35 };
      });
      await sleep(1500);
      const tap = await tapWorld(A, O.x + info.door, 1.3, O.z - 0.12);
      run.check("the inner door is on A's screen", tap.ok, tap.s);
      const out = await waitArea(A, "village", 90000);
      run.check("a click on the inner door: A walks to it and goes out", out, await inArea(A));
      await sleep(1500);
      const p1 = await pos(A);
      const d = await shared(A, `const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotDoorPoint(r.lot, r.door);`);
      run.check("A is outside on the terrace in front of the door", Math.hypot(p1.x - d.arrival.x, p1.z - d.arrival.z) < 2.5, { p1: [r2(p1.x), r2(p1.z)], arrival: d.arrival });
      await shot(A, "left-door");
      // in again with the button, out again with the button
      await walkAndWait(A, d.pad.x, d.pad.z, 30000, 0.9);
      await act(A);
      run.check("in again (the same door, the same button)", await waitArea(A, ROOM_AREA, 90000));
      await waitRoom(A);
      await sleep(2500);
      await walkAndWait(A, ...at(info.door, 1.6), 30000, 0.6);
      await sleep(500);
      const t2 = await targets(A);
      run.check("inside at the door the button says '밖으로 나가기'", t2.some((x) => /밖으로/.test(x.label)), t2);
      await act(A);
      run.check("out by the button", await waitArea(A, "village", 90000));
      await sleep(800);
      // walking into the door itself does NOT go in (owner 2026-11-21: "버튼 누르지도 않았는데 … 들어가버리잖아": the button, E or a tap on the door only)
      await walkAndWait(A, d.pad.x - 3.5, d.pad.z, 40000, 0.9);
      await A.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [d.centre.x + 1.2, d.centre.z]);
      const walkedIn = await waitArea(A, ROOM_AREA, 12000);
      run.check("walking into the door does not go in (button / E / door tap only)", !walkedIn, await inArea(A));
      if (walkedIn) {
        await waitRoom(A);
        await walkAndWait(A, ...at(info.door, 1.6), 30000, 0.6);
        await act(A);
        await waitArea(A, "village", 90000);
      }
    });
  }

  // ───────────────────────────────── times ─────────────────────────────────
  if (ONLY.includes("times")) {
    await run.step("8. dusk and night inside, the glass shows the village", async () => {
      const d = await shared(A, `const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotDoorPoint(r.lot, r.door);`);
      await walkAndWait(A, d.pad.x, d.pad.z, 40000, 0.9);
      await act(A);
      await waitArea(A, ROOM_AREA, 90000);
      await waitRoom(A);
      await sleep(2500);
      const views = [
        ["door-in", [6.8, 1.65, 0.5], [6.8, 1.5, 7]],
        ["counter", [4, 1.7, 2.4], [9.5, 1.0, 6]],
        ["windows", [6.8, 1.6, 5.5], [6.8, 1.9, 0]],
        ["banquette", [8.5, 1.6, 3], [13.5, 0.8, 2.3]],
        ["tables", [12.5, 2.3, 5.4], [3.5, 0.8, 2.6]],
      ];
      const setTime = (t) =>
        A.page.evaluate(async (t) => {
          const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
          villageClock.pin(pinFromSearch("?time=" + t));
          (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
        }, t);
      for (const [label, t] of [["day", NOON], ["dusk", DUSK], ["night", NIGHT]]) {
        await setTime(t);
        await sleep(3500);
        for (const [n, a, b] of views) await photo(A, a, b, `${label}-${n}`);
        const w = await A.page.evaluate(() => window.__cvLotRoom());
        run.check(`${label}: the windows show the village (the baked view is on the glass)`, !!w?.glass, w?.glass);
      }
      await setTime(NOON);
      await sleep(1500);
    });
  }

  // ───────────────────────────────── phone ─────────────────────────────────
  if (ONLY.includes("phone")) {
    await run.step("9. B (phone): walk, sit, camera, tap the inner door", async () => {
      if ((await inArea(B)) !== ROOM_AREA) {
        const { d } = await toDoor(B, 0.6);
        await act(B);
        await waitArea(B, ROOM_AREA, 120000);
        await waitRoom(B);
        await sleep(3000);
      }
      const phoneInfo = await B.page.evaluate(() => window.__cvLotRoom());
      run.check("the phone's room: under 70k triangles, at most 36 draws (its _phone GLB)", phoneInfo && phoneInfo.visible.triangles < 70000 && phoneInfo.visible.draws <= 36, phoneInfo?.visible);
      const seat = info.seats.find((s) => /chair_5:1$/.test(s.id)) ?? info.seats[0];
      await walkAndWait(B, seat.standX, seat.standZ, 60000, 0.45);
      await B.page.evaluate(async (i) => (await window.__imp("/src/game/seatPreference.ts")).setPreferredSeat(i), seat.index);
      await act(B);
      const sat = await B.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, seat.index, { timeout: 15000 }).then(() => true, () => false);
      run.check(`B sits on ${seat.id} with the touch button`, sat);
      await sleep(1500);
      await shot(B, "sit");
      await act(B);
      await B.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 15000 }).catch(() => {});
      const b = info.bounds;
      let worst = 0;
      for (const [x, z] of [[6.8, 1.6], [12.6, 0.8], [3.0, 6.8]]) {
        await walkAndWait(B, ...at(x, z), 60000, 0.8);
        for (const pitch of [0.1, 1.0]) {
          for (let k = 0; k < 8; k++) {
            await B.page.evaluate(async ([k, pitch]) => {
              const vs = await window.__imp("/src/game/viewState.ts");
              vs.viewState.orbitGoal = { yaw: (k * Math.PI) / 4, pitch };
            }, [k, pitch]);
            await sleep(900);
            const c = await camera(B);
            worst = Math.max(worst, b.minX - c.x, c.x - b.maxX, b.minZ - c.z, c.z - b.maxZ, c.y - info.ceiling);
          }
        }
      }
      run.check("the phone's camera never leaves the walls or the ceiling", worst <= 0.02, { worst });
      await shot(B, "camera");
      // out by tapping the inner door (A out of the way: an avatar in front of the door takes the click)
      if ((await inArea(A)) === ROOM_AREA) await walkAndWait(A, ...at(12.4, 5.2), 60000, 0.8);
      await walkAndWait(B, ...at(info.door, 3.6), 40000, 0.8);
      await B.page.evaluate(async () => {
        const vs = await window.__imp("/src/game/viewState.ts");
        vs.viewState.orbitGoal = { yaw: 0, pitch: 0.35 };
      });
      await sleep(1500);
      const tap = await tapWorld(B, O.x + info.door, 1.3, O.z - 0.12);
      run.check("the inner door is on B's screen (a real tap)", tap.ok, tap.s);
      run.check("a tap on the inner door: B goes out", await waitArea(B, "village", 90000), await inArea(B));
      await shot(B, "left");
    });
  }
} catch (err) {
  console.error("run error", err);
  run.check("run completed without an exception", false, String(err).slice(0, 300));
} finally {
  writeFileSync(join(OUT, "cafe-enter-numbers.json"), JSON.stringify(numbers, null, 1));
  await run.finish?.();
  await browser.close();
  await browserB.close();
  const failed = run.results.filter((r) => !r.ok);
  console.log(`\n${run.results.length - failed.length}/${run.results.length} checks passed`);
  for (const f of failed) console.log("FAIL", f.step, "-", f.name, JSON.stringify(f.detail)?.slice(0, 300));
  if (run.errors.length) console.log("page errors:", JSON.stringify(run.errors.slice(0, 6)));
  process.exitCode = failed.length ? 1 : 0;
}
