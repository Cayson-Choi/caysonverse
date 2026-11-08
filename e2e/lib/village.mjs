// Shared helpers of the 케이슨 마을 E2E scripts (Task 11): e2e/village-desktop.mjs and e2e/village-mobile.mjs run the same
// scenario (runVillageScenario below), one with a mouse + keyboard, one with a phone (touch, taps on the action button).
// Plain Playwright against the dev stack (`npm run dev`: client :5173, server :2567), on top of e2e/lib/escape.mjs.
//
// Page code reaches the app's modules through `window.__imp(path)` (see escape.mjs openPlayer).

import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, layoutReport, openPlayer, press, pos, sleep, touchDown, touchMoveTo, touchUp, turnCameraTo, visibleButtons, waitIdle, walkAndWait, walkTo } from "./escape.mjs";

/** The pinned noon the other village scripts use (so the day/night look is the same every run). */
export const NOON = "2026-11-03T12:30";
/** The memorial's door, outside: the walk from the plaza (waypoints around the plaza and the lane north). */
export const DOOR_ROUTE = [[-20, 5], [-14, -20], [0, -33], [0, -50.8]];

const area = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
export const areaOf = area;
export const screenOf = (p) => p.page.evaluate(() => window.__cv?.getScreen?.());

/** The action: E on a PC, a tap on the round action button on a phone. */
export async function act(p) {
  if (p.touch) {
    const btn = p.page.locator(".cv-action-btn");
    await btn.waitFor({ state: "visible", timeout: 5000 });
    await btn.tap();
  } else {
    await p.page.keyboard.press("KeyE");
  }
}

let nickSeq = 0;
/** Entry screen -> nickname -> 입장하기 -> the village scene is up. Returns what the entry screen showed after the press. */
export async function joinVillage(p, prefix, time = NOON) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  const nick = `${prefix}${++nickSeq}${Math.floor(Math.random() * 90 + 10)}`.slice(0, 10);
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  const sheet = await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 }).then(
    () => p.page.evaluate(() => ({ dialogOpen: !!document.querySelector("dialog[open]"), asks: document.body.textContent.includes("어디로 갈까요") })),
  );
  await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm && !!window.__cvGuideVoice, null, { timeout: 30000 });
  await sleep(1500);
  p.nick = nick;
  return { nick, sheet };
}

/** From the plaza to the memorial's door, then the action: the curtain closes, the hall loads and the player is inside. */
export async function enterHall(p) {
  for (const [x, z] of DOOR_ROUTE) await walkAndWait(p, x, z, 40000, 1.2);
  await act(p);
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
  await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
  await sleep(2500);
}

/** Inside the hall, at the arrival point, the way out: the action at the door pad, then wait for the village. */
export async function leaveHall(p) {
  // the way the visitor came (round the bench, then down the arrival's line x = 300): a straight line from the cubby wall would catch a collider
  if ((await pos(p)).z < 1.5) for (const [x, z] of [[302.6, -3.6], [302.6, 0.5], [300, 1.5]]) await walkAndWait(p, x, z, 15000, 0.6);
  await walkAndWait(p, 300, 4.6, 15000, 0.5); // on the door pad (centre (300, 5.2), r 1.4), out of the desk guide's reach (2.2 m)
  await sleep(300);
  await act(p);
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "village", null, { timeout: 15000 });
  await sleep(1500);
}

/** Drag the follow camera: a mouse on a PC, one finger (CDP touch) on a phone. dy > 0 moves down the screen. */
export async function dragView(p, dx, dy) {
  const vp = p.page.viewportSize();
  const x0 = p.touch ? vp.width * 0.78 : vp.width / 2;
  const y0 = vp.height * (p.touch ? 0.38 : 0.5);
  const steps = 8;
  if (p.touch) {
    await touchDown(p, x0, y0);
    for (let s = 1; s <= steps; s++) await touchMoveTo(p, x0 + (dx * s) / steps, y0 + (dy * s) / steps);
    await touchUp(p);
  } else {
    await p.page.mouse.move(x0, y0);
    await p.page.mouse.down();
    for (let s = 1; s <= steps; s++) await p.page.mouse.move(x0 + (dx * s) / steps, y0 + (dy * s) / steps);
    await p.page.mouse.up();
  }
  await sleep(300);
}

/** Pitch (vertical drag) and, on a PC, distance (wheel) of the follow camera until the orbit is about there. */
export async function setOrbit(p, distance, pitch) {
  if (!p.touch && distance !== null) {
    const vp = p.page.viewportSize();
    await p.page.mouse.move(vp.width / 2, vp.height / 2);
    for (let k = 0; k < 12; k++) {
      const o = await p.page.evaluate(() => window.__cv.getOrbit());
      if (Math.abs(o.distance - distance) < 0.6) break;
      await p.page.mouse.wheel(0, (distance - o.distance) * 100);
      await sleep(250);
    }
  }
  for (let k = 0; k < 12; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const diff = pitch - o.pitch;
    if (Math.abs(diff) < 0.05) break;
    // a drag up the screen (dy < 0) raises the pitch (the camera's DRAG_SIGN); about 0.5 rad per 100 px
    await dragView(p, 0, Math.max(-260, Math.min(260, -diff * 200)));
  }
  await sleep(1000);
}

export const hideHud = (p) =>
  p.page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    const keep = new Set();
    for (let e = canvas; e; e = e.parentElement) keep.add(e);
    window.__hidden = [];
    for (const el of document.body.querySelectorAll("*")) {
      if (keep.has(el) || canvas.contains(el)) continue;
      if (el.style.visibility !== "hidden") {
        window.__hidden.push(el);
        el.style.visibility = "hidden";
      }
    }
  });
export const showHud = (p) =>
  p.page.evaluate(() => {
    for (const el of window.__hidden ?? []) el.style.visibility = "";
  });

/** A guide's question button by index (the dialog must be open). */
export const question = (p, i) => p.page.locator(".cv-guide-questions button").nth(i);
/** The shared audio state of the voice clip and the music (see e2e/village-guides.mjs). */
export const audioState = (p) =>
  p.page.evaluate(() => {
    const v = window.__cvGuideVoice;
    const el = v?.element();
    const bgm = window.__cvBgm;
    const r = (n) => Math.round(n * 1000) / 1000;
    return {
      voice: v ? { ...v.state(), routed: v.isRouted(), level: r(v.level()), src: el ? el.src.replace(/^https?:\/\/[^/]+/, "") : null, paused: el ? el.paused : null } : null,
      music: bgm ? { level: r(bgm.level()), duck: r(bgm.duckLevel()), paused: bgm.element()?.paused ?? null } : null,
    };
  });

/**
 * The filled cubby the hall scenario visits: eye-level card (row 3, else 2/4), on the back wall east of the bench or on the east
 * wall, in a column that also has an empty row (step 9 visits it; T11 review minor 3).
 */
export const pickCubby = (p) =>
  p.page.evaluate(async () => {
    const s = await window.__imp("/src/village/sampleCubbies.ts");
    const t = await window.__imp("/src/village/villageTargets.ts");
    const c = await window.__imp("/src/village/cubbyCard.ts");
    const cols = t.cubbyColumns().filter((col) => (col.wall === "n" && col.x > 300.6 && col.x < 303.2) || (col.wall === "e" && col.z > -4.4 && col.z < 1.2));
    for (const want of [3, 2, 4]) {
      for (const column of cols) {
        const row = c.defaultRow(column.key);
        const a = column.rows[row];
        if (row !== want || !s.SAMPLE_BY_ID.has(a.id)) continue;
        if (!column.rows.some((r) => !s.SAMPLE_BY_ID.has(r.id))) continue;
        const fx = Math.sin(a.yaw);
        const fz = Math.cos(a.yaw);
        return { key: column.key, row, id: a.id, x: a.x, y: a.y, z: a.z, standX: a.x + fx * 0.85, standZ: a.z + fz * 0.85, sample: s.SAMPLE_BY_ID.get(a.id) };
      }
    }
    return null;
  });

/** Walk to the front of a picked cubby (round the bench first) and face it. */
export async function standAtCubby(p, pick) {
  await walkAndWait(p, 302.6, 0.5, 15000, 0.5);
  await walkAndWait(p, 302.6, -3.6, 15000, 0.5);
  const fx = (pick.standX - pick.x) / 0.85;
  const fz = (pick.standZ - pick.z) / 0.85;
  await walkAndWait(p, pick.x + fx * 1.6, pick.z + fz * 1.6, 15000, 0.4);
  await walkTo(p, pick.x + fx * 0.5, pick.z + fz * 0.5);
  await sleep(400);
  await waitIdle(p, 15000);
  await sleep(400);
  await turnCameraTo(p, pick.x + (pick.x - pick.standX) * 3, pick.z + (pick.z - pick.standZ) * 3);
  await sleep(600);
}

/** Share of the hall's ceiling (a 21 x 21 grid over the room, drawn at 3.4 m) that projects inside the picture, in front of the camera. */
export const ceilingShare = (p) =>
  p.page.evaluate(async () => {
    const { camera } = window.__cvThree();
    camera.updateMatrixWorld();
    const lay = await window.__imp("/village/villageLayout.ts");
    const room = lay.VILLAGE_LAYOUT.memorial.interior.room;
    let inFrame = 0;
    let total = 0;
    const probe = camera.position.clone();
    for (let i = 0; i <= 20; i++) {
      for (let j = 0; j <= 20; j++) {
        total += 1;
        const v = probe.set(room.minX + ((room.maxX - room.minX) * i) / 20, 3.4, room.minZ + ((room.maxZ - room.minZ) * j) / 20).project(camera);
        if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z > -1 && v.z < 1) inFrame += 1;
      }
    }
    return { y: camera.position.y, share: Math.round((inFrame / total) * 100) / 100 };
  });

/**
 * The hall's ceiling as a mesh (T11 review minor 1): rays straight up from three points of the room (above head height, so no
 * avatar is hit) must first meet a shown mesh 3.2..3.7 m up whose material shows its face from below (double-sided, or a front
 * face looking down).
 */
export const ceilingHits = (p) =>
  p.page.evaluate(async () => {
    const THREE = await window.__imp("/deps/three.js");
    const { scene } = window.__cvThree();
    const lay = await window.__imp("/village/villageLayout.ts");
    const room = lay.VILLAGE_LAYOUT.memorial.interior.room;
    const shown = (o) => {
      for (let e = o; e; e = e.parent) if (!e.visible) return false;
      return true;
    };
    const rc = new THREE.Raycaster();
    const out = [];
    for (const [fx, fz] of [[0.3, 0.35], [0.5, 0.55], [0.7, 0.4]]) {
      const x = room.minX + (room.maxX - room.minX) * fx;
      const z = room.minZ + (room.maxZ - room.minZ) * fz;
      rc.set(new THREE.Vector3(x, 2.6, z), new THREE.Vector3(0, 1, 0));
      const hit = rc.intersectObject(scene, true).find((h) => h.object.isMesh && shown(h.object) && !h.object.name.startsWith("col__"));
      if (!hit) {
        out.push({ x, z, hit: null });
        continue;
      }
      const mats = Array.isArray(hit.object.material) ? hit.object.material : [hit.object.material];
      const mat = mats[hit.face?.materialIndex ?? 0] ?? mats[0];
      const n = hit.face ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld) : new THREE.Vector3(0, -1, 0);
      const faceSeen = mat.side === THREE.DoubleSide || (mat.side === THREE.FrontSide && n.y < 0) || (mat.side === THREE.BackSide && n.y > 0);
      out.push({ x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10, y: Math.round(hit.point.y * 100) / 100, mesh: hit.object.name, material: mat.name, side: mat.side, faceSeen, ok: hit.point.y >= 3.2 && hit.point.y <= 3.7 && faceSeen && mat.visible !== false });
    }
    return out;
  });

/** A walk whose end matters: walk, then assert we got there (T11 review minor 5: walkAndWait itself never throws on a miss). */
export async function walkChecked(run, p, x, z, label, tol = 0.8, ms = 40000) {
  await walkAndWait(p, x, z, ms, tol);
  const at = await pos(p);
  run.check(`walked to ${label} (${x}, ${z})`, Math.hypot(at.x - x, at.z - z) <= tol * 2, at);
}

/** The visible buttons (scope = a selector, or the whole page) and the touch-layout verdict over them. */
export async function layoutOf(p, scope) {
  // visibleButtons marks every fully rounded corner as `round` (a circle); a pill (a wide button with round ends) is a box
  const els = (await visibleButtons(p, scope)).map((e) => ({ ...e, round: e.round && Math.abs(e.w - e.h) < 1 }));
  return { els, report: layoutReport(els, p.page.viewportSize()) };
}

/** Walk to 1.3 m south of the plaza guide (5, 12), going round it from the south (its collider keeps the player out), and face it. */
export async function standAtPlazaGuide(p) {
  for (const [x, z, tol] of [[0, 17, 1.5], [5, 17, 1.2], [5, 15.5, 0.8], [5, 13.7, 0.4]]) await walkAndWait(p, x, z, 30000, tol);
  await turnCameraTo(p, 5, 12);
  await sleep(600);
}

const r3 = (n) => Math.round(n * 1000) / 1000;

/**
 * The whole scenario (brief of Task 11), for one device kind. `device` is DESKTOP or PHONE from escape.mjs; `name` the run name.
 * Returns the process exit code.
 */
export async function runVillageScenario({ name, device }) {
  const args = process.argv.slice(2);
  const opt = (n, fallback) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${fallback}`).slice(n.length + 3);
  const run = createRun(name);
  run.evidence = opt("out", run.evidence);
  mkdirSync(run.evidence, { recursive: true });
  const phone = device === PHONE;
  const summary = {};
  const browser = await launchBrowser();
  try {
    const A = await openPlayer(browser, run, { tag: "A", device, settings: { graphics: phone ? "low" : "high" } });
    const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP, settings: { graphics: "low" } });

    await run.step("1. entry: 입장하기 goes straight to the village, with no sheet", async () => {
      const r = await joinVillage(A, "손님");
      summary.join = r;
      run.check("the village scene is up", (await screenOf(A)) === "village");
      run.check("no destination sheet (no open dialog, no '어디로 갈까요')", !r.sheet.dialogOpen && !r.sheet.asks, r.sheet);
      run.check("the plaza is where we stand (spawn near (0, 14))", Math.hypot((await pos(A)).x, (await pos(A)).z - 14) < 6, await pos(A));
    });

    await run.step("2. a second player sees the first one", async () => {
      const r = await joinVillage(B, "이웃");
      summary.joinB = r;
      const sees = (p, who) =>
        p.page.waitForFunction((nick) => JSON.stringify(window.__cv.getRemotes()).includes(nick), who.nick, { timeout: 15000 }).then(() => true, () => false);
      run.check("B sees A", await sees(B, A), await B.page.evaluate(() => window.__cv.getRemotes().length));
      run.check("A sees B", await sees(A, B), await A.page.evaluate(() => window.__cv.getRemotes().length));
    });

    await run.step("2b. the plaza guide: 문의하기, a question, the answer shows, the voice clip plays, the music ducks", async () => {
      // a first touch starts the music (the browser's rule); headless Chrome is silent, so the audio element and the GainNode are read
      if (phone) await A.page.touchscreen.tap(300, 300);
      else await A.page.mouse.click(640, 300);
      await B.page.mouse.click(640, 300);
      // wait for the fade-in to reach its level instead of a fixed sleep (T11 review minor 7)
      await A.page.waitForFunction(() => { const b = window.__cvBgm; return b && !b.element()?.paused && Math.abs(b.level() - 0.35) < 0.02; }, null, { timeout: 8000 }).catch(() => {});
      const before = await audioState(A);
      run.check("the music is playing through its GainNode at 0.35", before.music && !before.music.paused && Math.abs(before.music.level - 0.35) < 0.02, before.music);
      await standAtPlazaGuide(A);
      summary.guideStand = await pos(A);
      const ts = await A.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
      run.check("문의하기 is offered at the plaza guide", ts.some((t) => t.id === "guide:plaza_guide" && t.label === "문의하기"), { ts, at: summary.guideStand });
      await act(A);
      await A.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 5000 });
      await sleep(500);
      run.check("the dialog is the 마을 안내원's, with 4 questions", (await A.page.locator(".cv-guide").getAttribute("data-guide")) === "plaza_guide" && (await A.page.locator(".cv-guide-questions button").count()) === 4);
      await press(A, question(A, 0));
      await A.page.waitForFunction(() => { const b = window.__cvBgm; return window.__cvGuideVoice?.state().playing && b && Math.abs(b.level() - 0.105) < 0.01; }, null, { timeout: 5000 }).catch(() => {});
      const s = await audioState(A);
      const sb = await audioState(B);
      summary.guide = s;
      const answer = await A.page.locator(".cv-guide-answer p").textContent();
      run.check("the answer text shows", !!answer && answer.startsWith("여기는 케이슨 마을이에요."), answer);
      run.check("the voice clip plays (plaza_guide_1.m4a, routed through its gain at 1)", s.voice.playing === "plaza_guide_1" && s.voice.src === "/village/voice/plaza_guide_1.m4a" && s.voice.paused === false && s.voice.routed && s.voice.level === 1, s.voice);
      run.check("the music ducks to 0.3 of its level (0.35 x 0.3)", Math.abs(s.music.duck - 0.3) < 0.01 && Math.abs(s.music.level - 0.105) < 0.01, s.music);
      run.check("the other player hears nothing: no clip, music not ducked", sb.voice.playing === null && Math.abs(sb.music.duck - 1) < 0.001, sb);
      await run.shot(A, "guide-plaza-answer.png");
      await press(A, A.page.locator(".cv-guide-skip"));
      await A.page.waitForFunction(() => window.__cvGuideVoice?.state().playing === null && Math.abs((window.__cvBgm?.duckLevel() ?? 0) - 1) < 0.01, null, { timeout: 5000 }).catch(() => {});
      const k = await audioState(A);
      run.check("건너뛰기 stops the clip and the music is back", k.voice.playing === null && Math.abs(k.music.duck - 1) < 0.01, k);
      await press(A, A.page.locator(".cv-guide-close"));
      await A.page.waitForFunction(() => !document.querySelector(".cv-guide"), null, { timeout: 3000 });
    });

    await run.step("3. walk to the bridge, then across it", async () => {
      await walkAndWait(A, -11, 28, 40000, 1.5);
      await walkAndWait(A, -24, 46, 40000, 1.5);
      await walkAndWait(A, -24, 66, 40000, 1.2);
      const before = await pos(A);
      await walkAndWait(A, -24, 85, 40000, 1.2);
      const after = await pos(A);
      summary.bridge = { before, after };
      run.check("crossed the creek: from the north bank (z < 70) to the south bank (z > 79)", before.z < 70 && after.z > 79, { before, after });
      run.check("stayed on the bridge line (x -26..-22 while crossing)", Math.abs(after.x + 24) < 3, after);
      await run.shot(A, "bridge-across.png");
    });

    await run.step("4. a plot sign reads 곧 지어져요 · <building>", async () => {
      await walkAndWait(A, -24, 66, 40000, 1.2);
      await walkAndWait(A, -24, 46, 40000, 1.5);
      await walkAndWait(A, 0, 44, 40000, 1.5);
      await turnCameraTo(A, 0, 50);
      await sleep(600);
      const signs = await A.page.evaluate(async () => {
        const m = await window.__imp("/src/village/plotSigns.ts");
        const specs = m.plotMarkerSpecs().map((s) => ({ id: s.id, text: s.text }));
        // the painted words are canvas textures on planes: count the board faces in the scene (one front + one back per sign)
        const { scene, camera } = window.__cvThree();
        let faces = 0;
        const frustumHits = [];
        camera.updateMatrixWorld();
        scene.traverse((o) => {
          const map = o.material && o.material.map;
          if (o.isMesh && map && map.image && map.image.tagName === "CANVAS" && o.geometry.type === "PlaneGeometry" && Math.abs(o.geometry.parameters.width - 1.08) < 0.01) {
            faces += 1;
            const v = o.getWorldPosition(camera.position.clone()).project(camera);
            if (Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 && v.z < 1) frustumHits.push({ x: Math.round(v.x * 100) / 100, y: Math.round(v.y * 100) / 100 });
          }
        });
        return { specs, faces, inFrame: frustumHits.length };
      });
      summary.signs = signs;
      const texts = signs.specs.map((s) => s.text);
      run.check("the empty plots' signs read 곧 지어져요 · 성당 / 학교 / 절 / 교회", ["성당", "학교", "절", "교회"].every((b) => texts.includes(`곧 지어져요 · ${b}`)), texts);
      run.check("the library's plot (under construction) reads 공사 중 · 도서관 (the brief's 곧 지어져요 · 도서관 predates Task 4's 공사 중)", texts.includes("공사 중 · 도서관"), texts);
      run.check("every sign has its painted face and back in the scene (5 x 2)", signs.faces === 10, signs.faces);
      run.check("the church sign (plot_s) is in front of the camera", signs.inFrame >= 1, signs);
      await run.shot(A, "plot-sign.png");
    });

    await run.step("5. the hall door, then the fade", async () => {
      for (const [x, z] of DOOR_ROUTE) await walkAndWait(A, x, z, 40000, 1.2);
      const ts = await A.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
      run.check("추모관 들어가기 is offered at the door", ts.some((t) => t.id === "memorial_door" && t.label === "추모관 들어가기"), ts);
      await act(A);
      // the door's curtain (DoorFade.tsx, .cv-door-fade only: T11 review I2) closes while the hall loads, then opens
      const curtain = () => {
        const e = document.querySelector(".cv-door-fade");
        return e ? parseFloat(getComputedStyle(e).opacity) : -1;
      };
      const veil = await A.page.waitForFunction(() => { const e = document.querySelector(".cv-door-fade"); return !!e && parseFloat(getComputedStyle(e).opacity) > 0.05; }, null, { timeout: 8000 }).then(() => true, () => false);
      run.check("the door curtain (.cv-door-fade) showed", veil);
      await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
      await A.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
      // the curtain must open again: a timeout is a failure, not swallowed (T11 review I1)
      const gone = await A.page.waitForFunction(() => { const e = document.querySelector(".cv-door-fade"); return !!e && parseFloat(getComputedStyle(e).opacity) <= 0.05; }, null, { timeout: 20000 }).then(() => true, () => false);
      run.check("the door curtain opened again inside the hall", gone, await A.page.evaluate(curtain));
      await sleep(2000);
      run.check("A is in the hall", (await areaOf(A)) === "hall");
      const at = await pos(A);
      run.check("arrived at the hall's arrival point (x ~ 300)", Math.abs(at.x - 300) < 3, at);
      await enterHall(B);
      run.check("B is in the hall too", (await areaOf(B)) === "hall");
      await walkAndWait(B, 298.3, 0.8, 15000, 0.6); // out of the arrival point: players block each other, and A walks this way later
    });

    await run.step("6. inside: camera y <= 3.0 at full orbit pitch; the ceiling is seen from inside", async () => {
      await walkChecked(run, A, 301.4, 2.0, "the middle of the hall", 0.5, 15000);
      await turnCameraTo(A, 301.0, -5);
      await setOrbit(A, phone ? null : 3.6, 1.2);
      await sleep(1200);
      const o = await A.page.evaluate(() => window.__cv.getOrbit());
      const top = await ceilingShare(A);
      summary.fullPitch = { ...top, pitch: o.pitch, distance: o.distance };
      run.check("the orbit pitch is at its limit (>= 1.1)", o.pitch >= 1.1, o);
      run.check("camera y <= 3.0 (+0.01) at full pitch: under the 3.3 m slab, never above the ceiling", top.y <= 3.01 && top.y > 2.0, top);
      await hideHud(A);
      await run.shot(A, "hall-fullpitch-frame.png");
      await showHud(A);
      await run.shot(A, "hall-fullpitch.png");
      // The ceiling in the frame: with the view level the ceiling fills the top of the picture. At full pitch the camera looks
      // straight down at the floor, so the ceiling is overhead and out of the frame, by design.
      await setOrbit(A, phone ? null : 3.6, 0.0);
      await sleep(1200);
      const level = await ceilingShare(A);
      summary.levelPitch = { ...level, orbit: await A.page.evaluate(() => window.__cv.getOrbit()) };
      run.check("the ceiling is in the frame when the view is level (some of it inside the picture)", level.share > 0.05, summary.levelPitch);
      const hits = await ceilingHits(A);
      summary.ceilingHits = hits;
      run.check("the ceiling is a shown mesh 3.2..3.7 m up, its face seen from below (rays up from 3 points; 2 of 3 at least)", hits.filter((h) => h.ok).length >= 2, hits);
      await hideHud(A);
      await run.shot(A, "hall-ceiling-view-frame.png");
      await showHud(A);
      await run.shot(A, "hall-ceiling-view.png");
      await setOrbit(A, phone ? null : 3.6, 0.35);
    });

    await run.step("7. inside the hall, an emoji is refused (quiet place)", async () => {
      await A.page.evaluate(async () => (await window.__imp("/src/net/connection.ts")).sendEmoji(2));
      await sleep(1800);
      const seenB = await B.page.evaluate(() => window.__cv.getEmojis().length);
      const seenA = await A.page.evaluate(() => window.__cv.getEmojis().length);
      run.check("nobody in the hall sees the emoji (the server dropped it)", seenB === 0 && seenA === 0, { seenA, seenB });
    });

    const pick = await pickCubby(A);
    summary.pick = pick;

    await run.step("8. a filled cubby: the card, then 촛불 켜기, which the other player sees", async () => {
      run.check("found a filled cubby to visit", pick !== null, pick);
      await standAtCubby(A, pick);
      await setOrbit(A, phone ? null : 2.6, 0.2);
      const ts = await A.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
      run.check("가까이 보기 is offered for this column", ts.some((t) => t.id === `cubby:${pick.key}` && t.label === "가까이 보기"), ts);
      await act(A);
      await A.page.locator(".cv-cubby").waitFor({ state: "visible", timeout: 5000 });
      await sleep(700);
      const card = await A.page.evaluate(() => ({
        id: document.querySelector(".cv-cubby")?.getAttribute("data-cubby"),
        name: document.querySelector(".cv-cubby-name")?.textContent,
        years: document.querySelector(".cv-cubby-years")?.textContent,
        line: document.querySelector(".cv-cubby-line")?.textContent,
        button: document.querySelector(".cv-cubby-light")?.textContent,
        text: document.querySelector(".cv-cubby")?.textContent ?? "",
      }));
      run.check("the card shows the sample's name, years and line", card.id === pick.id && card.name === pick.sample.name && card.years === `${pick.sample.born} – ${pick.sample.passed}` && card.line === pick.sample.line, card);
      run.check("the button says 촛불 켜기, and the card has no '!'", card.button === "촛불 켜기" && !card.text.includes("!"), card);
      await run.shot(A, "hall-card.png");
      if (phone) {
        const lay = await layoutOf(A, ".cv-cubby-panel");
        summary.cardLayout = lay;
        run.check("phone card buttons: >= 48 px, gaps >= 8 px, inside the screen", lay.report.ok, lay.report);
      }

      await B.page.evaluate(() => {
        window.__candleHeard = false;
        window.__imp("/src/village/hallCandles.ts").then((m) => m.subscribeCandles(() => (window.__candleHeard = true)));
      });
      await press(A, A.page.getByRole("button", { name: "촛불 켜기", exact: true }));
      const gotB = await B.page.waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), pick.id, { timeout: 6000 }).then(() => true, () => false);
      run.check("B received CandleLit for that cubby (heard it, and the candle burns)", gotB, await B.page.evaluate(() => window.__candleHeard));
      await sleep(500);
      const lit = await A.page.evaluate(() => document.querySelector(".cv-cubby-light")?.textContent);
      run.check("A's button now says 촛불이 켜져 있어요", lit === "촛불이 켜져 있어요", lit);
      await run.shot(A, "hall-card-lit.png");

      // B goes to the same cubby and opens its card: the line says who lit it
      // (B is just another visitor: it opens the same card through the card's own opener, so the check does not depend on where it stands)
      await B.page.evaluate(async (key) => (await window.__imp("/src/village/cubbyCard.ts")).openCubbyCard(key), pick.key);
      await B.page.locator(".cv-cubby").waitFor({ state: "visible", timeout: 5000 });
      await sleep(500);
      // the card opens on the row that is at B's eye height; step to the lit cubby's row if it is another one
      const rowB = await B.page.evaluate(async () => (await window.__imp("/src/village/cubbyCard.ts")).cubbyCardState().row);
      for (let i = 0; i < Math.abs(pick.row - rowB); i++) await B.page.getByRole("button", { name: pick.row > rowB ? "위 칸" : "아래 칸", exact: true }).click();
      await sleep(400);
      const seen = await B.page.evaluate(() => ({ by: document.querySelector(".cv-cubby-by")?.textContent ?? null, id: document.querySelector(".cv-cubby")?.getAttribute("data-cubby"), button: document.querySelector(".cv-cubby-light")?.textContent, at: window.__cv.getPos() }));
      run.check("B's card says '<닉네임> 님이 촛불을 켰어요'", seen.by === `${A.nick} 님이 촛불을 켰어요`, { ...seen, nick: A.nick, want: pick.id, rowB, pickRow: pick.row });
      await run.shot(B, "hall-card-seen-by-B.png");
      await B.page.keyboard.press("Escape");
      await B.page.waitForFunction(() => !document.querySelector(".cv-cubby"), null, { timeout: 4000 }).catch(() => {});
    });

    await run.step("9. an empty cubby says it will soon be possible", async () => {
      const empty = await A.page.evaluate(async ([key]) => {
        const s = await window.__imp("/src/village/sampleCubbies.ts");
        const t = await window.__imp("/src/village/villageTargets.ts");
        return t.cubbyColumn(key).rows.findIndex((a) => !s.SAMPLE_BY_ID.has(a.id));
      }, [pick.key]);
      run.check("the picked column has an empty row", empty >= 0, { key: pick.key, empty });
      if (empty >= 0) {
        const at = await A.page.evaluate(async () => (await window.__imp("/src/village/cubbyCard.ts")).cubbyCardState().row);
        const steps = empty - at;
        for (let i = 0; i < Math.abs(steps); i++) await press(A, A.page.getByRole("button", { name: steps > 0 ? "위 칸" : "아래 칸", exact: true }));
        await sleep(400);
        const line = await A.page.evaluate(() => document.querySelector(".cv-cubby-line")?.textContent);
        run.check("empty: 곧 이 자리에 우리 아이를 모실 수 있어요", line === "곧 이 자리에 우리 아이를 모실 수 있어요", line);
        await run.shot(A, "hall-card-empty.png");
      }
      await press(A, A.page.locator(".cv-cubby-close"));
      await A.page.waitForFunction(() => !document.querySelector(".cv-cubby"), null, { timeout: 4000 });
      run.check("the card closed", true);
    });

    await run.step("10. back out through the door", async () => {
      await leaveHall(A);
      await leaveHall(B);
      const at = await pos(A);
      run.check("A is in the village again, outside the memorial's door", (await areaOf(A)) === "village" && Math.abs(at.x) < 20 && at.z < -40, at);
      // control for step 7: outside, an emoji does go through
      await sleep(1000);
      await A.page.evaluate(async () => (await window.__imp("/src/net/connection.ts")).sendEmoji(2));
      const seen = await B.page.waitForFunction(() => window.__cv.getEmojis().length > 0, null, { timeout: 5000 }).then(() => true, () => false);
      run.check("(control) outside the hall the same emoji is seen", seen);
    });

    await run.step("11. layout: buttons >= 48 px with gaps >= 8 px on the phone; nothing off-screen on a PC", async () => {
      const lay = await layoutOf(A);
      summary.layout = lay;
      await run.shot(A, "village-layout.png");
      if (phone) {
        run.check("village HUD: >= 48 px, gaps >= 8 px, inside the screen", lay.report.ok && lay.report.count >= 4, lay.report);
        for (const [x, z] of [[0, -33], [-14, -20], [-20, 5]]) await walkChecked(run, A, x, z, "round the fountain", 1.5); // round the fountain
        await standAtPlazaGuide(A);
        await act(A);
        await A.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 5000 });
        await sleep(800);
        const g = await layoutOf(A, ".cv-guide-panel");
        summary.guideLayout = g;
        run.check("guide dialog: >= 48 px, gaps >= 8 px, inside the screen", g.report.ok && g.report.count >= 5, g.report);
        await run.shot(A, "guide-layout.png");
        await press(A, A.page.locator(".cv-guide-close"));
      } else {
        run.check("PC HUD: every button inside the screen", lay.report.outside.length === 0, lay.report);
        const overlaps = [];
        for (let i = 0; i < lay.els.length; i++)
          for (let j = i + 1; j < lay.els.length; j++) {
            const a = lay.els[i], b = lay.els[j];
            if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps.push(`${a.name} | ${b.name}`);
          }
        run.check("PC HUD: no two buttons overlap", overlaps.length === 0, overlaps);
      }
    });

    await A.ctx.close();
    await B.ctx.close();
  } catch (e) {
    // an error outside a step (openPlayer, pickCubby, ...) still ends in run.finish, so the assertions JSON is written (T11 review minor 6)
    run.check("the scenario ran to the end", false, String(e?.stack ?? e));
  } finally {
    await browser.close();
  }
  return run.finish(summary);
}
