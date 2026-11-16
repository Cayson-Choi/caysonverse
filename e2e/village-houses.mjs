/**
 * All ten houses (집 실내 G, design chapter 8 on every house): in by the keypad, every room shot (day / night), the window view's direction,
 * up the stair and down again, every seat sat on (a tap from across the room: the walk, the sit, the pose, the legs) and stood up from,
 * camera spots × 8 yaws × 3 tilts, the way out.
 *
 *   server:  PORT=3011 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3011 npx vite --port 5611 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5611 node e2e/village-houses.mjs [--houses=1,2,..] [--phone] [--night] [--seats=all|none|N] [--no-camera] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, targets, pos, visibleButtons, layoutReport } from "./lib/common.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const noCamera = process.argv.includes("--no-camera");
/** realism pass 2026-11-17: also shoot each spot in first person (two looks), for the game | real sheets */
const fpShots = process.argv.includes("--fp");
const houses = arg("houses", "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
const seatsArg = arg("seats", "all");
const name = `village-houses${phone ? "-phone" : ""}${night ? "-night" : ""}`;
const run = createRun(name);
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

const device = phone ? PHONE : DESKTOP;
const VIEW = device.viewport;
const browser = await launchBrowser();
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";
const URL = `${CLIENT_URL}/?time=${encodeURIComponent(time)}`;
const p = await openPlayer(browser, run, { tag: "houses", device });
const page = p.page;
const report = { houses: {} };

const areaOf = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const act = async () => {
  if (phone) await press(p, page.locator(".cv-action-btn").first());
  else await page.keyboard.press("KeyE");
};
async function waitArea(a, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf()) === a) return true;
    await sleep(120);
  }
  return false;
}
async function coverGone() {
  await page
    .waitForFunction(() => {
      const c = document.querySelector(".cv-house-cover");
      const f = document.querySelector(".cv-door-fade");
      return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
    }, null, { timeout: 15000 })
    .catch(() => {});
  await sleep(450);
}
const idle = async (ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__cvClickTarget())) === null) return true;
    await sleep(120);
  }
  return false;
};
/**
 * Walk the way the game plans a tap on the floor (findDetour round the colliders of the map one is in), then wait. A long way across the
 * village the search gives up on is walked in halves.
 */
async function goto(x, z, tol = 0.35, depth = 0) {
  const r = await gotoOnce(x, z, tol);
  if (Math.hypot(r.x - x, r.z - z) <= tol || depth >= 3 || Math.hypot(r.x - x, r.z - z) < 4) return r;
  await gotoOnce((r.x + x) / 2, (r.z + z) / 2, 1.5);
  return goto(x, z, tol, depth + 1);
}
async function gotoOnce(x, z, tol) {
  for (let i = 0; i < 3; i++) {
    const planned = await page.evaluate(async ([x, z]) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const cm = await window.__imp("/src/game/clickMove.ts");
      const map = am.getActiveMap();
      const me = window.__cv.getPos();
      const b = map.bounds ?? map.geometry.bounds;
      const via = cp.findDetour(me.x, me.z, x, z, map.geometry.obstacles, b, undefined, { ratio: 4, slack: 30, margin: 40 });
      cm.setClickTarget(x, z, 0, via ?? undefined);
      return via !== null;
    }, [x, z]);
    await sleep(300);
    await idle();
    await sleep(250);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ...at, planned };
    if (!planned) return { ...at, planned };
  }
  return { ...(await pos(p)), planned: true };
}
/** Point the camera: yaw (the camera's orbit yaw, as viewState) and pitch, and wait for it to settle. */
async function orbit(yaw, pitch) {
  await page.evaluate(
    async ([yaw, pitch]) => {
      const vs = (await window.__imp("/src/game/viewState.ts")).viewState;
      vs.orbitGoal = { yaw, pitch: pitch ?? vs.orbitGoal?.pitch ?? window.__cv.getOrbit().pitch };
    },
    [yaw, pitch],
  );
  await sleep(900);
}
/** The yaw of a camera behind the player that looks toward (tx, tz) (turnCameraTo's sum). */
const yawToward = (at, tx, tz) => Math.atan2(-(tx - at.x), -(tz - at.z));
const camPos = () =>
  page.evaluate(() => {
    const t = window.__cvThree?.();
    return t ? { x: t.camera.position.x, y: t.camera.position.y, z: t.camera.position.z } : null;
  });
const toScreen = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const t = window.__cvThree?.();
    if (!t) return null;
    const cam = t.camera;
    cam.updateMatrixWorld();
    const v = new cam.position.constructor(x, y, z).project(cam);
    window.__cvLastProject = { x: +v.x.toFixed(3), y: +v.y.toFixed(3), z: +v.z.toFixed(3), cam: [+cam.position.x.toFixed(2), +cam.position.y.toFixed(2), +cam.position.z.toFixed(2)] };
    if (v.z > 1 || Math.abs(v.x) > 0.92 || Math.abs(v.y) > 0.85) return null;
    const r = t.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z]);
const tapAt = async (s) => (phone ? page.touchscreen.tap(s.x, s.y) : page.mouse.click(s.x, s.y));
const me = () => page.evaluate(() => window.__cv.getPos());
/** The lowest leg bone of the local avatar (world y) and its clip. */
const legs = () =>
  page.evaluate(() => {
    const t = window.__cvThree?.();
    const at = window.__cv.getPos();
    let low = Infinity;
    let lowName = "";
    const v = new t.camera.position.constructor();
    t.scene.traverse((o) => {
      if (!o.isBone || !/(foot|toe|calf|shin|knee|leg)/i.test(o.name)) return;
      o.getWorldPosition(v);
      if (Math.hypot(v.x - at.x, v.z - at.z) > 1.3) return;
      if (v.y < low) {
        low = v.y;
        lowName = o.name;
      }
    });
    const a = window.__cvAvatars?.();
    const mine = a && a[window.__cv.getSessionId()];
    return { low: Math.round(low * 1000) / 1000, lowName, clip: mine ? mine.clip : null };
  });
const shot = (f) => run.shot(p, f);
/** Floor discs or rings drawn within 1 m of these pads (owner 2026-11-16: no disc at a house's exit or stair; the tap marker excepted). */
const discsNear = (pads) =>
  page.evaluate((pads) => {
    const t = window.__cvThree?.();
    const out = [];
    const v = new t.camera.position.constructor();
    t.scene.traverse((o) => {
      if (!o.isMesh || !/^(RingGeometry|CircleGeometry)$/.test(o.geometry?.type ?? "")) return;
      for (let q = o; q; q = q.parent) if (!q.visible) return;
      o.getWorldPosition(v);
      if (v.y > 0.3) return;
      if (pads.some((p) => Math.hypot(p.x - v.x, p.z - v.z) < 1)) out.push({ type: o.geometry.type, x: +v.x.toFixed(2), z: +v.z.toFixed(2) });
    });
    return out;
  }, pads);

await page.goto(URL, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("집구경");
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await sleep(1500);

const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts").catch(() => null))?.keypadEntries?.() ?? null);
const places = await page.evaluate(async () => {
  const h = await window.__imp("/shared/src/village/houseAreas.ts").catch(() => null);
  return h ? h.HOUSE_PLACES : null;
});
run.check("the keypad and place tables load in the page", !!keypads && !!places, { keypads: !!keypads, places: !!places });

for (const n of houses) {
  const H = (report.houses[n] = { checks: [], shots: [] });
  const tag = `h${n}`;
  const kp = keypads.find((k) => k.buildingId === `house_${n}`);
  const P = places[n];

  await run.step(`house ${n}: in through the keypad`, async () => {
    if ((await areaOf()) !== "village") {
      // still in the last house: out
      await goto(places[n - 1]?.exitPad.x ?? 0, places[n - 1]?.exitPad.z ?? 0, 0.5);
    }
    const at = await goto(kp.pad.x, kp.pad.z, 0.9);
    run.check(`h${n}: walked to the keypad`, Math.hypot(at.x - kp.pad.x, at.z - kp.pad.z) < 1.5, at);
    const t = await targets(p);
    run.check(`h${n}: "번호키 열기" is offered at the door`, t.some((x) => x.id === `keypad:house_${n}`), t.slice(0, 3));
    await act();
    const open = await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
    run.check(`h${n}: the keypad opens`, open);
    if (!open) return;
    for (const c of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${c}"]`));
    await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
    const inside = await waitArea(`house:house_${n}:1`, 20000);
    await coverGone();
    run.check(`h${n}: 1004 → floor 1`, inside, await areaOf());
    const info = await page.evaluate(() => window.__cvHouse?.());
    run.check(`h${n}: the dressed model is drawn with its light map and its window view`, info && info.n === n && info.meshes > 4 && info.lightmapped && info.viewMaterial, info);
    const label = await page.evaluate(async () => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const p = window.__cv.getPos();
      return am.getActiveMap().zoneLabel(p.x, p.z);
    });
    run.check(`h${n}: HUD "${n}번 집 · 1층"`, label === `${n}번 집 · 1층`, label);
    const cam = await camPos();
    const b = await page.evaluate(async () => (await window.__imp("/src/game/activeMap.ts")).currentBounds?.() ?? null);
    const room = { minX: P.exitPad.x - 5.3, maxX: P.exitPad.x + 5.3, minZ: -7.8, maxZ: 0 };
    run.check(`h${n}: the arrival camera is in the room under the ceiling`, cam && cam.x > room.minX && cam.x < room.maxX && cam.z > room.minZ && cam.z < room.maxZ && cam.y < 3.7 && cam.y > 0.3, { cam, b });
    await sleep(600);
    await shot(`${tag}-1-arrival.png`);
    const d1 = await discsNear([P.exitPad, P.upPad]);
    run.check(`h${n}: no disc on the floor at the way out or the stair (floor 1)`, d1.length === 0, d1);
  });

  // The window view: its band's u against the bearing round its centre (both builders: u = 0.5 + bearing / 2π in the house's frame), and
  // the texture's turn (houseViewMapping) — logged per house for the report.
  await run.step(`house ${n}: the window view's mapping`, async () => {
    const v = await page.evaluate(() => {
      const t = window.__cvThree?.();
      const out = [];
      let tex = null;
      t.scene.traverse((o) => {
        if (!o.isMesh) return;
        const m = Array.isArray(o.material) ? o.material : [o.material];
        if (!m.some((x) => x.name === "M_view")) return;
        let vis = true;
        for (let q = o; q; q = q.parent) if (!q.visible) vis = false;
        if (!vis) return;
        const mat = m.find((x) => x.name === "M_view");
        if (mat.map) tex = { offset: [mat.map.offset.x, mat.map.offset.y], repeat: [mat.map.repeat.x, mat.map.repeat.y], wrapS: mat.map.wrapS, cs: mat.map.colorSpace, w: mat.map.image?.width };
        const pos = o.geometry.getAttribute("position");
        const uv = o.geometry.getAttribute("uv");
        o.updateMatrixWorld();
        const v3 = new t.camera.position.constructor();
        let cx = 0, cz = 0;
        for (let i = 0; i < pos.count; i++) {
          v3.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          cx += v3.x;
          cz += v3.z;
        }
        cx /= pos.count;
        cz /= pos.count;
        let worst = 0;
        let ymin = Infinity, ymax = -Infinity, vmin = Infinity, vmax = -Infinity;
        for (let i = 0; i < pos.count; i++) {
          v3.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          const b = Math.atan2(v3.x - cx, -(v3.z - cz));
          let want = 0.5 + b / (2 * Math.PI);
          let d = uv.getX(i) - want;
          d -= Math.round(d);
          worst = Math.max(worst, Math.abs(d));
          if (v3.y < ymin) { ymin = v3.y; }
          if (v3.y > ymax) { ymax = v3.y; }
          vmin = Math.min(vmin, uv.getY(i));
          vmax = Math.max(vmax, uv.getY(i));
        }
        // the band's top must carry the small v (the image's top row)
        let topV = 0, n = 0;
        for (let i = 0; i < pos.count; i++) {
          v3.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
          if (v3.y > ymax - 0.01) { topV += uv.getY(i); n++; }
        }
        out.push({ name: o.name, verts: pos.count, centre: [Math.round(cx * 100) / 100, Math.round(cz * 100) / 100], worstU: Math.round(worst * 1000) / 1000, y: [Math.round(ymin * 10) / 10, Math.round(ymax * 10) / 10], v: [vmin, vmax], topV: n ? topV / n : null });
      });
      return { bands: out, tex };
    });
    H.view = v;
    run.check(`h${n}: a window view band is drawn on floor 1`, v.bands.length > 0, v);
    run.check(`h${n}: its u follows the bearing round the room (u = 0.5 + b/2π, ≤ 0.02 off)`, v.bands.every((b) => b.worstU <= 0.02), v.bands.map((b) => b.worstU));
    run.check(`h${n}: the band's top samples the image's top (v small at the top)`, v.bands.every((b) => b.topV !== null && b.topV < Math.min(...[b.v[1]]) - 0.2), v.bands.map((b) => [b.topV, b.v]));
    run.check(`h${n}: the panorama is bound (sRGB, wraps round)`, v.tex && v.tex.cs === "srgb" && v.tex.wrapS === 1000, v.tex);
  });

  // ---- shots of each floor at a few spots × 4 yaws (the visual review), and the camera sweep
  const floorShots = async (floor) => {
    const ox = P.exitPad.x - 5.3;
    const oz = floor === 1 ? 0 : 30;
    // local (x right, z into the room) → world (x, oz − z)
    const spots = [[2.5, 2.2], [8.1, 2.2], [2.5, 5.6], [8.1, 5.6], [5.3, 3.9]];
    let k = 0;
    for (const [lx, lz] of spots) {
      const at = await goto(ox + lx, oz - lz, 0.9);
      if (Math.hypot(at.x - (ox + lx), at.z - (oz - lz)) > 1.2) continue;
      k++;
      for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        await orbit(yaw, 0.32);
        await shot(`${tag}-${floor}-s${k}-y${Math.round((yaw * 180) / Math.PI)}.png`);
      }
      if (fpShots) {
        for (const yaw of [0, Math.PI]) {
          await page.evaluate(async (yaw) => {
            const vs = await window.__imp("/src/game/viewState.ts");
            vs.enterFp(yaw);
            vs.viewState.fpPitch = -0.12;
          }, yaw);
          await sleep(1300);
          await shot(`${tag}-${floor}-s${k}-fp${Math.round((yaw * 180) / Math.PI)}.png`);
        }
        await page.evaluate(async () => {
          const vs = await window.__imp("/src/game/viewState.ts");
          vs.viewState.mode = "tp";
        });
        await sleep(900);
      }
    }
    run.check(`h${n} floor ${floor}: shot from ≥ 3 spots`, k >= 3, k);
    if (noCamera) return;
    // camera: 8 yaws × 3 tilts at the shot spots, the camera stays in the floor's room under its ceiling
    const bad = [];
    for (const [lx, lz] of spots.slice(0, 3)) {
      const at = await goto(ox + lx, oz - lz, 0.9);
      for (let y = 0; y < 8; y++)
        for (const pitch of [0.05, 0.35, 1.1]) {
          await page.evaluate(
            async ([yaw, pitch]) => {
              const vs = (await window.__imp("/src/game/viewState.ts")).viewState;
              vs.orbitGoal = { yaw, pitch };
            },
            [(y * Math.PI) / 4, pitch],
          );
          await sleep(320);
          const c = await camPos();
          const inRoom = c.x > ox - 0.02 && c.x < ox + 10.62 && c.z < oz + 0.02 && c.z > oz - 7.82 && c.y > 0.15 && c.y < 3.7;
          if (!inRoom) bad.push({ at: [Math.round(at.x * 10) / 10, Math.round(at.z * 10) / 10], yaw: y, pitch, cam: c });
        }
    }
    run.check(`h${n} floor ${floor}: camera 3 spots × 8 yaws × 3 tilts stays in the room under the ceiling`, bad.length === 0, bad.slice(0, 4));
  };

  const seatList = await page.evaluate(async (n) => {
    const m = await window.__imp("/src/village/benchSeats.ts");
    const g = await window.__imp("/shared/src/village/generated/houses/index.ts");
    const markers = g.GENERATED_HOUSES[n]?.seats ?? [];
    return m.VILLAGE_SEATS.map((s, index) => {
      const mk = markers.find((k) => k.id === s.bench);
      return { index, id: s.id, area: s.area, x: s.x, z: s.z, yaw: s.yaw, standX: s.standX, standZ: s.standZ, bench: s.bench, kind: s.kind, seatY: s.seatY, pose: s.pose, frontEdge: s.frontEdge, mx: mk?.x ?? s.x, mz: mk?.z ?? s.z, furn: mk?.furn };
    }).filter((s) => s.area.startsWith(`house:house_${n}:`));
  }, n);
  H.seats = seatList.length;

  const seatSweep = async (floor) => {
    let list = seatList.filter((s) => s.area === `house:house_${n}:${floor}`);
    if (seatsArg === "none") return;
    if (seatsArg !== "all") list = list.slice(0, Number(seatsArg));
    const from = floor === 1 ? P.spawnIn : P.spawnUp;
    for (const seat of list) {
      // a tap on the seat (its cushion) from across the room — the arrival spot — the camera looking at it; when a partition or another
      // piece is in front of it there, again from 1.6 m out in front of its stand spot (the tap that hit something else walked there)
      let sat = false;
      let tries = [];
      for (const vantage of ["far", "near", "stand"]) {
        // far: the arrival spot; near: 1.6 m out from the stand spot along the seat's facing; stand: the stand spot itself, 1 m back from it
        const away = Math.hypot(seat.standX - seat.x, seat.standZ - seat.z) || 1;
        const want =
          vantage === "far"
            ? { x: from.x, z: from.z }
            : vantage === "near"
              ? { x: seat.standX + Math.sin(seat.yaw) * 1.6, z: seat.standZ + Math.cos(seat.yaw) * 1.6 }
              : { x: seat.standX + ((seat.standX - seat.x) / away) * 0.6, z: seat.standZ + ((seat.standZ - seat.z) / away) * 0.6 };
        const at = await goto(want.x, want.z, 0.9);
        await orbit(yawToward(at, seat.mx, seat.mz), 0.55);
        // the cushion's middle (the marker; the seat point of a chair at a table is under the table)
        const sc = await toScreen(seat.mx, seat.seatY + 0.04, seat.mz);
        if (!sc) {
          tries.push({ vantage, at: [at.x, at.z], screen: null });
          continue;
        }
        await tapAt(sc);
        await sleep(400);
        const pk = await page.evaluate(() => {
          const k = window.__cvClickPick?.();
          return k && { pick: k.pick && { name: k.pick.name, x: +k.pick.x.toFixed(2), y: +k.pick.y.toFixed(2), z: +k.pick.z.toFixed(2) }, plan: k.plan && { ok: k.plan.ok, reason: k.plan.reason, x: k.plan.x, z: k.plan.z }, sitOn: k.sitOn };
        });
        sat = await page.waitForFunction(() => window.__cv.getPos().seatIndex >= 0, null, { timeout: 15000 }).then(() => true, () => false);
        const st = await me();
        tries.push({ vantage, at: [Math.round(at.x * 100) / 100, Math.round(at.z * 100) / 100], click: pk, end: { i: st.seatIndex, x: Math.round(st.x * 100) / 100, z: Math.round(st.z * 100) / 100 } });
        if (sat) break;
        // the click named this seat yet the walk ended unseated: that is the failure itself (no second try hides it)
        if (pk && pk.sitOn === seat.index) break;
      }
      const st = await me();
      const satOn = seatList.find((x) => x.index === st.seatIndex);
      const ok = sat && (st.seatIndex === seat.index || (satOn && satOn.bench === seat.bench));
      run.check(`${seat.id}: a tap walks there and sits on it`, ok, { want: seat.index, got: satOn?.id ?? null, tries });
      if (sat && !ok) {
        await act();
        await sleep(1200);
      }
      if (!ok) {
        // the E / button way, from its stand spot
        await goto(seat.standX, seat.standZ, 0.2);
        await sleep(300);
        await act();
        await sleep(900);
        const st2 = await me();
        run.check(`${seat.id}: (fallback) E at its stand spot sits`, st2.seatIndex === seat.index || seatList.find((x) => x.index === st2.seatIndex)?.bench === seat.bench, { i: st2.seatIndex, at: [st2.x, st2.z], stand: [seat.standX, seat.standZ] });
        if (st2.seatIndex < 0) continue;
      }
      await sleep(2700); // the sit-down clip is over: the hold clip shows
      const lg = await legs();
      if (seat.pose === "floor") run.check(`${seat.id}: cross-legged on the floor (Sit_Floor), no leg bone under the floor`, /Sit_Floor/.test(String(lg.clip)) && lg.low > -0.03, lg);
      else run.check(`${seat.id}: a chair clip, legs above the floor`, /Sit_Chair|Sit_Perch|Sit/.test(String(lg.clip)) && lg.low > -0.05, lg);
      const after = await me();
      const sp = seatList.find((x) => x.index === after.seatIndex);
      run.check(`${seat.id}: on the seat spot`, sp && Math.hypot(after.x - sp.x, after.z - sp.z) < 0.06, sp && Math.hypot(after.x - sp.x, after.z - sp.z));
      await shot(`${tag}-seat-${seat.id.replace(/:/g, "_")}.png`);
      await act();
      await sleep(1200);
      const up = await me();
      run.check(`${seat.id}: stands up`, up.seatIndex === -1, { i: up.seatIndex });
    }
  };

  await run.step(`house ${n}: floor 1 rooms`, async () => floorShots(1));
  await run.step(`house ${n}: floor 1 seats`, async () => seatSweep(1));

  await run.step(`house ${n}: up the stair (a tap on it), and down again (the button)`, async () => {
    if ((await areaOf()) !== `house:house_${n}:1`) return;
    const up = P.upPad;
    // a tap on the stair from ~2.4 m in front of its pad. Stairs C / D start at the front wall (the pad 1.3 m in): straight back is outside
    // the room (the walk stopped 0.7 m from the pad and, on a phone's narrow view, the stair point was off screen — art round 2's phone h6
    // failure), so step back diagonally into the room instead: the first spot that is inside the room with a 0.8 m margin.
    const ox = 360 + 24 * (n - 1);
    const inRoom = (q) => q.x > ox + 0.8 && q.x < ox + 10.6 - 0.8 && q.z < -0.8 && q.z > -7.8 + 0.8;
    const fx = Math.sin(up.yaw);
    const fz = Math.cos(up.yaw);
    const cands = [
      { x: up.x - fx * 2.4, z: up.z - fz * 2.4 },
      ...[1, -1].map((sg) => ({ x: up.x - fx * 1.2 + fz * sg * 2.0, z: up.z - fz * 1.2 - fx * sg * 2.0 })),
      ...[1, -1].map((sg) => ({ x: up.x + fz * sg * 2.4, z: up.z - fx * sg * 2.4 })),
      // beside the flight, out in the room (C / D on a phone: the camera behind a spot by the front wall or the hall partition is pushed
      // round and never faces the stair)
      ...[1, -1].map((sg) => ({ x: up.x + fz * sg * 1.8 + fx * 2.0, z: up.z - fx * sg * 1.8 + fz * 2.0 })),
    ];
    // try the spots in turn (straight back first, as before): the first one walked to from which the stair point is on screen
    let at = null;
    let s = null;
    search: for (const back of [cands[0], ...cands.slice(5).filter(inRoom), ...cands.slice(1, 5).filter(inRoom)]) {
      at = await goto(back.x, back.z, 0.9);
      for (const pitch of [0.5, 0.3, 0.15]) {
        await orbit(yawToward(at, up.x + Math.sin(up.yaw) * 1.6, up.z + Math.cos(up.yaw) * 1.6), pitch);
        // a tread on screen: 1.0 .. 2.8 m up the flight from the pad (the treads rise ~0.69 m per m)
        for (const d of [1.0, 1.6, 2.2, 2.8]) {
          s = await toScreen(up.x + Math.sin(up.yaw) * d, 0.1 + 0.69 * Math.max(0, d - 0.6), up.z + Math.cos(up.yaw) * d);
          if (s) break search;
        }
      }
    }
    let upstairs = false;
    if (s) {
      await tapAt(s);
      upstairs = await waitArea(`house:house_${n}:2`, 15000);
    }
    run.check(`h${n}: a tap on the stair walks there and goes up`, upstairs, { s, at, last: await page.evaluate(() => window.__cvLastProject ?? null), pick: await page.evaluate(() => window.__cvClickPick?.()?.pick?.name ?? null) });
    if (!upstairs) {
      at = await goto(up.x, up.z, 0.3);
      const t = await targets(p);
      run.check(`h${n}: at the stair pad the up button is offered`, t.some((x) => x.id === "house_stair:up"), { at, t: t.slice(0, 3) });
      if (phone) {
        const rep = layoutReport(await visibleButtons(p), VIEW);
        run.check(`h${n}: phone buttons ≥ 48 px, apart, on screen`, rep.ok, rep);
      }
      await act();
      upstairs = await waitArea(`house:house_${n}:2`, 12000);
      run.check(`h${n}: the up button takes one to floor 2`, upstairs, await areaOf());
      if (!upstairs) return;
    }
    await coverGone();
    const a2 = await pos(p);
    run.check(`h${n}: floor 2 arrival at the top of the stair`, Math.hypot(a2.x - P.spawnUp.x, a2.z - P.spawnUp.z) < 0.6, { a2, want: P.spawnUp });
    const label = await page.evaluate(async () => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const p = window.__cv.getPos();
      return am.getActiveMap().zoneLabel(p.x, p.z);
    });
    run.check(`h${n}: HUD "${n}번 집 · 2층"`, label === `${n}번 집 · 2층`, label);
    await shot(`${tag}-2-arrival.png`);
    const d2 = await discsNear([P.downPad]);
    run.check(`h${n}: no disc on the floor at the stair (floor 2)`, d2.length === 0, d2);
    await sleep(1100);
    await goto(P.downPad.x, P.downPad.z, 0.3);
    const t2 = await targets(p);
    run.check(`h${n}: floor 2: the down button is offered at the landing`, t2.some((x) => x.id === "house_stair:down"), t2.slice(0, 3));
    await act();
    const down = await waitArea(`house:house_${n}:1`, 12000);
    await coverGone();
    const a1 = await pos(p);
    run.check(`h${n}: down again: at the foot of the stair`, down && Math.hypot(a1.x - P.spawnDown.x, a1.z - P.spawnDown.z) < 0.6, { a1, want: P.spawnDown });
    await sleep(1100);
    // and up once more (the button) for floor 2's sweep
    await goto(P.upPad.x, P.upPad.z, 0.3);
    await act();
    await waitArea(`house:house_${n}:2`, 12000);
    await coverGone();
  });

  if ((await areaOf()) === `house:house_${n}:2`) {
    await run.step(`house ${n}: floor 2 rooms`, async () => floorShots(2));
    await run.step(`house ${n}: floor 2 seats`, async () => seatSweep(2));
    await run.step(`house ${n}: down`, async () => {
      await goto(P.downPad.x, P.downPad.z, 0.3);
      await sleep(1100);
      await act();
      run.check(`h${n}: down to floor 1`, await waitArea(`house:house_${n}:1`, 12000), await areaOf());
      await coverGone();
    });
  }

  await run.step(`house ${n}: the way out`, async () => {
    if ((await areaOf()) === `house:house_${n}:2`) return;
    const at = await goto(P.exitPad.x + 0, P.exitPad.z - 1.4, 0.5);
    await orbit(Math.PI, 0.7); // the camera behind, looking down at the boards by the front door
    await shot(`${tag}-exit-pad.png`);
    await goto(P.exitPad.x, P.exitPad.z, 0.3);
    const t = await targets(p);
    run.check(`h${n}: the way-out button is offered`, t.some((x) => x.id === "house_exit"), { at, t: t.slice(0, 3) });
    await act();
    const out = await waitArea("village", 12000);
    await coverGone();
    const a = await pos(p);
    run.check(`h${n}: back on the porch, at the door`, out && Math.hypot(a.x - kp.exit.x, a.z - kp.exit.z) < 0.8, { a, want: kp.exit });
    await sleep(1200);
  });
}

writeFileSync(join(run.evidence, "houses-report.json"), JSON.stringify(report, null, 1));
await browser.close();
process.exit(run.finish());
