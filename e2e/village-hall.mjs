/**
 * e2e/village-hall.mjs — 추모관 안 (케이슨 마을 1단계 Task 9): 문으로 들어가서, 채워진 칸 앞에서 E로 가까이 보기 카드를 열고,
 * 촛불을 켜면 다른 사람(두 번째 탭)도 CandleLit을 받는지, 그리고 추모관 화면 세 장의 밝기(낮 기준)를 본다.
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-hall.mjs [--out=<폴더>]
 *
 * 남기는 것(폴더): hall-wide(-frame).png, hall-cubbies(-frame).png, hall-card.png, hall-candle(-frame).png, hall-corner.png,
 * village-hall.json. `*-frame.png`는 HUD를 숨긴 3D 화면이고, 밝기 판정(e2e/luma-check.mjs의 낮 기준: 평균 ≥ 0.45, p5 ≥ 0.10)은
 * 이 세 장(wide, cubbies, candle)에 한다.
 */

import { join } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, waitIdle, walkAndWait, walkTo } from "./lib/escape.mjs";
import { MEAN_MIN, P5_MIN, decodePng, lumaStats, passes } from "./luma-check.mjs";

const run = createRun("village-hall");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });

let nick = 0;
/** Entry (noon, pinned) -> nickname -> 입장하기 -> the village scene is up. */
async function joinVillage(p) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`추모${++nick}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 20000 });
  await sleep(1500);
}

const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

/** Walk from the plaza to the memorial's door and press E: the curtain closes, the door is used, the hall loads. */
async function enterHall(p) {
  for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await walkAndWait(p, x, z, 40000, 1.2);
  await p.page.keyboard.press("KeyE");
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
  await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
  await sleep(2500);
}

/** Zoom (wheel) and pitch (vertical drag) the follow camera until the orbit is about there. */
async function setOrbit(p, distance, pitch) {
  const vp = p.page.viewportSize();
  const cx = vp.width / 2;
  const cy = vp.height / 2;
  await p.page.mouse.move(cx, cy);
  for (let k = 0; k < 12; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.abs(o.distance - distance) < 0.6) break;
    await p.page.mouse.wheel(0, (distance - o.distance) * 100);
    await sleep(250);
  }
  for (let k = 0; k < 10; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const diff = pitch - o.pitch;
    if (Math.abs(diff) < 0.05) break;
    const dy = Math.max(-260, Math.min(260, diff * 220));
    await p.page.mouse.move(cx, cy);
    await p.page.mouse.down();
    for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy + (dy * s) / 8);
    await p.page.mouse.up();
    await sleep(300);
    const after = await p.page.evaluate(() => window.__cv.getOrbit());
    if (Math.sign(after.pitch - o.pitch) !== Math.sign(diff) && Math.abs(after.pitch - o.pitch) > 0.01) {
      await p.page.mouse.move(cx, cy);
      await p.page.mouse.down();
      for (let s = 1; s <= 8; s++) await p.page.mouse.move(cx, cy - (2 * dy * s) / 8);
      await p.page.mouse.up();
      await sleep(300);
    }
  }
  await sleep(1000);
}

const hideHud = (p) =>
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
const showHud = (p) =>
  p.page.evaluate(() => {
    for (const el of window.__hidden ?? []) el.style.visibility = "";
  });

const round = (n) => Math.round(n * 1000) / 1000;
const luma = {};
/** The frame (HUD hidden) for the brightness bar, and the same moment with the HUD. */
async function shoot(p, name, { judge = true } = {}) {
  await hideHud(p);
  await sleep(300);
  await run.shot(p, `${name}-frame.png`);
  await showHud(p);
  await run.shot(p, `${name}.png`);
  if (!judge) return;
  const s = lumaStats(decodePng(readFileSync(join(OUT, `${name}-frame.png`))).rgba);
  luma[name] = { mean: round(s.mean), p5: round(s.p5) };
  run.check(`${name}: day bar (mean >= ${MEAN_MIN}, p5 >= ${P5_MIN})`, passes(s), luma[name]);
}

const browser = await launchBrowser();
let summary = {};
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
  const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP, settings: { graphics: "high" } });

  await run.step("both visitors join and go in through the memorial's door", async () => {
    await joinVillage(A);
    await joinVillage(B);
    await enterHall(B);
    await enterHall(A);
    run.check("A is in the hall", (await areaOf(A)) === "hall");
    run.check("B is in the hall", (await areaOf(B)) === "hall");
    const hall = await A.page.evaluate(() => window.__cvHall());
    summary.hall = hall;
    run.check("the hall's props are instanced: few draw calls for ~1,000 props", hall.meshes < 60 && Object.keys(hall.props).length <= 13, {
      meshes: hall.meshes,
      instanced: hall.instanced,
      props: hall.props,
    });
    run.check("160 sample cubbies (60 % of 266)", hall.samples === 160, hall.samples);
    const orbit = await A.page.evaluate(() => window.__cv.getOrbit());
    run.check("the pitch came through the door unchanged (still the first-visit 0.35)", Math.abs(orbit.pitch - 0.35) < 0.02, orbit);
  });

  await run.step("the hall, wide: from the arrival, looking into the room", async () => {
    // west of the middle line: the desk guide (moved to (302.8, 3.0) in the final fix) stays out of the frame, so its navy
    // clothes close to the camera do not stand in for the room's light in the luma bar
    await walkAndWait(A, 299.8, 1.6, 15000, 0.5);
    await turnCameraTo(A, 300.6, -5);
    await setOrbit(A, 3.6, 0.3);
    await shoot(A, "hall-wide");
  });

  // A filled cubby whose card opens at eye level (row 3, else 2), on the back wall east of the bench and the memorial
  // table or on the east wall; the visitor stands 0.85 m in front of it.
  const pick = await A.page.evaluate(async () => {
    const s = await window.__imp("/src/village/sampleCubbies.ts");
    const t = await window.__imp("/src/village/villageTargets.ts");
    const c = await window.__imp("/src/village/cubbyCard.ts");
    const cols = t.cubbyColumns().filter((col) => (col.wall === "n" && col.x > 300.6 && col.x < 303.2) || (col.wall === "e" && col.z > -4.4 && col.z < 1.2));
    for (const want of [3, 2, 4]) {
      for (const column of cols) {
        const row = c.defaultRow(column.key);
        const a = column.rows[row];
        if (row !== want || !s.SAMPLE_BY_ID.has(a.id)) continue;
        const fx = Math.sin(a.yaw);
        const fz = Math.cos(a.yaw);
        return { key: column.key, row, id: a.id, x: a.x, y: a.y, z: a.z, standX: a.x + fx * 0.85, standZ: a.z + fz * 0.85, sample: s.SAMPLE_BY_ID.get(a.id) };
      }
    }
    return null;
  });
  summary.pick = pick;

  await run.step("approach a filled cubby: 가까이 보기 is offered", async () => {
    run.check("found a filled cubby to visit", pick !== null, pick);
    await walkAndWait(A, 302.6, 0.5, 15000, 0.5);
    await walkAndWait(A, 302.6, -3.6, 15000, 0.5); // round the bench on its east side
    // Square in front of the column (columns are 0.425 m apart): line up 1.6 m out, then walk straight in. A click-move
    // stops about 0.35 m short of its goal, so the goal is 0.5 m out and the visitor ends about 0.85 m from the cubby.
    const fx = (pick.standX - pick.x) / 0.85;
    const fz = (pick.standZ - pick.z) / 0.85;
    await walkAndWait(A, pick.x + fx * 1.6, pick.z + fz * 1.6, 15000, 0.4);
    await walkTo(A, pick.x + fx * 0.5, pick.z + fz * 0.5);
    await sleep(400);
    await waitIdle(A, 15000);
    await sleep(400);
    const at = await A.page.evaluate(() => window.__cv.getPos());
    summary.standAt = at;
    await turnCameraTo(A, pick.x + (pick.x - pick.standX) * 3, pick.z + (pick.z - pick.standZ) * 3);
    await setOrbit(A, 2.6, 0.2);
    await sleep(800);
    const ts = await A.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
    run.check("the target is this column's close-up", ts.some((t) => t.id === `cubby:${pick.key}` && t.label === "가까이 보기"), ts);
    await shoot(A, "hall-cubbies");
  });

  await run.step("press E: the card shows the portrait, the name, the years and the line", async () => {
    await A.page.keyboard.press("KeyE");
    await A.page.locator(".cv-cubby").waitFor({ state: "visible", timeout: 5000 });
    await sleep(700);
    const card = await A.page.evaluate(() => ({
      id: document.querySelector(".cv-cubby")?.getAttribute("data-cubby"),
      name: document.querySelector(".cv-cubby-name")?.textContent,
      years: document.querySelector(".cv-cubby-years")?.textContent,
      line: document.querySelector(".cv-cubby-line")?.textContent,
      button: document.querySelector(".cv-cubby-light")?.textContent,
      photo: getComputedStyle(document.querySelector(".cv-cubby-photo")).backgroundImage,
      text: document.querySelector(".cv-cubby")?.textContent ?? "",
    }));
    summary.card = card;
    run.check("the card is the eye-level cubby of that column", card.id === pick.id, card.id);
    run.check("name, years and line are the sample's", card.name === pick.sample.name && card.years === `${pick.sample.born} – ${pick.sample.passed}` && card.line === pick.sample.line, card);
    run.check("the portrait is a tile of the atlas", /sample-photos\/atlas\.webp/.test(card.photo), card.photo);
    run.check("the button says 촛불 켜기", card.button === "촛불 켜기", card.button);
    run.check("no '!' on the card", !card.text.includes("!"), card.text);
    await run.shot(A, "hall-card.png");
  });

  await run.step("an empty cubby says it will soon be possible", async () => {
    const empty = await A.page.evaluate(async ([key]) => {
      const s = await window.__imp("/src/village/sampleCubbies.ts");
      const t = await window.__imp("/src/village/villageTargets.ts");
      return t.cubbyColumn(key).rows.findIndex((a) => !s.SAMPLE_BY_ID.has(a.id));
    }, [pick.key]);
    if (empty < 0) {
      run.check("(this column is full: the empty text is unit-tested)", true);
      return;
    }
    const at = await A.page.evaluate(async () => (await window.__imp("/src/village/cubbyCard.ts")).cubbyCardState().row);
    const steps = empty - at;
    const label = steps > 0 ? "위 칸" : "아래 칸";
    for (let i = 0; i < Math.abs(steps); i++) await A.page.getByRole("button", { name: label, exact: true }).click();
    await sleep(300);
    const line = await A.page.evaluate(() => document.querySelector(".cv-cubby-line")?.textContent);
    run.check("empty: 곧 이 자리에 우리 아이를 모실 수 있어요", line === "곧 이 자리에 우리 아이를 모실 수 있어요", line);
    await run.shot(A, "hall-card-empty.png");
    for (let i = 0; i < Math.abs(steps); i++) await A.page.getByRole("button", { name: steps > 0 ? "아래 칸" : "위 칸", exact: true }).click();
    await sleep(300);
  });

  await run.step("light a candle: the second visitor receives CandleLit and sees the flame", async () => {
    await B.page.evaluate(() => {
      window.__candleHeard = [];
      window.__imp("/src/village/hallCandles.ts").then((m) => m.subscribeCandles(() => window.__candleHeard.push([...m.burningCandles().keys()])));
    });
    await A.page.getByRole("button", { name: "촛불 켜기", exact: true }).click();
    const gotB = await B.page
      .waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), pick.id, { timeout: 5000 })
      .then(() => true, () => false);
    run.check("B (in the hall) heard CandleLit for that cubby", gotB, await B.page.evaluate(() => window.__candleHeard));
    const gotA = await A.page
      .waitForFunction((id) => (window.__cvHall?.().candles ?? []).includes(id), pick.id, { timeout: 5000 })
      .then(() => true, () => false);
    run.check("A sees its own candle too", gotA);
    await sleep(500);
    const button = await A.page.evaluate(() => document.querySelector(".cv-cubby-light")?.textContent);
    run.check("the button now says 촛불이 켜져 있어요", button === "촛불이 켜져 있어요", button);
    await run.shot(A, "hall-card-lit.png");
    await A.page.keyboard.press("Escape");
    await A.page.waitForFunction(() => !document.querySelector(".cv-cubby"), null, { timeout: 3000 });
    run.check("Esc closed the card", true);
    // first person, looking straight at the cubby: the candle and its glow, the portrait beside it
    await A.page.keyboard.press("KeyV");
    await sleep(1200);
    await A.page.evaluate(async ([cx, cy, cz]) => {
      const { viewState } = await window.__imp("/src/game/viewState.ts");
      const p = window.__cv.getPos();
      const dx = cx - p.x;
      const dz = cz - p.z;
      viewState.fpYaw = Math.atan2(-dx, -dz); // forward is (-sin, -cos)
      viewState.fpPitch = -Math.atan2(cy - 1.5, Math.hypot(dx, dz)); // positive looks down
    }, [pick.x, pick.y - 0.12, pick.z]);
    await sleep(1200);
    await shoot(A, "hall-candle");
    await A.page.keyboard.press("KeyV");
    await sleep(1200);
    // B's view of the same cubby
    await walkAndWait(B, pick.standX + (pick.standX - pick.x) * 0.8 - 0.6, pick.standZ + (pick.standZ - pick.z) * 0.8 + 0.4, 15000, 0.6);
    await turnCameraTo(B, pick.x, pick.z);
    await setOrbit(B, 2.6, 0.2);
    await sleep(800);
    await run.shot(B, "hall-candle-seen-by-B.png");
  });

  await run.step("the corner: a wall right behind the player keeps the camera up (no head filling the screen)", async () => {
    await walkAndWait(A, 302.6, 0.5, 15000, 0.5);
    await walkAndWait(A, 296.9, 5.55, 15000, 0.4);
    await turnCameraTo(A, 296, -5); // the camera behind, toward the south wall at 0.4 m
    await setOrbit(A, 3.6, 0.35);
    await sleep(1500);
    const cam = await A.page.evaluate(() => {
      const { camera } = window.__cvThree();
      const p = window.__cv.getPos();
      const head = camera.position.clone().set(p.x, 1.45, p.z).project(camera);
      return { y: camera.position.y, x: camera.position.x, z: camera.position.z, headNdcY: head.y, arm: Math.hypot(camera.position.x - p.x, camera.position.z - p.z) };
    });
    summary.corner = cam;
    run.check("in the corner the arm is short (the wall is right behind)", cam.arm < 1.2, cam);
    run.check("the camera keeps its height (> 2.3 m) under the ceiling (<= 3.0 m)", cam.y > 2.3 && cam.y <= 3.0001, cam);
    run.check("the head sits low in the frame (NDC y < -0.4), not in the middle of it", cam.headNdcY < -0.4, cam);
    await run.shot(A, "hall-corner.png");
  });

  await A.ctx.close();
  await B.ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "village-hall.json"), JSON.stringify({ luma, ...summary }, null, 2));
process.exit(run.finish({ luma }));
