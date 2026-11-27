/**
 * e2e/cafe-upstairs.mjs — 케이슨 카페 2층과 계단 (owner 2026-11-21: "2층까지 있는데 왜 계단이 없어? 2층까지 만들어서 계단도 만들어").
 *
 *   server:  PORT=2961 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:2961 npx vite --port 5561 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5561 CV_E2E_SLOW=6 node e2e/cafe-upstairs.mjs [--out=<folder>] [--only=up,walk,seats,camera,phone,down,shots]
 *
 * Two players, A on a PC (mouse + keyboard) and B on a phone (375x812, touch):
 *   up      A in the café: the stair's pad offers "2층으로 올라가기"; a CLICK on the stair walks to its pad and does NOT climb (owner
 *           2026-11-27), its button does; standing at the pad without pressing anything never climbs; upstairs the room is drawn;
 *   walk    click-to-move round the salon (the windows, the sofa, the sideboard, the far corner), never into the stairwell or a table;
 *   seats   every upstairs seat (chairs, the sofa's places, the wing chairs): sit, B sees it, stand up in front;
 *   camera  the follow camera at every yaw / pitch stays inside the salon's walls and under its ceiling; and downstairs by the stair;
 *   phone   B goes up with the touch button, both see each other upstairs, an emoji upstairs reaches the other;
 *   down    "1층으로 내려가기" at the stairwell: A comes down at the stair's foot and stays down; B taps the balustrade (walks there, no climb), then its button;
 *   shots   the stair from the café, the stairwell, the salon at day / dusk / night (PC and phone).
 * Shots to --out (default D:/ClaudeCode/tmpshots/cafe-real/upstairs).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = arg("out", "D:/ClaudeCode/tmpshots/cafe-real/upstairs");
const ONLY = arg("only", "up,walk,seats,camera,phone,down,shots").split(",");
mkdirSync(OUT, { recursive: true });
const run = createRun("cafe-upstairs");
const numbers = {};
const NOON = "2026-11-21T12:30";
const DUSK = "2026-11-21T17:00";
const NIGHT = "2026-11-21T22:30";
const GROUND = "lot:lot_cafe_room";
const UP = "lot:lot_cafe_upstairs";

const browser = await launchBrowser();
const browserB = await launchBrowser();
const A = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
const B = await openPlayer(browserB, run, { tag: "phone", device: PHONE, settings: { graphics: "low" } });

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
  p.page.evaluate(new Function("a", `return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); const B = await window.__imp("/shared/src/village/benchSeats.ts"); const S = await window.__imp("/shared/src/village/standSpot.ts"); ${code} })()`), a);
const shot = (p, name) => p.page.screenshot({ path: join(OUT, `${p.tag}-${name}.png`) });
const camera = (p) => p.page.evaluate(() => window.__cvCamera());
const hookArea = (p) => p.page.evaluate(async () => (window.__cafeArea = (await window.__imp("/src/village/villageArea.ts")).localArea));
const inArea = (p) => p.page.evaluate(() => window.__cafeArea?.());
const waitArea = (p, area, ms = 90000) => p.page.waitForFunction((a) => window.__cafeArea?.() === a, area, { timeout: ms }).then(() => true, () => false);
const waitRoom = (p, unit, ms = 240000) => p.page.waitForFunction((u) => window.__cvLotRoom?.()?.unit === u, unit, { timeout: ms }).then(() => true, () => false);
const photo = async (p, a, b, name, fov = 70) => {
  await p.page.evaluate(([a, b, fov]) => {
    const o = window.__cvLotRoom().origin;
    window.__cvShot = { x: o.x + a[0], y: a[1], z: o.z + a[2], tx: o.x + b[0], ty: b[1], tz: o.z + b[2], fov };
  }, [a, b, fov]);
  await sleep(2400);
  await shot(p, name);
  await p.page.evaluate(() => (window.__cvShot = null));
};
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
  await sleep(300);
  // what the press landed on (the dev hook), for the record
  const pick = await p.page.evaluate(() => {
    const k = window.__cvClickPick?.()?.pick;
    return k ? { x: +k.x.toFixed(2), y: +k.y.toFixed(2), z: +k.z.toFixed(2), ny: +k.ny.toFixed(2), name: k.name } : null;
  });
  return { ok: true, s: { ...s, pick } };
}
const orbit = (p, yaw, pitch) => p.page.evaluate(async ([yaw, pitch]) => ((await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw, pitch }), [yaw, pitch]);
const setTime = (p, t) =>
  p.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, t);

async function intoCafe(p) {
  const d = await shared(p, `const r = L.lotRoomOf("${GROUND}"); return L.lotDoorPoint(r.lot, r.door);`);
  for (const [x, z] of [[20, -8], [36, -12], [42, -15.1]]) await walkAndWait(p, x, z, 80000, 1.3);
  await walkAndWait(p, d.pad.x - 0.6, d.pad.z, 60000, 0.9);
  await sleep(800);
  await act(p);
  const ok = await waitArea(p, GROUND, 120000);
  await waitRoom(p, "lot_cafe_room");
  await sleep(3000);
  return ok;
}

const roomInfo = (p, area) =>
  shared(p, `const r = L.lotRoomOf("${area}"); const st = L.lotRoomStair(r); const seats = B.VILLAGE_SEATS.map((s, i) => ({ ...s, index: i })).filter((s) => s.area === r.area); return { origin: r.origin, bounds: r.bounds, ceiling: r.ceiling, seats, solids: L.lotRoomSolids(r), stair: st && { pad: st.pad, footprint: st.footprint, dir: st.dir } };`);

try {
  await joinVillage(A, "kafeUpA", NOON);
  await joinVillage(B, "kafeUpB", NOON);
  await hookArea(A);
  await hookArea(B);
  run.check("A goes into the café with the button", await intoCafe(A));
  const G = await roomInfo(A, GROUND);
  const U = await roomInfo(A, UP);
  numbers.ground = { stair: G.stair };
  numbers.up = { stair: U.stair, seats: U.seats.length };
  const at = (R, x, z) => [R.origin.x + x, R.origin.z + z];

  // ───────────────────────────────── up ─────────────────────────────────
  if (ONLY.includes("up")) {
    await run.step("1. the stair: its pad offers 2층, standing there never climbs, a click on the stair walks there (no climb), the button goes up", async () => {
      await walkAndWait(A, G.stair.pad.x, G.stair.pad.z - 0.3, 40000, 0.5);
      await sleep(1500);
      const t = await targets(A);
      run.check("at the stair's pad A is offered '2층으로 올라가기'", t.some((x) => /2층/.test(x.label)), t);
      await sleep(4000);
      run.check("standing at the pad without pressing anything: still downstairs", (await inArea(A)) === GROUND, await inArea(A));
      await photo(A, [4.6, 1.6, 2.2], [0.9, 2.0, 6.0], "stair-from-cafe");
      await photo(A, [2.2, 1.3, 2.9], [0.6, 2.4, 6.8], "stair-foot");
      // a real click on the stair (a step of flight A) from a few metres away
      await walkAndWait(A, ...at(G, 3.6, 2.4), 30000, 0.6);
      await orbit(A, Math.PI * 0.8, 0.35);
      await sleep(2200);
      const tap = await tapWorld(A, G.origin.x + 0.6, 1.2, G.origin.z + 5.0);
      run.check("the stair is on A's screen (a real click on a step)", tap.ok, tap.s);
      // owner 2026-11-27 ("계단을 탭하면 올라가게 하지 말고 계단 버튼을 누르면 올라가도록"): the click walks to the pad and never climbs
      await A.page.waitForFunction(() => window.__cvClickTarget?.() === null, null, { timeout: 60000 }).catch(() => {});
      await sleep(4000);
      run.check("a click on the stair: A walks to its pad and does NOT go up", (await inArea(A)) === GROUND, await inArea(A));
      const ta = await targets(A);
      run.check("after the click A stands at the pad: '2층으로 올라가기' is offered", ta.some((x) => /2층/.test(x.label)), { p: await pos(A), ta });
      if (!ta.some((x) => /2층/.test(x.label))) await walkAndWait(A, G.stair.pad.x, G.stair.pad.z - 0.3, 30000, 0.5);
      await act(A);
      run.check("then the button: A goes up", await waitArea(A, UP, 60000), await inArea(A));
      run.check("upstairs the salon is drawn", await waitRoom(A, "lot_cafe_upstairs"));
      await sleep(3000);
      const info = await A.page.evaluate(() => window.__cvLotRoom());
      numbers.upPc = info;
      run.check("the salon: at most 45 draws, under 160k triangles (PC)", info && info.visible.draws <= 45 && info.visible.triangles < 160000, info?.visible);
      const p = await pos(A);
      run.check("A arrives at the top of the stair (not in the stairwell)", p.z < U.origin.z + 3.85 && Math.hypot(p.x - (U.origin.x + 1.8), p.z - (U.origin.z + 2.65)) < 1.2, { p: [r2(p.x), r2(p.z)] });
      await shot(A, "arrive-up");
    });
  }

  // ───────────────────────────────── walk ─────────────────────────────────
  if (ONLY.includes("walk")) {
    await run.step("2. walk round the salon; the stairwell and the furniture are never walked into", async () => {
      const spots = { "the front windows": [6.8, 0.9], "the sofa's front": [12.3, 3.0], "the middle": [7.6, 6.4], "the sideboard": [6.3, 11.9], "the bookcase": [0.9, 9.9], "the back corner": [1.2, 12.3], "the wing chairs": [10.8, 12.3], "the far front corner": [12.9, 1.2] };
      // Each spot the way a tap on the floor there is walked: the game's own plan (clickPlan.planClickMove — a spot touching a piece of
      // furniture is moved out of it, a way round included). Interiors round 1 (2026-11-27) put a plant under the front windows and a
      // round table in the middle: a bare setClickTarget at those exact points (inside the grown boxes) had no way round and stopped 3 m
      // short, while a real tap there walks to the floor beside them.
      for (const [name, [x, z]] of Object.entries(spots)) {
        const [wx, wz] = at(U, x, z);
        let got = null;
        let plan = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          plan = await A.page.evaluate(async ([x, z]) => {
            const cp = await window.__imp("/src/game/clickPlan.ts");
            const cm = await window.__imp("/src/game/clickMove.ts");
            const am = await window.__imp("/src/game/activeMap.ts");
            const me = window.__cv.getPos();
            const obs = am.getActiveMap().geometry.obstacles;
            const pl = cp.planClickMove(me.x, me.z, { x, y: 0, z, ny: 1 }, obs, am.activeBounds(), false, { furniture: obs });
            if (pl.ok) cm.setClickTarget(pl.x, pl.z, 0, pl.via);
            return pl.ok ? { ok: true, x: pl.x, z: pl.z, adjusted: pl.adjusted, via: (pl.via ?? []).length } : pl;
          }, [wx, wz]);
          if (!plan.ok) break;
          await sleep(400);
          await waitIdle(A, 60000);
          await sleep(300);
          got = await pos(A);
          if (Math.hypot(got.x - plan.x, got.z - plan.z) < 0.4) break;
        }
        got ??= await pos(A);
        run.check(`A walks to ${name} (a tap's walk)`, plan.ok && Math.hypot(plan.x - wx, plan.z - wz) < 1.0 && Math.hypot(got.x - plan.x, got.z - plan.z) < 0.4, { want: [r2(wx), r2(wz)], plan, got: [r2(got.x), r2(got.z)] });
      }
      let bad = 0;
      for (const s of U.solids) {
        await A.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [(s.minX + s.maxX) / 2, (s.minZ + s.maxZ) / 2]);
        await sleep(3200);
        const q = await pos(A);
        if (q.x > s.minX && q.x < s.maxX && q.z > s.minZ && q.z < s.maxZ) bad++;
      }
      run.check("a click on every table, the sofa, the sideboard and the stairwell: A is never inside one", bad === 0, { bad });
    });
  }

  // ───────────────────────────────── phone up ─────────────────────────────────
  if (ONLY.includes("phone")) {
    await run.step("3. B (phone) goes in and up with the touch button; both upstairs see each other; an emoji upstairs", async () => {
      run.check("B goes into the café", await intoCafe(B));
      await walkAndWait(B, G.stair.pad.x, G.stair.pad.z - 0.3, 40000, 0.5);
      await sleep(1200);
      const t = await targets(B);
      run.check("B at the pad is offered the 2층 button", t.some((x) => /2층/.test(x.label)), t);
      await act(B);
      run.check("B (phone) goes up with the button", await waitArea(B, UP, 90000), await inArea(B));
      await waitRoom(B, "lot_cafe_upstairs");
      await sleep(4000);
      const info = await B.page.evaluate(() => window.__cvLotRoom());
      numbers.upPhone = info;
      run.check("the phone's salon: under 70k triangles, at most 36 draws", info && info.visible.triangles < 70000 && info.visible.draws <= 36, info?.visible);
      const sees = await B.page.evaluate(() => Object.keys(window.__cv.getRemoteDrawn()).length);
      const seenBy = await A.page.evaluate(() => Object.keys(window.__cv.getRemoteDrawn()).length);
      run.check("both upstairs see each other", sees >= 1 && seenBy >= 1, { sees, seenBy });
      await A.page.evaluate(async () => (await window.__imp("/src/net/connection.ts")).sendEmoji(3));
      run.check("an emoji upstairs reaches the other", await B.page.waitForFunction(() => window.__cv.getEmojis().length > 0, null, { timeout: 8000 }).then(() => true, () => false));
      await shot(B, "up-arrive");
    });
  }

  // ───────────────────────────────── seats ─────────────────────────────────
  if (ONLY.includes("seats")) {
    await run.step("4. every upstairs seat: walk up, 앉기, the other sees it, stand up in front", async () => {
      const results = [];
      for (const s of U.seats) {
        await walkAndWait(A, s.standX, s.standZ, 60000, 0.45);
        await walkAndWait(A, s.standX, s.standZ, 20000, 0.3);
        await A.page.evaluate(async (i) => (await window.__imp("/src/game/seatPreference.ts")).setPreferredSeat(i), s.index);
        await act(A);
        const sat = await A.page.waitForFunction((i) => window.__cv.getPos().seatIndex === i, s.index, { timeout: 12000 }).then(() => true, () => false);
        await sleep(1800);
        const drawn = (await inArea(B)) === UP ? await B.page.evaluate(() => Object.values(window.__cv.getRemoteDrawn()).map((d) => ({ x: d.x, z: d.z }))) : null;
        const seenSat = drawn === null || drawn.some((d) => Math.hypot(d.x - s.x, d.z - s.z) < 0.9);
        if (sat && /up_sofa:2$|up_armchair_1|up_chair_1:1$|up_chair_11:1$/.test(s.id)) await shot(A, `sit-${s.id.replace(/[:\/]/g, "_")}`);
        await act(A);
        const stood = await A.page.waitForFunction(() => window.__cv.getPos().seatIndex === -1, null, { timeout: 12000 }).then(() => true, () => false);
        await sleep(1200);
        const upP = await pos(A);
        const side = await shared(A, `return S.standSide(a.seat, a.x, a.z);`, { seat: s, x: upP.x, z: upP.z });
        results.push({ id: s.id, kind: s.kind, sat, seenSat, stood, side });
        run.check(`seat ${s.id}: sits, B sees it, stands up (${side})`, sat && stood && seenSat && (s.kind !== "backed" || side !== "behind"), results[results.length - 1]);
      }
      numbers.seats = results;
    });
  }

  // ───────────────────────────────── camera ─────────────────────────────────
  if (ONLY.includes("camera")) {
    await run.step("5. the camera upstairs never leaves the walls or the ceiling", async () => {
      const b = U.bounds;
      let worst = { out: 0, up: 0 };
      for (const [x, z] of [[1.8, 2.6], [6.8, 1.0], [12.6, 1.0], [7.6, 6.4], [12.4, 12.3], [1.0, 12.4], [3.2, 6.0]]) {
        await walkAndWait(A, ...at(U, x, z), 60000, 0.8);
        for (const pitch of [0.05, 0.5, 1.2]) {
          for (let k = 0; k < 8; k++) {
            await orbit(A, (k * Math.PI) / 4, pitch);
            await sleep(1000);
            const c = await camera(A);
            const out = Math.max(b.minX - c.x, c.x - b.maxX, b.minZ - c.z, c.z - b.maxZ, 0);
            const up = Math.max(c.y - U.ceiling, 0);
            worst = { out: Math.max(worst.out, out), up: Math.max(worst.up, up) };
            if (out > 0.02 || up > 0.02) run.check(`camera outside upstairs at (${x}, ${z}) yaw ${k} pitch ${pitch}`, false, { c: [r2(c.x), r2(c.y), r2(c.z)] });
          }
        }
      }
      run.check("upstairs: the camera stays inside the salon (168 samples)", worst.out <= 0.02 && worst.up <= 0.02, worst);
      numbers.cameraUp = worst;
    });
  }

  // ───────────────────────────────── shots ─────────────────────────────────
  if (ONLY.includes("shots")) {
    await run.step("6. the salon by day, dusk and night (PC and phone)", async () => {
      const views = [
        ["stairtop", [2.4, 1.6, 2.2], [9.0, 1.2, 9.0]],
        ["front-windows", [7.0, 1.6, 8.5], [7.0, 1.6, 0.0]],
        ["sofa", [7.5, 1.5, 4.8], [13.4, 0.8, 5.0]],
        ["sideboard", [6.3, 1.5, 9.6], [6.3, 1.0, 13.0]],
        ["well", [3.2, 1.7, 3.0], [1.0, -1.6, 6.0]],
      ];
      for (const [label, t] of [["day", NOON], ["dusk", DUSK], ["night", NIGHT]]) {
        await setTime(A, t);
        await setTime(B, t);
        await sleep(3500);
        for (const [n, a, b] of views) await photo(A, a, b, `up-${label}-${n}`);
        if ((await inArea(B)) === UP) await photo(B, views[0][1], views[0][2], `up-${label}-stairtop`);
        const w = await A.page.evaluate(() => window.__cvLotRoom());
        run.check(`${label}: the salon's windows show the village`, w?.screens >= 1, w?.screens);
      }
      await setTime(A, NOON);
      await setTime(B, NOON);
      await sleep(1500);
    });
  }

  // ───────────────────────────────── down ─────────────────────────────────
  if (ONLY.includes("down")) {
    await run.step("7. down: the button at the stairwell (A), a tap on the balustrade then the button (B); both stay down", async () => {
      if ((await inArea(A)) !== UP) run.check("A is upstairs before going down", false, await inArea(A));
      await walkAndWait(A, U.stair.pad.x, U.stair.pad.z - 0.3, 40000, 0.5);
      await sleep(1200);
      const t = await targets(A);
      run.check("at the stairwell A is offered '1층으로 내려가기'", t.some((x) => /1층/.test(x.label)), t);
      await act(A);
      run.check("A goes down with E", await waitArea(A, GROUND, 90000), await inArea(A));
      await waitRoom(A, "lot_cafe_room");
      await sleep(5000);
      const p = await pos(A);
      run.check("A lands at the stair's foot and stays down (5 s, nothing pressed)", (await inArea(A)) === GROUND && Math.hypot(p.x - (G.origin.x + 0.65), p.z - (G.origin.z + 2.6)) < 1.2, { p: [r2(p.x), r2(p.z)] });
      await shot(A, "down-arrive");
      // B: a tap on the stairwell's balustrade
      if ((await inArea(B)) === UP) {
        await walkAndWait(B, ...at(U, 3.6, 3.0), 40000, 0.7);
        // the balustrade's rail over the stairwell: turn the view until it is on the screen, then a real tap on it
        let tap = { ok: false };
        for (let k = 0; k < 8 && !tap.ok; k++) {
          await orbit(B, (k * Math.PI) / 4, 0.45);
          await sleep(1800);
          const s = await B.page.evaluate(async ([x, y, z]) => {
            const THREE = await window.__imp("/deps/three.js");
            const { camera } = window.__cvThree();
            camera.updateMatrixWorld();
            const v = new THREE.Vector3(x, y, z).project(camera);
            return Math.abs(v.x) < 0.8 && Math.abs(v.y) < 0.8 && v.z < 1;
          }, [U.origin.x + 2.48, 0.95, U.origin.z + 5.5]);
          if (s) tap = await tapWorld(B, U.origin.x + 2.48, 0.95, U.origin.z + 5.5);
        }
        run.check("the balustrade is on B's screen (a real tap)", tap.ok, tap.s);
        await B.page.waitForFunction(() => window.__cvClickTarget?.() === null, null, { timeout: 60000 }).catch(() => {});
        await sleep(4000);
        run.check("a tap on the stairwell: B walks to it and does NOT go down", (await inArea(B)) === UP, await inArea(B));
        const tb = await targets(B);
        run.check("after the tap B is offered '1층으로 내려가기'", tb.some((x) => /1층/.test(x.label)), { p: await pos(B), tb });
        if (!tb.some((x) => /1층/.test(x.label))) await walkAndWait(B, U.stair.pad.x, U.stair.pad.z - 0.3, 40000, 0.5);
        await act(B);
        run.check("then the button: B goes down", await waitArea(B, GROUND, 90000), await inArea(B));
      }
    });
  }
} catch (err) {
  console.error("run error", err);
  run.check("run completed without an exception", false, String(err).slice(0, 300));
} finally {
  writeFileSync(join(OUT, "cafe-upstairs-numbers.json"), JSON.stringify(numbers, null, 1));
  await run.finish?.();
  await browser.close();
  await browserB.close();
  const failed = run.results.filter((r) => !r.ok);
  console.log(`\n${run.results.length - failed.length}/${run.results.length} checks passed`);
  for (const f of failed) console.log("FAIL", f.step, "-", f.name, JSON.stringify(f.detail)?.slice(0, 300));
  if (run.errors.length) console.log("page errors:", JSON.stringify(run.errors.slice(0, 6)));
  process.exitCode = failed.length ? 1 : 0;
}
