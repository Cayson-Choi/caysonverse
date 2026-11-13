/**
 * e2e/camera-keep.mjs — 카메라가 저절로 바뀌지 않는지 (발주자 2026-11-10: "마우스 스크롤로 특정 카메라로 세팅하면 그 상태를 유지").
 *
 * 케이슨 마을에서 휠로 줌을, 끌기로 기울기를 정한 뒤 광장을 걷고·뛰고·멈추고·돌고, 추모관 문으로 들어갔다 나오면서
 * 일정 간격으로 화면을 찍고 카메라와 머리 사이 거리를 잰다. 그다음 새로 고침해서 줌·기울기가 그대로인지,
 * 저장값이 망가져 있어도 화면이 뜨는지(기본값) 본다.
 *
 *   npm run dev   (다른 창에서; 포트를 바꿨으면 CV_CLIENT_URL)
 *   node e2e/camera-keep.mjs [--out=<폴더>]
 *
 * 남기는 것(폴더): NN-*.png, camera-keep.json(표본 전부), assertions-camera-keep.json.
 */

import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { CLIENT_URL, DESKTOP, REPO, createRun, entryReady, openPlayer, press, sleep, walkAndWait, walkTo, waitIdle } from "./lib/common.mjs";

const run = createRun("camera-keep");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "camera-keep"));
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });

const NOON = "2026-11-03T12:30";
const HEAD = 1.4; // HEAD_HEIGHT (client/src/game/constants.ts): the camera's distance is measured from the head
const ZOOM = 10; // the zoom this run sets with the wheel (default 6)
const TILT = 0.55; // and the tilt it sets with a drag (default 0.35)
const r3 = (n) => Math.round(n * 1000) / 1000;

/** The real Chrome (channel "chrome"), with the GPU like the other e2e scripts. */
async function launchChrome() {
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  return chromium.launch({ headless: true, channel: "chrome", args: gpu });
}

let nickSeq = 0;
/** Fill the nickname on the entry screen that is up, press 입장하기, wait for the village scene. */
async function enter(p) {
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`캠${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvCamera, null, { timeout: 30000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);
}

const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

/** The live camera against the player: the orbit (the player's choice) and the drawn camera's distance from the head. */
const sample = (p, label) =>
  p.page.evaluate(
    ([label, head]) => {
      const c = window.__cvCamera();
      const at = window.__cv.getPos();
      const o = window.__cv.getOrbit();
      let stored = null;
      try {
        stored = localStorage.getItem("cv-camera-v1");
      } catch {}
      return {
        label,
        t: Math.round(performance.now()),
        orbit: o,
        pos: { x: at.x, z: at.z, yaw: at.yaw },
        camera: { x: c.x, y: c.y, z: c.z, mode: c.mode },
        armDistance: Math.hypot(c.x - at.x, c.y - head, c.z - at.z),
        stored,
      };
    },
    [label, HEAD],
  );

const samples = [];
let shotNo = 0;
async function snap(p, label) {
  const s = await sample(p, label);
  samples.push(s);
  const file = `${String(++shotNo).padStart(2, "0")}-${label}.png`;
  await run.shot(p, file);
  console.log(`   ${file}  orbit d=${r3(s.orbit.distance)} pitch=${r3(s.orbit.pitch)} yaw=${r3(s.orbit.yaw)}  arm=${r3(s.armDistance)}`);
  return s;
}

/**
 * Click-move to (x, z) while sampling the camera every ~150 ms (the walk itself, not only where it ends); one screenshot
 * is taken on the way, ~0.7 s in, so the evidence shows the camera while the avatar is moving too.
 */
async function walkSampling(p, x, z, label, { run: running = false } = {}) {
  if (running) await p.page.keyboard.down("Shift");
  await walkTo(p, x, z);
  const t0 = Date.now();
  const got = [];
  let shotOnTheWay = false;
  await sleep(200);
  while (Date.now() - t0 < 30000) {
    const s = await sample(p, label);
    got.push(s);
    if ((await p.page.evaluate(() => window.__cvClickTarget())) === null) break;
    if (!shotOnTheWay && Date.now() - t0 > 700) {
      shotOnTheWay = true;
      const moving = await snap(p, `${label}-moving`);
      samples.pop(); // counted below with the rest of this walk
      got.push(moving);
    }
    await sleep(150);
  }
  if (running) await p.page.keyboard.up("Shift");
  samples.push(...got);
  return got;
}

/** Zoom with the wheel (one notch = 100 units = 1 m) until the orbit is at `distance`. */
async function wheelTo(p, distance) {
  const vp = p.page.viewportSize();
  await p.page.mouse.move(vp.width / 2, vp.height / 2);
  for (let k = 0; k < 20; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.abs(o.distance - distance) < 1e-6) break;
    await p.page.mouse.wheel(0, Math.max(-100, Math.min(100, (distance - o.distance) * 100)));
    await sleep(120);
  }
  await sleep(800);
}

/** Tilt with vertical drags until the orbit pitch is about `pitch` (a drag up the screen raises it). */
async function dragTiltTo(p, pitch) {
  const vp = p.page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  for (let k = 0; k < 10; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const diff = pitch - o.pitch;
    if (Math.abs(diff) < 0.03) break;
    const dy = Math.max(-200, Math.min(200, -diff * 200));
    await p.page.mouse.move(cx, cy);
    await p.page.mouse.down();
    for (let s = 1; s <= 10; s++) await p.page.mouse.move(cx, cy + (dy * s) / 10);
    await p.page.mouse.up();
    await sleep(250);
    const after = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.sign(after.pitch - o.pitch) !== Math.sign(diff) && Math.abs(after.pitch - o.pitch) > 0.01) {
      // the drag sign is the other way round on this build: undo and go the other way
      await p.page.mouse.move(cx, cy);
      await p.page.mouse.down();
      for (let s = 1; s <= 10; s++) await p.page.mouse.move(cx, cy - (2 * dy * s) / 10);
      await p.page.mouse.up();
      await sleep(250);
    }
  }
  await sleep(600);
}

const same = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps;

const browser = await launchChrome();
let chosen = null;
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP });

  await run.step("1. join the village; set the zoom with the wheel and the tilt with a drag", async () => {
    await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded" });
    await enter(A);
    const first = await snap(A, "village-start-default");
    run.check("a first visit starts at the default zoom (6 m)", same(first.orbit.distance, 6), first.orbit);
    await wheelTo(A, ZOOM);
    await dragTiltTo(A, TILT);
    const set = await snap(A, "village-zoom-set");
    chosen = { ...set.orbit };
    run.check(`the wheel set the zoom to ${ZOOM} m`, same(set.orbit.distance, ZOOM, 1e-6), set.orbit);
    run.check("the drag set the tilt", Math.abs(set.orbit.pitch - TILT) < 0.05, set.orbit);
    run.check("the drawn camera sits at the chosen distance from the head", Math.abs(set.armDistance - ZOOM) < 0.02, r3(set.armDistance));
    run.check("the choice is stored (cv-camera-v1)", !!set.stored && same(JSON.parse(set.stored).distance, chosen.distance, 1e-9), set.stored);
  });

  await run.step("2. walk, run, stop and turn on the plaza: the distance never changes", async () => {
    // The west half of the plaza: the camera (10 m behind, to the south) stays out of the cherry trees' crowns there.
    const legs = [
      { to: [-8, 10], label: "walk-west", running: false },
      { to: [-8, -6], label: "run-north", running: true },
      { to: [-8, 10], label: "walk-back-south", running: false },
      { to: [0, 12], label: "run-east", running: true },
    ];
    const all = [];
    for (const leg of legs) {
      const got = await walkSampling(A, leg.to[0], leg.to[1], leg.label, { run: leg.running });
      all.push(...got);
      await snap(A, `plaza-${leg.label}-stopped`);
      await sleep(700); // standing still: nothing may settle or drift
      all.push(await sample(A, `${leg.label}-after-stop`));
    }
    const arms = all.map((s) => s.armDistance);
    const spread = Math.max(...arms) - Math.min(...arms);
    run.check(`${all.length} samples while moving: camera-to-head distance stays ${ZOOM} m (spread < 2 cm)`, spread < 0.02, {
      min: r3(Math.min(...arms)),
      max: r3(Math.max(...arms)),
    });
    run.check(
      "the orbit (zoom, tilt, yaw) is exactly the player's choice in every sample",
      all.every((s) => same(s.orbit.distance, chosen.distance) && same(s.orbit.pitch, chosen.pitch) && same(s.orbit.yaw, chosen.yaw)),
      all.find((s) => !same(s.orbit.distance, chosen.distance) || !same(s.orbit.pitch, chosen.pitch) || !same(s.orbit.yaw, chosen.yaw))?.orbit ?? "all equal",
    );
  });

  await run.step("3. through the memorial's door and back out: no swing, no tilt reset, no zoom change", async () => {
    for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await walkAndWait(A, x, z, 40000, 1.2);
    const before = await snap(A, "memorial-door-outside");
    await A.page.keyboard.press("KeyE");
    await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
    await A.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 }).catch(() => {});
    await sleep(2500);
    const inside = await snap(A, "hall-inside-arrival");
    run.check("in the hall", (await areaOf(A)) === "hall");
    run.check(
      "the orbit came through the door unchanged (yaw, tilt and zoom)",
      same(inside.orbit.yaw, before.orbit.yaw) && same(inside.orbit.pitch, before.orbit.pitch) && same(inside.orbit.distance, before.orbit.distance),
      { before: before.orbit, inside: inside.orbit },
    );
    run.check("inside, the camera is under the ceiling (y <= 3.0)", inside.camera.y <= 3.01, r3(inside.camera.y));
    const walkIn = await walkSampling(A, 300, -1.5, "hall-walk");
    await snap(A, "hall-inside-walked");
    run.check(
      "walking in the hall never changes the orbit (walls only shape the drawn camera)",
      walkIn.every((s) => same(s.orbit.distance, chosen.distance) && same(s.orbit.pitch, chosen.pitch)),
      walkIn.map((s) => r3(s.armDistance)),
    );
    // Out again: back to the door pad, E.
    for (const [x, z] of [[300, 1.5], [300, 4.6]]) await walkAndWait(A, x, z, 15000, 0.5);
    await sleep(300);
    await A.page.keyboard.press("KeyE");
    await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "village", null, { timeout: 15000 });
    await sleep(2500);
    const out = await snap(A, "village-after-hall");
    run.check(
      "outside again: the same yaw, tilt and zoom",
      same(out.orbit.yaw, before.orbit.yaw) && same(out.orbit.pitch, before.orbit.pitch) && same(out.orbit.distance, before.orbit.distance),
      { before: before.orbit, after: out.orbit },
    );
    // Clear of the memorial's walls the drawn camera is exactly at the chosen distance again.
    await walkAndWait(A, 0, -30, 30000, 1.0);
    await sleep(1500);
    const clear = await snap(A, "village-lane-clear");
    run.check(`clear of the walls the camera is back at exactly ${ZOOM} m`, Math.abs(clear.armDistance - ZOOM) < 0.02, r3(clear.armDistance));
  });

  await run.step("4. reload: the zoom and the tilt are kept", async () => {
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await enter(A);
    const after = await snap(A, "village-after-reload");
    run.check("after the reload the zoom is the one the wheel set", same(after.orbit.distance, chosen.distance), after.orbit);
    run.check("after the reload the tilt is the one the drag set", same(after.orbit.pitch, chosen.pitch), after.orbit);
    run.check("and the drawn camera is at that distance from the head", Math.abs(after.armDistance - ZOOM) < 0.02, r3(after.armDistance));
  });

  await run.step("5. a broken stored value: the scene still comes up, at the default zoom", async () => {
    await A.page.evaluate(() => localStorage.setItem("cv-camera-v1", "{not json"));
    await A.page.reload({ waitUntil: "domcontentloaded" });
    await enter(A);
    const s = await snap(A, "village-broken-storage");
    run.check("broken storage falls back to the default zoom and tilt", same(s.orbit.distance, 6) && same(s.orbit.pitch, 0.35), s.orbit);
  });
} finally {
  writeFileSync(join(OUT, "camera-keep.json"), JSON.stringify({ zoom: ZOOM, tilt: TILT, chosen, samples }, null, 2));
  const code = run.finish({ chosen });
  await browser.close();
  process.exit(code);
}
