/**
 * House e2e (집 실내 G, design chapter 8.2 / 8.3 / 8.4 / 8.6 on house 1): in by the keypad, up the stair and down again (the button; a tap on
 * the stair only walks to it, its button climbs), every seat sat on and stood up from (a walk to its approach and E / the button, three of them by a tap), a few camera spots, the
 * way out. Screenshots of every step; the page must print no console error.
 *
 *   server:  PORT=3011 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3011 npx vite --port 5611 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5611 node e2e/village-house.mjs [--phone] [--night] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import {
  CLIENT_URL, DESKTOP, PHONE, centreOf, createRun, entryReady, launchBrowser, openPlayer, press, sleep, targets, walkAndWait, pos, visibleButtons, layoutReport, turnCameraTo, waitIdle,
} from "./lib/common.mjs";
import { serverPos } from "./lib/noauto.mjs";

const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const skipSeats = process.argv.includes("--skip-seats"); // the per-seat sweep is the long part: a rerun of the rest
const quick = process.argv.includes("--quick"); // phone / night: five seats per floor (the cushion h1_1_3 and the first bed edges included) instead of all
const name = `village-house${phone ? "-phone" : ""}${night ? "-night" : ""}`;
const run = createRun(name);
const outArg = process.argv.find((a) => a.startsWith("--out="));
run.evidence = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(run.evidence, { recursive: true });

const device = phone ? PHONE : DESKTOP;
const browser = await launchBrowser();
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";
const URL = `${CLIENT_URL}/?time=${encodeURIComponent(time)}`;
const DOOR = [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]]; // the keypad pad stands on the porch since release 1 (≈ (21, -39.40))

const p = await openPlayer(browser, run, { tag: "house", device });
const areaOf = () => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const act = async () => {
  if (phone) await press(p, p.page.locator(".cv-action-btn").first());
  else await p.page.keyboard.press("KeyE");
};
async function waitArea(a, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf()) === a) return;
    await sleep(120);
  }
  throw new Error(`never reached area ${a} (now ${await areaOf()})`);
}
async function coverGone() {
  await p.page.waitForFunction(() => {
    const c = document.querySelector(".cv-house-cover");
    const f = document.querySelector(".cv-door-fade");
    return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
  }, null, { timeout: 15000 });
  await sleep(450);
}
/** Project a world point to a screen point of the page (null when behind the camera / off screen). */
const toScreen = (x, y, z) =>
  p.page.evaluate(([x, y, z]) => {
    const t = window.__cvThree?.();
    if (!t) return null;
    const cam = t.camera;
    cam.updateMatrixWorld();
    const v = new cam.position.constructor(x, y, z).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 1 || Math.abs(v.y) > 1) return null;
    const r = t.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z]);
const tapAt = async (s) => (phone ? p.page.touchscreen.tap(s.x, s.y) : p.page.mouse.click(s.x, s.y));
const seatState = () => p.page.evaluate(() => window.__cv.getPos());
/**
 * Walk to (x, z) the way a tap on the floor there does: the game's click plan (its way round the furniture) and ONE click-move along its
 * waypoints, as the game sets it (a walk per waypoint stops each one ARRIVE_DIST short, and a short stop beside a piece's corner blocks the
 * next straight leg). True when it ends within `tol`.
 */
async function walkGame(x, z, tol = 0.5) {
  const plan = await p.page.evaluate(async ([x, z]) => {
    const cp = await window.__imp("/src/game/clickPlan.ts");
    const am = await window.__imp("/src/game/activeMap.ts");
    const cm = await window.__imp("/src/game/clickMove.ts");
    const map = am.getActiveMap();
    const at = window.__cv.getPos();
    const r = cp.planClickMove(at.x, at.z, { x, y: 0, z, ny: 1 }, map.geometry.obstacles, am.mapBounds(map), false, { furniture: map.furniture ?? [] });
    if (r.ok) cm.setClickTarget(r.x, r.z, 0, r.via);
    return r;
  }, [x, z]);
  if (plan.ok) {
    await sleep(300);
    await waitIdle(p, 30000);
  }
  const at = await pos(p);
  return Math.hypot(at.x - x, at.z - z) <= tol;
}

try {
  await p.page.goto(URL, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill("집구경");
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });

  await run.step("in through the keypad", async () => {
    for (const [x, z] of DOOR) await walkAndWait(p, x, z, 40000, 1.2);
    await act();
    await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const c of "1004") await press(p, p.page.locator(`.cv-keypad button[data-key="${c}"]`));
    await press(p, p.page.locator('.cv-keypad button[data-key="ok"]'));
    await waitArea("house:house_1:1", 20000);
    await coverGone();
    run.check("on floor 1", (await areaOf()) === "house:house_1:1");
    await run.shot(p, "f1-arrival.png");
    const info = await p.page.evaluate(() => window.__cvHouse?.());
    run.check("the house floor is drawn (dev probe)", info && info.n === 1 && info.floor === 1 && info.meshes > 10, info);
    run.check("the dressed model: light-mapped, with its window view (HA's house 1)", info && info.lightmapped === true && info.viewMaterial === true, info);
  });

  await run.step("up the stair (the button), and down again", async () => {
    const up = { x: 369.85, z: -5.8 };
    await walkAndWait(p, up.x, up.z + 0.35, 30000, 0.5);
    const t = await targets(p);
    run.check("the up button is offered at the foot of the stair", t.some((x) => x.id === "house_stair:up"), t);
    if (phone) {
      const btns = await visibleButtons(p);
      const rep = layoutReport(btns, { width: 375, height: 812 });
      run.check("phone: buttons in the house are ≥ 48 px, apart, on screen", rep.ok, rep);
    }
    await run.shot(p, "f1-stair-prompt.png");
    await act();
    await waitArea("house:house_1:2");
    await coverGone();
    const at = await pos(p);
    run.check("floor 2: at the top of the stair, looking into the room", Math.hypot(at.x - 364.21, at.z - 22.95) < 0.5, at);
    const label = await p.page.evaluate(async () => (await window.__imp("/src/game/activeMap.ts")).getActiveMap().zoneLabel(0, 0));
    run.check('HUD place name "1번 집 · 2층"', label === "1번 집 · 2층", label);
    await run.shot(p, "f2-arrival.png");
    await sleep(1100); // the door's cap: one use a second
    const t2 = await targets(p);
    run.check("floor 2: the down button is offered there", t2.some((x) => x.id === "house_stair:down"), t2);
    await act();
    await waitArea("house:house_1:1");
    await coverGone();
    const back = await pos(p);
    run.check("floor 1: back at the foot of the stair", Math.hypot(back.x - 369.85, back.z - -5.45) < 0.5, back);
    await run.shot(p, "f1-after-down.png");
    await sleep(1100);
  });

  await run.step("a tap on the stair walks to its pad and does NOT climb; the up button does", async () => {
    // owner 2026-11-27: "계단을 탭하면 올라가게 하지 말고 계단 버튼을 누르면 올라가도록 하는게 맞아" — a tap only walks to the stair's pad
    // a spot with a view of the stair (the entrance's partitions hide it from the spawn spot)
    await walkAndWait(p, 365.3, -4.9, 20000, 0.8);
    await sleep(700);
    // a tread of the flight (house 1: stair A, rising 4 m along -x from its foot at x 370.5 over 5.44 m), its room-side half. (The old aim,
    // (367, 1.2, -7), was the empty space UNDER the flight: the pick was the back wall behind it, z -7.8, y 0.96 — no stair was tapped.)
    const sx = 367.6;
    const s = await toScreen(sx, ((370.5 - sx) / 5.44) * 4.0 + 0.05, -6.75);
    run.check("the stair is on screen", !!s, s);
    if (s) {
      await tapAt(s);
      await sleep(300);
      const pk = await p.page.evaluate(() => window.__cvClickPick?.() ?? null);
      run.check("the tap landed on the stair (not a wall in front of it)", pk && pk.pick && !/wall/.test(pk.pick.name), pk && pk.pick && { name: pk.pick.name, plan: pk.plan });
      await p.page.waitForFunction(() => window.__cvClickTarget?.() === null, null, { timeout: 15000 }).catch(() => {});
      await sleep(2500); // long enough for a (wrong) use on arrival and its fade
      run.check("tapped the stair: still on floor 1 (a tap never climbs)", (await areaOf()) === "house:house_1:1", await areaOf());
      const t = await targets(p);
      const tapInfo = await p.page.evaluate(async () => {
        const k = window.__cvClickPick?.();
        const pk = k && k.pick;
        if (!pk) return null;
        const ht = await window.__imp("/src/village/houseTap.ts");
        return { pick: { name: pk.name, x: +pk.x.toFixed(2), y: +pk.y.toFixed(2), z: +pk.z.toFixed(2), ny: pk.ny }, plan: k.plan, stair: ht.houseTapTarget("house:house_1:1", pk.x, pk.y, pk.z, pk.ny, pk.ray, pk.distance) };
      });
      run.check("tapped the stair: walked to its pad, the up button is offered", t.some((x) => x.id === "house_stair:up"), { at: await pos(p), t, tapInfo });
      await run.shot(p, "f1-after-stair-tap.png");
      await act();
      await waitArea("house:house_1:2", 15000).catch(() => {});
      run.check("then the up button: arrived upstairs", (await areaOf()) === "house:house_1:2", await areaOf());
      await coverGone();
      await run.shot(p, "f2-after-button.png");
    }
  });

  // ---- seats: every seat of both floors
  const seatList = await p.page.evaluate(async () => {
    const m = await window.__imp("/src/village/benchSeats.ts");
    return m.VILLAGE_SEATS.map((s, index) => ({ index, id: s.id, area: s.area, x: s.x, z: s.z, yaw: s.yaw, standX: s.standX, standZ: s.standZ, bench: s.bench, kind: s.kind, seatY: s.seatY, pose: s.pose, retired: s.retired, reachFrom: s.reachFrom })).filter((s) => s.area.startsWith("house:") && !s.retired);
  });
  run.check("house 1 has its 12 seats (13 places with both-facings)", seatList.length >= 12, seatList.length);
  /** A free spot from which the prompt offers seat `index` (the client's rule), nearest the seat first. */
  const approachFor = (s) =>
    p.page.evaluate(async (seat) => {
      const bs = await window.__imp("/src/village/benchSeats.ts");
      const wm = await window.__imp("/src/worldMap.ts");
      const col = await window.__imp("/src/collision.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const map = am.villageActiveMap(seat.area);
      const out = [];
      for (const d of [0.7, 1.0, 1.3])
        for (let k = 0; k < 16; k++) {
          const a = (k * Math.PI) / 8;
          const x = seat.x + Math.cos(a) * d;
          const z = seat.z + Math.sin(a) * d;
          if (x < map.bounds.minX + 0.5 || x > map.bounds.maxX - 0.5 || z < map.bounds.minZ + 0.5 || z > map.bounds.maxZ - 0.5) continue;
          if (col.isBlocked(x, z, 0.5, map.geometry.obstacles, 0)) continue;
          if (wm.nearestFreeSeat(x, z, () => false, wm.SEAT_REACH, bs.VILLAGE_SEATS) === seat.index) out.push({ x, z, d });
        }
      // the spot a sitter stands up on is the first choice when the prompt offers the seat there (it is reachable by construction)
      if (!col.isBlocked(seat.standX, seat.standZ, 0.45, map.geometry.obstacles, 0) && wm.nearestFreeSeat(seat.standX, seat.standZ, () => false, wm.SEAT_REACH, bs.VILLAGE_SEATS) === seat.index) out.push({ x: seat.standX, z: seat.standZ, d: 0 });
      return out;
    }, s);

  for (const floor of skipSeats ? [] : [2, 1]) {
    await run.step(`floor ${floor}: sit on every seat and get up again`, async () => {
      if (floor === 1) {
        // downstairs: from the top landing
        const down = { x: 364.56, z: 22.95 };
        // by the game's own click plan (its way round the furniture: the last seat, the desk chair h1_2_3, stands the player up between the
        // chair, the desk and a plant, where walkAndWait's straight line to the landing is blocked — 2026-11-27), then onto the pad
        await walkGame(down.x - 0.15, down.z, 0.5);
        // (else via the open floor beside the landing, the room's middle; the position is logged for the report)
        for (let i = 0; i < 4 && !(await targets(p)).some((t) => t.id === "house_stair:down"); i++) {
          if (i > 0) await walkAndWait(p, 366.5, 24.5, 20000, 0.8);
          await walkAndWait(p, down.x - 0.15, down.z, 20000, 0.5);
        }
        run.check("on the landing, the down button is offered", (await targets(p)).some((t) => t.id === "house_stair:down"), await pos(p));
        await sleep(1100);
        await act();
        await waitArea("house:house_1:1");
        await coverGone();
      }
      for (const seat of seatList.filter((s) => s.area === `house:house_1:${floor}`).slice(0, quick ? 5 : 99)) {
        const spots = await approachFor(seat);
        if (!run.check(`${seat.id}: a free spot from which the prompt offers it`, spots.length > 0, spots.length)) continue;
        // prefer the nearest spot that is straight in front for a backed seat
        const spot = spots.sort((a, b) => a.d - b.d)[0];
        // the e2e walk is a straight click-move with sliding, no path search: go by open-floor hubs when the straight way is blocked by furniture
        const hubs = floor === 1 ? [[365.3, -4.9], [362.0, -1.0], [366.5, -2.3], [368.4, -5.0]] : [[366.5, 24.5], [364.5, 26.5], [367.5, 28.2]];
        let at = await walkAndWait(p, spot.x, spot.z, 25000, 0.3);
        for (const h of hubs) {
          if (Math.hypot(at.x - spot.x, at.z - spot.z) <= 0.35) break;
          await walkAndWait(p, h[0], h[1], 25000, 0.9);
          at = await walkAndWait(p, spot.x, spot.z, 25000, 0.3);
        }
        await sleep(300);
        const tg = await p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
        await act();
        await sleep(900);
        const st = await seatState();
        const sat = seatList.find((s) => s.index === st.seatIndex);
        const ok = st.seatIndex === seat.index || (seat.pose !== "floor" && sat && sat.area === seat.area && Math.hypot(sat.x - seat.x, sat.z - seat.z) < 1.3); // the nearest seat of the same piece also counts (not for the floor cushion: it must be that seat)
        run.check(`${seat.id}: E sits (seatIndex ${st.seatIndex}, wanted ${seat.index})`, ok, ok ? { tg, st } : { tg, st, server: await serverPos(p), sitOn: await p.page.evaluate(async () => (await window.__imp("/src/village/villageTargets.ts")).villageTargets?.((await window.__imp("/src/village/villageArea.ts")).localArea(), window.__cv.getPos().x, window.__cv.getPos().z)?.slice(0, 2) ?? null).catch((e) => String(e)) });
        if (st.seatIndex >= 0) {
          const d = Math.hypot(st.x - seatList.find((s) => s.index === st.seatIndex).x, st.z - seatList.find((s) => s.index === st.seatIndex).z);
          run.check(`${seat.id}: the sitter is on the seat spot`, d < 0.05, d);
          await sleep(2600); // the sit-down clip (about 1.5 s) must be over: the hold clip is what the probe should name
          const clip = await p.page.evaluate(() => {
            const a = window.__cvAvatars?.();
            const me = a && a[window.__cv.getSessionId()];
            return me ? me.clip : null;
          });
          if (seat.pose === "floor") run.check(`${seat.id}: the cross-legged floor clip plays (Sit_Floor_Idle), legs on the cushion`, /Sit_Floor/.test(String(clip)), clip);
          else run.check(`${seat.id}: a chair clip plays`, /Sit_Chair/.test(String(clip)), clip);
          await run.shot(p, `seat-${seat.id.replace(/[:]/g, "_")}.png`);
          await act(); // stand
          await sleep(1100);
          const up = await seatState();
          run.check(`${seat.id}: stood up (standing again, off the seat)`, up.seatIndex === -1, up);
        }
      }
    });
  }

  await run.step("a tap on a seat far away walks there, then 앉기 sits (3 seats, floor 1)", async () => {
    if ((await areaOf()) === "house:house_1:2") {
      // (a rerun that skipped the seat sweep arrives here upstairs)
      await walkAndWait(p, 364.4, 22.95, 20000, 0.5);
      await sleep(1100);
      await act();
      await waitArea("house:house_1:1");
      await coverGone();
      await sleep(1100);
    }
    const tapSeats = ["h1_1_0", "h1_1_4", "h1_1_5", "h1_1_6"].map((id) => seatList.find((x) => x.id === id)).filter(Boolean);
    for (const seat of tapSeats) {
      await walkAndWait(p, 365.3, -4.9, 20000, 0.8);
      await turnCameraTo(p, seat.x, seat.z);
      await sleep(900);
      // aim at the chair's cushion (its marker, `reachFrom`), not the sitter's spot 0.2 m over it: a house chair's sitter spot is at its
      // front edge, and from some views the pixel over it shows the floor under the dining table beyond (h1_1_5: the pick was that floor,
      // y 0.11, and the walk rightly went round the table — no chair was tapped)
      const c = seat.reachFrom ?? seat;
      const s = await toScreen(c.x, seat.seatY + 0.1, c.z);
      if (!run.check(`${seat.id}: on screen to tap`, !!s, s)) continue;
      await tapAt(s);
      await sleep(400);
      const pk = await p.page.evaluate(() => { const k = window.__cvClickPick?.(); return k && { pick: k.pick && { name: k.pick.name, x: +k.pick.x.toFixed(2), y: +k.pick.y.toFixed(2), z: +k.pick.z.toFixed(2) }, plan: k.plan, sitOn: k.sitOn }; });
      // owner 2026-11-17 ("의자를 찍으면 자동 앉기는 빼줘"): the tap walks there and stops standing; 앉기 (E / the button) then sits
      await p.page.waitForFunction(() => window.__cvClickTarget?.() === null, null, { timeout: 15000 }).catch(() => {});
      await sleep(700);
      const standing = (await p.page.evaluate(() => window.__cv.getPos().seatIndex)) < 0;
      run.check(`${seat.id}: the tap walked there and stopped standing (no sitting on a tap)`, standing && pk?.sitOn !== null && pk?.sitOn !== undefined, { pos: await seatState(), click: pk });
      if (standing) await act();
      const sat = await p.page.waitForFunction(() => window.__cv.getPos().seatIndex >= 0, null, { timeout: 8000 }).then(() => true, () => false);
      run.check(`${seat.id}: then 앉기 sat on it`, sat, { pos: await seatState() });
      if (sat) {
        await run.shot(p, `tap-sit-${seat.id}.png`);
        await act();
        await sleep(1100);
      }
    }
  });

  await run.step("camera spots: inside the room, under the ceiling, at 2 yaws", async () => {
    const spots = [[362, -2], [368, -2], [362, -6], [368, -6], [366, -4.5]];
    for (const [x, z] of spots) {
      await walkAndWait(p, x, z, 25000, 0.8);
      for (let y = 0; y < 2; y++) {
        const cam = await p.page.evaluate(() => {
          const t = window.__cvThree?.();
          return { x: t.camera.position.x, y: t.camera.position.y, z: t.camera.position.z };
        });
        const inRoom = cam.x > 360 && cam.x < 370.6 && cam.z > -7.8 && cam.z < 0 && cam.y > 0.2 && cam.y < 3.7;
        run.check(`camera at (${x}, ${z}) yaw ${y}: inside the room under the ceiling`, inRoom, cam);
        await run.shot(p, `cam-${x}_${z}-${y}.png`.replace("-", "n"));
        await turnCameraTo(p, x + (y ? 10 : -10), z - 4);
      }
    }
  });

  await run.step("camera stress: the steepest tilt beside the stair, looking toward it", async () => {
    await walkAndWait(p, 369.6, -5.2, 25000, 0.6);
    await turnCameraTo(p, 366, -9); // the camera behind the player, the stair beyond
    const c = await centreOf(p, "canvas");
    for (const dy of [260, 260]) {
      await p.page.mouse.move(c.x, c.y);
      await p.page.mouse.down();
      await p.page.mouse.move(c.x, c.y + dy, { steps: 8 });
      await p.page.mouse.up();
      await sleep(900);
      const cam = await p.page.evaluate(() => {
        const t = window.__cvThree?.();
        return { x: t.camera.position.x, y: t.camera.position.y, z: t.camera.position.z };
      });
      const inStair = cam.x > 365.06 && cam.x < 369.14 && cam.z > -7.7 && cam.z < -6.4 && cam.y < 3.7;
      run.check("the camera is in the room, not inside the stair's box", cam.x > 360 && cam.x < 370.6 && cam.z > -7.8 && cam.z < 0 && cam.y < 3.7 && !inStair, cam);
      await run.shot(p, `cam-steep-${dy}.png`);
    }
  });

  await run.step("the way out", async () => {
    // from beside the stair (the camera stress step) the dining table stands between the player and the door: walkAndWait's straight
    // click-move stopped against it (the failure before 2026-11-27, a test harness one). The game's own click plan goes round it.
    const out = await walkGame(365.3, -0.9, 0.5);
    run.check("from beside the stair the game's click plan walks round the table to the door", out, await pos(p));
    if (!out) {
      await walkAndWait(p, 365.3, -4.9, 20000, 0.8);
      await walkAndWait(p, 365.3, -0.9, 20000, 0.5);
    }
    run.check("the way-out button is offered", (await targets(p)).some((t) => t.id === "house_exit"));
    await act();
    await waitArea("village");
    await coverGone().catch(() => {});
    run.check("back in the village", (await areaOf()) === "village");
    await run.shot(p, "porch.png");
  });
} catch (err) {
  run.check("script ran to the end", false, String(err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
process.exit(run.finish());
