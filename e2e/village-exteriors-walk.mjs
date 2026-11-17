/**
 * e2e/village-exteriors-walk.mjs — 집 외관 A8 X3 in the real game, walking: up a porch's steps (the picture lift on the avatar, its
 * shadow and the camera), first-person 1 m close-ups of a wall, a window and the door, a tap on the porch bench (walks there, does
 * not sit) then "앉기" / E (sits at 0.75), in through the keypad (1004) and out again, the B4 click ray (house 8's front from beside
 * house 4), the follow camera round a porch (never inside a house), and the frame numbers (draw calls, triangles, frame time).
 *
 *   server:  PORT=3100 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3100 npx vite --port 5700 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5700 node e2e/village-exteriors-walk.mjs [--phone] [--time=12:30] [--house=2] [--out=<dir>]
 *
 * Until X2's porches are in village_houses.glb the porches do not lift (houseLift.ts: only a drawn porch lifts); the lift's numbers
 * are then checked with every porch switched on by the DEV hook (the shots of that part are labelled "lift-mechanics").
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const phone = args.includes("--phone");
const TIME = opt("time", "12:30");
const N = Number(opt("house", "2"));
const run = createRun(`village-exteriors-walk${phone ? "-phone" : ""}`);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const tag = `${phone ? "phone" : "pc"}-${TIME.replace(":", "")}-h${N}`;
const device = phone ? PHONE : DESKTOP;

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device, settings: { graphics: phone ? "low" : "high" } });
const page = p.page;
const report = {};
const shot = (f) => run.shot(p, `${tag}-${f}`);
const imp = (m) => `/src/village/houses/${m}`;

const me = () => page.evaluate(() => window.__cv.getPos());
const idle = async (ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__cvClickTarget())) === null) return true;
    await sleep(120);
  }
  return false;
};
async function goto(x, z, tol = 0.4) {
  for (let i = 0; i < 4; i++) {
    await page.evaluate(async ([x, z]) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const cm = await window.__imp("/src/game/clickMove.ts");
      const map = am.getActiveMap();
      const m = window.__cv.getPos();
      const b = map.bounds ?? map.geometry.bounds;
      const via = cp.findDetour(m.x, m.z, x, z, map.geometry.obstacles, b, undefined, { ratio: 4, slack: 30, margin: 40 });
      cm.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(300);
    await idle();
    await sleep(250);
    const at = await me();
    if (Math.hypot(at.x - x, at.z - z) <= tol) return at;
  }
  return me();
}
const camPos = () => page.evaluate(() => window.__cvThree().camera.position.toArray());
const toScreen = (x, y, z) =>
  page.evaluate(([x, y, z]) => {
    const t = window.__cvThree();
    const cam = t.camera;
    cam.updateMatrixWorld();
    const v = new cam.position.constructor(x, y, z).project(cam);
    if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return null;
    const r = t.gl.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }, [x, y, z]);
const tapAt = (s) => (phone ? page.touchscreen.tap(s.x, s.y) : page.mouse.click(s.x, s.y));
async function orbit(yaw, pitch, distance) {
  await page.evaluate(
    async ([yaw, pitch, distance]) => {
      const vs = await window.__imp("/src/game/viewState.ts");
      if (vs.viewState.mode === "fp") vs.exitFp(window.__cv.getOrbit());
      const o = window.__cv.getOrbit();
      if (distance) o.distance = distance;
      vs.viewState.orbitGoal = { yaw, pitch: pitch ?? o.pitch };
    },
    [yaw, pitch, distance ?? null],
  );
  await sleep(1300);
}
async function fpLook(x, y, z) {
  await page.evaluate(async ([x, y, z]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    if (vs.viewState.mode !== "fp") vs.enterFp(0);
    const m = window.__cv.getPos();
    vs.viewState.fpYaw = -Math.atan2(x - m.x, -(z - m.z));
    const c = window.__cvThree().camera.position;
    vs.viewState.fpPitch = -Math.atan2(y - c.y, Math.hypot(x - m.x, z - m.z));
  }, [x, y, z]);
  await page.waitForFunction(() => window.__cv.getView().blend >= 0.995, null, { timeout: 15000 }).catch(() => {});
  await sleep(900);
  await page.evaluate(async ([x, y, z]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    const c = window.__cvThree().camera.position;
    vs.viewState.fpPitch = -Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
  }, [x, y, z]);
  await sleep(900);
}
const leaveFp = () =>
  page.evaluate(async () => {
    const vs = await window.__imp("/src/game/viewState.ts");
    if (vs.viewState.mode === "fp") vs.exitFp(window.__cv.getOrbit());
  });
const hideHud = () =>
  page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    for (const el of document.body.querySelectorAll("*")) if (!keep.has(el) && !canvas.contains(el) && !el.closest(".cv-keypad,.cv-action-btn,.cv-actions")) el.style.visibility = "hidden";
  });
const showHud = () => page.evaluate(() => document.querySelectorAll("[style*='visibility']").forEach((el) => (el.style.visibility = "")));
const act = async () => {
  if (phone) await press(p, page.locator(".cv-action-btn").first());
  else await page.keyboard.press("KeyE");
};
const areaOf = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

let H, L, slots;
try {
  await run.step("join", async () => {
    await page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`2026-11-16T${TIME}`)}`, { waitUntil: "domcontentloaded" });
    await entryReady(p);
    await page.locator("input.cv-input").first().fill(`걷기${N}`);
    await press(p, page.locator(".cv-submit"));
    await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
    await page.waitForFunction(() => !!window.__cvVillage && window.__cvHouses?.()?.ready === true, null, { timeout: 120000 });
    await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const info = await page.evaluate(() => window.__cvHouses());
    report.houses = info;
    run.check("the houses' model is drawn, the old houses cut out", info.ready && info.cut && info.cut.trianglesRemoved > 10000, info.cut);
    run.check("shells merged: <= 8 draws", info.stats.shellDraws <= 8, info.stats.shellDraws);
    run.check("detail <= 6 draws a house", Object.values(info.stats.detailDraws).every((d) => d <= 6), info.stats.detailDraws);
    const geo = await page.evaluate(async (n) => {
      const L = await window.__imp("/shared/src/village/villageLayout.ts");
      const X = await window.__imp("/shared/src/village/houseExterior.ts");
      const h = L.VILLAGE_LAYOUT.sceneryHouses.find((x) => x.id === `house_${n}`);
      return { h, seat: X.housePorchSeatMarker(h), slots: X.houseSlots(h), front: X.HOUSE_BODY_FRONT, edge: X.HOUSE_Z_EDGE };
    }, N);
    H = geo.h;
    slots = geo.slots;
    report.seatMarker = geo.seat;
    L = (lx, lz) => {
      const { x: cx, z: cz } = H.centre;
      switch (H.doorSide) {
        case "s": return { x: cx + lx, z: cz + lz };
        case "n": return { x: cx - lx, z: cz - lz };
        case "e": return { x: cx + lz, z: cz - lx };
        case "w": return { x: cx - lz, z: cz + lx };
      }
    };
  });

  await run.step("up the steps: the picture lift (avatar, shadow, camera)", async () => {
    const drawn = report.houses.porches.includes(`house_${N}`);
    if (!drawn) await page.evaluate(async ([m, ids]) => (await window.__imp(m)).setPorchesDrawn(ids), [imp("houseLift.ts"), Array.from({ length: 10 }, (_, i) => `house_${i + 1}`)]);
    report.liftMode = drawn ? "porch in the model" : "lift-mechanics (no porch in the model yet: forced by the DEV hook)";
    const lawn = L(0, 5.375 + 2.2);
    await goto(lawn.x, lawn.z, 0.5);
    await orbit(Math.atan2(-(L(0, 0).x - lawn.x), -(L(0, 0).z - lawn.z)) + 0.6, 0.32, 5);
    const pad = L(0, 3.775);
    const samples = [];
    await page.evaluate(async (pad) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(pad.x, pad.z), pad);
    const t0 = Date.now();
    while (Date.now() - t0 < 4500) {
      samples.push(
        await page.evaluate(async (m) => {
          const lift = (await window.__imp(m)).getLocalStepLift();
          const pos = window.__cv.getPos();
          const t = window.__cvThree();
          let avatarY = null;
          let shadowY = null;
          t.scene.traverse((o) => {
            if (o.userData?.clickPick === "ignore" && o.type === "Group" && Math.hypot(o.position.x - pos.x, o.position.z - pos.z) < 0.05) {
              avatarY = o.position.y;
              o.traverse((c) => {
                if (shadowY === null && c.isMesh && Math.abs(c.rotation.x + Math.PI / 2) < 1e-3) shadowY = +c.getWorldPosition(new t.camera.position.constructor()).y.toFixed(3);
              });
            }
          });
          return { x: +pos.x.toFixed(2), z: +pos.z.toFixed(2), lift: +lift.toFixed(3), avatarY, shadowY, camY: +t.camera.position.y.toFixed(2) };
        }, imp("houseLift.ts")),
      );
      await sleep(90);
    }
    await idle();
    report.stepSamples = samples;
    const lifts = samples.map((s) => s.lift);
    const end = samples[samples.length - 1];
    run.check("the lift passes 0.1 and 0.2 on the treads and ends at 0.30 on the porch", lifts.some((v) => v > 0.05 && v < 0.15) && lifts.some((v) => v > 0.15 && v < 0.25) && Math.abs(end.lift - 0.3) < 0.005, lifts.join(","));
    const first = lifts.findIndex((v) => v > 0.001);
    const top = lifts.findIndex((v) => v >= 0.29);
    run.check("no snap: from the first tread to the porch the lift rises over at least four samples (~0.4 s, eased)", first >= 0 && top - first >= 4, { first, top });
    run.check("the avatar's group stands at the lift on the porch", end.avatarY !== null && Math.abs(end.avatarY - end.lift) < 0.01, end);
    await hideHud();
    await shot(`steps-${drawn ? "porch" : "lift-mechanics"}.png`);
    await showHud();
  });

  await run.step("first-person 1 m close-ups: wall, window, door", async () => {
    const ZF = 3.125;
    for (const [name, at, look] of [
      ["wall", [-1.75, ZF + 1.0], [-1.75, 1.3, ZF]],
      ["window", [2.6, ZF + 1.05], [3.3, 1.75, ZF]],
      ["door", [0.55, ZF + 1.15], [0.25, 1.6, ZF]],
      ["nameplate", [1.2, ZF + 0.9], [1.45, 1.9, ZF]],
    ]) {
      const a = L(at[0], at[1]);
      const pos = await goto(a.x, a.z, 0.3);
      const t = L(look[0], look[2]);
      await fpLook(t.x, look[1], t.z);
      await hideHud();
      await shot(`fp-${name}.png`);
      await showHud();
      report[`fp-${name}`] = { pos, cam: await camPos() };
    }
    await leaveFp();
    await sleep(800);
  });

  if (report.seatMarker) {
    await run.step("porch bench: a tap walks there and does not sit; 앉기 sits at 0.75", async () => {
      const s = report.seatMarker;
      const front = L(-2.8, 3.125 + 1.6);
      await goto(front.x, front.z, 0.4);
      await orbit(Math.atan2(-(s.x - front.x), -(s.z - front.z)) + Math.PI, 0.45, 4.5);
      // tap the bench's seat from where the camera is
      let scr = await toScreen(s.x, 0.6, s.z);
      if (!scr) {
        await orbit(Math.atan2(-(s.x - front.x), -(s.z - front.z)), 0.5, 4.5);
        scr = await toScreen(s.x, 0.6, s.z);
      }
      run.check("the bench is on screen", !!scr, scr);
      if (!scr) return;
      await tapAt(scr);
      await sleep(400);
      await idle();
      await sleep(1800);
      const after = await me();
      run.check("the tap walked, it did not sit (owner 2026-11-17)", after.seatIndex < 0, after);
      const offered = await page.evaluate(async () => {
        const m = await window.__imp("/src/game/interactTargets.ts");
        return m.getTargets(window.__cv.getPos()).map((t) => t.id);
      });
      report.benchOffered = offered;
      await act();
      await sleep(2600);
      const seated = await me();
      run.check("앉기 / E sits on the porch bench", seated.seatIndex >= 0, seated);
      const seat = await page.evaluate(async (i) => {
        const am = await window.__imp("/src/game/activeMap.ts");
        const seats = am.getActiveMap().seats ?? am.activeSeats();
        const s = seats[i];
        return s ? { id: s.id, bench: s.bench, seatY: s.seatY } : null;
      }, seated.seatIndex);
      report.benchSeat = seat;
      run.check("the seat is the porch bench, seat top 0.75 (id unchanged)", seat && seat.bench === `house_${N}_porch` && Math.abs(seat.seatY - 0.75) < 1e-6, seat);
      await hideHud();
      await shot("bench-seated.png");
      await showHud();
      if (phone) await press(p, page.locator(".cv-action-btn").first()).catch(() => {});
      else await page.keyboard.press("KeyE");
      await sleep(2500);
    });
  }

  await run.step("in through the keypad (1004) and out again", async () => {
    const kp = await page.evaluate(async (id) => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntryOf(id), `house_${N}`);
    await goto(kp.pad.x, kp.pad.z, 0.5);
    await act();
    const open = await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 }).then(() => true, () => false);
    run.check("the keypad opens at the A8 door", open);
    if (!open) return;
    for (const c of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${c}"]`));
    await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
    const t0 = Date.now();
    let area = await areaOf();
    while (Date.now() - t0 < 20000 && area === "village") {
      await sleep(200);
      area = await areaOf();
    }
    run.check("1004 -> inside the house", area === `house:house_${N}:1`, area);
    await page.waitForFunction(() => { const c = document.querySelector(".cv-house-cover"); return !c || getComputedStyle(c).opacity === "0"; }, null, { timeout: 15000 }).catch(() => {});
    await sleep(800);
    await shot("inside.png");
    const exit = await page.evaluate(async (n) => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES[n].exitPad, N);
    await goto(exit.x, exit.z, 0.5);
    await act();
    const t1 = Date.now();
    while (Date.now() - t1 < 15000 && (await areaOf()) !== "village") await sleep(200);
    await sleep(1500);
    const out = await me();
    run.check("out again: on the porch in front of the door", (await areaOf()) === "village" && Math.hypot(out.x - kp.exit.x, out.z - kp.exit.z) < 0.6, { out, exit: kp.exit });
    const lift = await page.evaluate(async (m) => (await window.__imp(m)).getLocalStepLift(), imp("houseLift.ts"));
    report.exitLift = lift;
    await shot("out-on-porch.png");
  });

  await run.step("the follow camera round the porch never enters a house", async () => {
    const pad = L(-1.0, 4.4);
    await goto(pad.x, pad.z, 0.4);
    const bad = [];
    const cams = [];
    for (let k = 0; k < 8; k++)
      for (const pitch of [0.12, 0.45, 0.9]) {
        await orbit((k * Math.PI) / 4, pitch, 5);
        const c = await camPos();
        cams.push(c.map((v) => +v.toFixed(2)));
        const inside = await page.evaluate(async ([x, y, z]) => {
          const L = await window.__imp("/shared/src/village/villageLayout.ts");
          const X = await window.__imp("/shared/src/village/houseExterior.ts");
          return L.VILLAGE_LAYOUT.sceneryHouses
            .filter((h) => h.kind === "house")
            .filter((h) => {
              const b = X.houseSolidBox(h);
              return x > b.minX - 0.05 && x < b.maxX + 0.05 && z > b.minZ - 0.05 && z < b.maxZ + 0.05 && y < 12;
            })
            .map((h) => h.id);
        }, c);
        if (inside.length) bad.push({ yaw: k, pitch, c, inside });
      }
    report.cameraSweep = cams;
    run.check("24 orbit poses: the camera is never inside a house body (+5 cm)", bad.length === 0, bad);
  });

  await run.step("B4: a tap on house 8's lawn from beside house 4 lands there (the click ray)", async () => {
    const from = { x: -36.0, z: 30.5 };
    await goto(from.x, from.z, 0.8);
    const targetsB4 = [{ x: -40, z: 41 }, { x: -43.0, z: 40.6 }];
    report.b4 = [];
    for (const t of targetsB4) {
      await orbit(Math.atan2(-(t.x - from.x), -(t.z - from.z)), 0.42, 6);
      const scr = await toScreen(t.x, 0.02, t.z);
      if (!scr) {
        run.check(`B4 (${t.x}, ${t.z}) on screen`, false);
        continue;
      }
      await tapAt(scr);
      await sleep(300);
      const target = await page.evaluate(() => window.__cvClickTarget());
      const pick = await page.evaluate(() => window.__cvClickPick?.());
      report.b4.push({ t, target, pick: pick && { x: pick.x, y: pick.y, z: pick.z, name: pick.name } });
      run.check(`B4 tap (${t.x}, ${t.z}): the ring is where tapped (not on house 4's porch)`, target && Math.hypot(target.x - t.x, target.z - t.z) < 0.8, { target, pick: pick?.name });
      await idle();
      await goto(from.x, from.z, 0.8);
    }
  });

  await run.step("frame numbers at the house and on the plaza", async () => {
    for (const [name, at] of [["house", L(0, 5.375 + 6)], ["plaza", { x: 0, z: 14 }]]) {
      await goto(at.x, at.z, 1.2);
      await orbit(0.5, 0.35, 8);
      await sleep(2500);
      // every pass of one frame (the scene, its shadow maps, the composer's): three resets its counters per render call, so
      // they are summed by hand over one whole frame
      const info = [];
      for (let i = 0; i < 6; i++) {
        info.push(
          await page.evaluate(
            () =>
              new Promise((res) => {
                const gl = window.__cvThree().gl;
                requestAnimationFrame(() => {
                  gl.info.autoReset = false;
                  gl.info.reset();
                  requestAnimationFrame(() => {
                    const r = { calls: gl.info.render.calls, triangles: gl.info.render.triangles };
                    gl.info.autoReset = true;
                    res(r);
                  });
                });
              }),
          ),
        );
        await sleep(250);
      }
      const fr = await page.evaluate(() => window.__cv.getFrameStats(4000));
      const h = await page.evaluate(() => window.__cvHouses());
      const calls = info.filter(Boolean).map((x) => x.calls);
      const tris = info.filter(Boolean).map((x) => x.triangles);
      report[`frame-${name}`] = { callsMax: Math.max(...calls), trisMax: Math.max(...tris), meanMs: fr.meanMs, p95Ms: fr.p95Ms, fps: +(1000 / fr.meanMs).toFixed(1), detail: h.detail };
      console.log(`   ${name}: ${JSON.stringify(report[`frame-${name}`])}`);
    }
  });
} finally {
  writeFileSync(join(run.evidence, `${tag}-report.json`), JSON.stringify(report, null, 1));
  await browser.close();
  process.exitCode = run.finish(report);
}
