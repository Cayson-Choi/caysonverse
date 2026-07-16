// v2 Task 14 E2E: 바닥 클릭 자동 이동 + 드래그 시선 방향 반전 (design 29).
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5180 →
// server :2574 — other ports belong to parallel lanes):
//   PORT=2574 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2574 npx vite --port 5180
//
// Proves design 29 end to end:
//   1. 클릭 → __cvClickTarget이 잡히고 __cv.getPos 폴링으로 그 지점에 수렴
//      (±0.5 m), 도착 시 target 해제.
//   2. 이동 중 다른 지점 클릭 → target 즉시 교체 + 이후 변위 벡터가 새 목표를
//      향함(중간 좌표 샘플로 방향 전환 입증) → 새 목표에 수렴.
//   3. 클릭 이동 중 W 입력 → target 즉시 해제(자동 이동 취소), 키 방향(-Z)으로
//      계속 이동.
//   4. 벽(divider) 너머 클릭 → 벽 앞에서 진행 불가 판정으로 정지(target 해제,
//      x가 divider를 넘지 않음), 콘솔 에러 0.
//   5. 드래그 반전(데스크톱): TP 드래그 오른쪽 → orbit.yaw 증가(기존 부호와
//      반대), 아래로 → pitch 감소. FP에서도 fpYaw가 같은 반전 부호로 움직임.
//   6. 모바일 뷰포트(터치): 터치 드래그 반전 + 탭이 클릭 이동을 유발함(구현
//      선택: 터치에서도 발동 — 조이스틱/D-패드는 캔버스 밖 별도 DOM 존이라
//      충돌 없고, 수동 입력 취소는 3번과 동일한 intent 경로가 보장).
//   증적 → .superpowers/sdd/evidence/task-v2-14/. Exit 0 = pass.
//
// NOTE: aimCamera는 design 29의 NEW 드래그 부호(오른쪽 드래그 = yaw 증가)를
// 사용한다 — 과거 task 스크립트의 구부호 helper는 일회성 산출물로 그대로 둔다.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5180";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-14");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

/** Assert-only copies (single source: clickMove.ts / constants.ts). */
const DRAG_SPEED = 0.005; // rad per px
const DIVIDER_MAX_X = 0.25; // divider wall east face

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getView = (page) => page.evaluate(() => window.__cv.getView());
const getTarget = (page) => page.evaluate(() => window.__cvClickTarget?.() ?? null);
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged via network events
    errors.push(`[${tag}] console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) {
      errors.push(`[${tag}] local ${r.status()}: ${r.url()}`);
    }
  });
  return errors;
}

async function joinAs(page, { nickname, characterLabel, tintIndex }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 45000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
  await sleep(400);
}

async function pollUntil(read, predicate, timeoutMs = 8000, stepMs = 80) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Real-mouse click on the canvas at viewport pixel (x, y) — the click-move path. */
async function clickCanvas(page, x, y) {
  await page.mouse.click(x, y);
}

/** Cancel any live click target via a manual key blip (design 29 (b)). */
async function cancelAuto(page) {
  await page.keyboard.down("s");
  await sleep(80);
  await page.keyboard.up("s");
  await sleep(80);
}

/**
 * Steer the avatar to (tx,tz) with KEYS, yaw-aware — reads the live camera yaw
 * each poll and projects the world direction onto the camera basis for w/s/a/d.
 * (Keyboard steering also proves nothing here depends on click-move.)
 */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 20000 } = {}) {
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      const p = await getPos(page);
      const { yaw } = await getOrbit(page);
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) <= tol) break;
      const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
      const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      const want = new Set();
      const th = tol / 2;
      if (f > th) want.add("w"); else if (f < -th) want.add("s");
      if (r > th) want.add("d"); else if (r < -th) want.add("a");
      await press(want);
      await sleep(60);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
  }
  return getPos(page);
}

/**
 * Aim the TP camera by dragging until orbit yaw/pitch reach the targets, with
 * design 29's NEW drag mapping: orbit.yaw += dx·DRAG_SPEED, pitch -= dy·DRAG_SPEED.
 */
async function aimCamera(page, targetYaw, targetPitch, tries = 8) {
  const box = await page.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  for (let i = 0; i < tries; i++) {
    const { yaw, pitch } = await getOrbit(page);
    const dYaw = norm(targetYaw - yaw);
    const dPitch = targetPitch - pitch;
    if (Math.abs(dYaw) < 0.04 && Math.abs(dPitch) < 0.04) break;
    const dx = Math.max(-350, Math.min(350, dYaw / DRAG_SPEED));
    const dy = Math.max(-250, Math.min(250, -dPitch / DRAG_SPEED));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await sleep(120);
  }
  return getOrbit(page);
}

/** One-finger touch drag on the canvas (synthetic PointerEvents — headless-safe). */
async function touchDrag(page, { fromX, fromY, dx, dy = 0 }) {
  await page.evaluate(
    ({ fromX, fromY, dx, dy }) => {
      const canvas = document.querySelector(".cv-canvas canvas");
      const mk = (type, x, y) =>
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          button: type === "pointermove" ? -1 : 0,
          bubbles: true,
          cancelable: true,
        });
      canvas.dispatchEvent(mk("pointerdown", fromX, fromY));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.34, fromY + dy * 0.34));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.67, fromY + dy * 0.67));
      canvas.dispatchEvent(mk("pointermove", fromX + dx, fromY + dy));
      window.dispatchEvent(mk("pointerup", fromX + dx, fromY + dy));
    },
    { fromX, fromY, dx, dy },
  );
  await sleep(150);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  let errors = [];
  let mobileErrors = [];
  try {
    // ───────────────────────── Desktop lane ─────────────────────────
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    errors = watchErrors(page, "desktop");
    await joinAs(page, { nickname: "클릭이동자", characterLabel: "기사", tintIndex: 0 });

    // ── 1. 클릭 → 목표 수렴 (±0.5 m) + 도착 해제 ──
    const start1 = await getPos(page);
    let t1 = null;
    for (const py of [520, 480, 450]) {
      await clickCanvas(page, 640, py);
      t1 = await pollUntil(() => getTarget(page), (t) => t !== null, 1500);
      if (t1 && dist(start1, t1) >= 1.5) break;
      await cancelAuto(page); // too-close floor point — retry a higher pixel
      t1 = null;
    }
    log.test1 = { start: start1, target: t1 };
    if (!t1) failures.push("1: click never produced a target ≥1.5m away");
    else {
      const p = await pollUntil(() => getPos(page), (p) => dist(p, t1) <= 0.5, 10000);
      log.test1.final = p;
      if (dist(p, t1) > 0.5) failures.push(`1: did not converge to target (dist ${dist(p, t1).toFixed(2)}m)`);
      const cleared = await pollUntil(() => getTarget(page), (t) => t === null, 2000);
      if (cleared !== null) failures.push("1: target not cleared on arrival");
    }
    await shot(page, "01-click-arrived.png");

    // ── 2. 이동 중 재클릭 → 즉시 방향 전환 + 새 목표 수렴 ──
    const start2 = await getPos(page);
    await clickCanvas(page, 300, 420);
    const tA = await pollUntil(() => getTarget(page), (t) => t !== null, 1500);
    // Wait until measurably under way toward A…
    await pollUntil(() => getPos(page), (p) => dist(p, start2) >= 0.8, 4000);
    const atReclick = await getPos(page);
    await clickCanvas(page, 980, 420);
    const tB = await pollUntil(
      () => getTarget(page),
      (t) => t !== null && tA !== null && dist(t, tA) > 0.5,
      1500,
    );
    log.test2 = { start: start2, targetA: tA, atReclick, targetB: tB };
    if (!tA || !tB) failures.push("2: missing target A or B");
    else {
      // Leg 1 really headed toward A…
      const legA = { x: atReclick.x - start2.x, z: atReclick.z - start2.z };
      const wantA = { x: tA.x - start2.x, z: tA.z - start2.z };
      if (legA.x * wantA.x + legA.z * wantA.z <= 0) failures.push("2: pre-reclick leg not toward A");
      // …and the very next displacement bends toward B (mid-path samples).
      await sleep(450);
      const p2 = await getPos(page);
      const legB = { x: p2.x - atReclick.x, z: p2.z - atReclick.z };
      const wantB = { x: tB.x - atReclick.x, z: tB.z - atReclick.z };
      log.test2.midSample = p2;
      if (Math.hypot(legB.x, legB.z) < 0.3) failures.push("2: no movement after reclick");
      if (legB.x * wantB.x + legB.z * wantB.z <= 0) failures.push("2: post-reclick leg not toward B (no direction change)");
      const pB = await pollUntil(() => getPos(page), (p) => dist(p, tB) <= 0.5, 12000);
      log.test2.final = pB;
      if (dist(pB, tB) > 0.5) failures.push(`2: did not converge to B (dist ${dist(pB, tB).toFixed(2)}m)`);
    }
    await shot(page, "02-reclick-turn.png");

    // ── 3. 클릭 이동 중 W → 자동 이동 즉시 취소, 키 방향(-Z) 이동 ──
    await aimCamera(page, 0, 0.35); // camera behind, looking north: W = -Z
    const start3 = await getPos(page);
    await clickCanvas(page, 980, 430); // off to the side, far
    await pollUntil(() => getTarget(page), (t) => t !== null, 1500);
    await pollUntil(() => getPos(page), (p) => dist(p, start3) >= 0.5, 4000);
    await page.keyboard.down("w");
    await sleep(150);
    const tAfterW = await getTarget(page);
    const posW0 = await getPos(page);
    await sleep(500);
    const posW1 = await getPos(page);
    await page.keyboard.up("w");
    log.test3 = { targetAfterW: tAfterW, posW0, posW1 };
    if (tAfterW !== null) failures.push("3: W did not cancel the click target");
    if (!(posW1.z < posW0.z - 0.5)) failures.push(`3: W movement not toward -Z (z ${posW0.z.toFixed(2)} → ${posW1.z.toFixed(2)})`);

    // ── 4. 벽(divider) 너머 클릭 → 벽 앞 정지(진행 불가 해제) ──
    await walkTo(page, -5, -8, { timeout: 25000 });
    await aimCamera(page, -Math.PI / 2, 0.25); // look east (+X) at the divider
    let t4 = null;
    for (const py of [360, 330, 300, 270]) {
      await clickCanvas(page, 640, py);
      const t = await pollUntil(() => getTarget(page), (v) => v !== null, 1200);
      if (t && t.x > DIVIDER_MAX_X + 0.5 && Math.abs(t.z) > 2.5) { t4 = t; break; }
      await cancelAuto(page); // not past the wall yet — aim higher
    }
    log.test4 = { target: t4 };
    if (!t4) failures.push("4: could not click a floor point beyond the divider");
    else {
      // The stuck detector must clear the target once the wall pins the avatar.
      const cleared = await pollUntil(() => getTarget(page), (t) => t === null, 8000, 120);
      const p4 = await getPos(page);
      log.test4.final = p4;
      if (cleared !== null) failures.push("4: target not released while blocked by the wall");
      if (!(p4.x < DIVIDER_MAX_X)) failures.push(`4: avatar crossed the divider (x=${p4.x.toFixed(2)})`);
      // And it really stopped: two samples 400ms apart barely differ.
      await sleep(200);
      const s1 = await getPos(page);
      await sleep(400);
      const s2 = await getPos(page);
      if (dist(s1, s2) > 0.05) failures.push(`4: avatar still moving after release (${dist(s1, s2).toFixed(2)}m/0.4s)`);
    }
    await shot(page, "03-wall-stop.png");

    // ── 5. 드래그 반전 (TP yaw/pitch + FP yaw) — 수치 단언 ──
    const o0 = await getOrbit(page);
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 400, { steps: 10 }); // +200 px right
    await page.mouse.up();
    await sleep(120);
    const o1 = await getOrbit(page);
    const dYaw = norm(o1.yaw - o0.yaw);
    log.test5 = { yaw0: o0.yaw, yaw1: o1.yaw, dYaw };
    // NEW sign: right-drag INCREASES orbit.yaw (~ +1.0 rad); old code went -1.0.
    if (!(dYaw > 0.5)) failures.push(`5: TP right-drag dYaw=${dYaw.toFixed(3)} (want > +0.5 — inverted)`);

    const p0 = await getOrbit(page);
    await page.mouse.move(640, 300);
    await page.mouse.down();
    await page.mouse.move(640, 450, { steps: 10 }); // +150 px down
    await page.mouse.up();
    await sleep(120);
    const p1 = await getOrbit(page);
    log.test5.pitch0 = p0.pitch;
    log.test5.pitch1 = p1.pitch;
    // NEW sign: down-drag DECREASES pitch (old code increased it).
    if (!(p1.pitch < p0.pitch - 0.2)) failures.push(`5: TP down-drag pitch ${p0.pitch.toFixed(3)} → ${p1.pitch.toFixed(3)} (want decrease — inverted)`);

    await page.keyboard.press("v");
    const view = await pollUntil(() => getView(page), (v) => v.mode === "fp", 3000);
    if (view.mode !== "fp") failures.push("5: V did not enter first-person");
    const fp0 = (await getView(page)).fpYaw;
    await page.mouse.move(640, 400);
    await page.mouse.down();
    await page.mouse.move(840, 400, { steps: 10 });
    await page.mouse.up();
    await sleep(120);
    const fp1 = (await getView(page)).fpYaw;
    const dFpYaw = norm(fp1 - fp0);
    log.test5.fpYaw0 = fp0;
    log.test5.fpYaw1 = fp1;
    log.test5.dFpYaw = dFpYaw;
    if (!(dFpYaw > 0.5)) failures.push(`5: FP right-drag dFpYaw=${dFpYaw.toFixed(3)} (want > +0.5 — inverted)`);
    await page.keyboard.press("v"); // back to TP
    await shot(page, "04-drag-inverted.png");

    // ───────────────────────── Mobile lane ─────────────────────────
    // 구현 선택(문서화): 탭 클릭 이동은 터치에서도 발동한다. 조이스틱/D-패드는
    // 캔버스 밖 별도 DOM 존이므로 캔버스 탭과 충돌하지 않고, 조이스틱 입력은
    // 키보드와 같은 manual-intent 경로로 자동 이동을 즉시 취소한다(테스트 3).
    const mctx = await browser.newContext({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    });
    const mpage = await mctx.newPage();
    mobileErrors = watchErrors(mpage, "mobile");
    await joinAs(mpage, { nickname: "모바일러", characterLabel: "도적", tintIndex: 2 });

    // ── 6a. 터치 드래그 반전: 오른쪽 스와이프 → orbit.yaw 증가 ──
    const mo0 = await getOrbit(mpage);
    await touchDrag(mpage, { fromX: 195, fromY: 350, dx: 120 });
    const mo1 = await getOrbit(mpage);
    const mdYaw = norm(mo1.yaw - mo0.yaw);
    log.test6 = { yaw0: mo0.yaw, yaw1: mo1.yaw, dYaw: mdYaw };
    if (!(mdYaw > 0.3)) failures.push(`6: touch right-drag dYaw=${mdYaw.toFixed(3)} (want > +0.3 — inverted)`);

    // ── 6b. 탭 → 클릭 이동 발동 + 수렴 (터치에서도 동작하는 구현 선택).
    //        수렴 단언이 공허하지 않도록 목표가 1 m 이상 떨어질 때까지 탭
    //        지점을 지평선 쪽으로 올려가며 시도한다. ──
    let mstart = await getPos(mpage);
    let mt = null;
    for (const py of [520, 470, 430, 390]) {
      mstart = await getPos(mpage);
      await mpage.touchscreen.tap(195, py);
      const t = await pollUntil(() => getTarget(mpage), (v) => v !== null, 1200);
      log.test6.tapVia = t ? "touchscreen.tap" : "synthetic";
      if (t && dist(mstart, t) >= 1.0) { mt = t; break; }
      if (t) await cancelAuto(mpage); // too close — aim farther
    }
    if (!mt) {
      // Headless touch synthesis can vary — fall back to the same synthetic
      // pointer sequence the app's handlers see from a real tap.
      mstart = await getPos(mpage);
      await mpage.evaluate(() => {
        const canvas = document.querySelector(".cv-canvas canvas");
        const mk = (type) =>
          new PointerEvent(type, {
            pointerId: 9,
            pointerType: "touch",
            isPrimary: true,
            clientX: 195,
            clientY: 430,
            button: 0,
            bubbles: true,
            cancelable: true,
          });
        canvas.dispatchEvent(mk("pointerdown"));
        window.dispatchEvent(mk("pointerup"));
      });
      mt = await pollUntil(() => getTarget(mpage), (t) => t !== null, 1200);
    }
    log.test6.tapTarget = mt;
    log.test6.start = mstart;
    if (!mt) failures.push("6: tap did not produce a click-move target");
    else if (dist(mstart, mt) < 1.0) failures.push("6: tap target too close for a meaningful convergence check");
    else {
      const mp = await pollUntil(() => getPos(mpage), (p) => dist(p, mt) <= 0.5, 10000);
      log.test6.final = mp;
      if (dist(mp, mt) > 0.5) failures.push(`6: mobile tap-move did not converge (dist ${dist(mp, mt).toFixed(2)}m)`);
    }
    await shot(mpage, "05-mobile-tap-move.png");

    // ── Zero console/page errors on both lanes. ──
    log.errors = [...errors, ...mobileErrors];
    if (log.errors.length) failures.push(`console/page errors:\n  ${log.errors.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  for (const key of ["test1", "test2", "test3", "test4", "test5", "test6"]) {
    console.log(`${key}:`, JSON.stringify(log[key]));
  }
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log(
    "\nE2E PASSED — 클릭 수렴/재클릭 방향 전환/W 취소/벽 앞 정지/드래그 반전(TP+FP)/모바일 탭·터치 반전, 콘솔 에러 0.",
  );
}

main();
