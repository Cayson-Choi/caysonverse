// v2 Task 5 E2E: 1인칭 뷰 전환 (first-person view toggle).
//
// Standalone Playwright (same shape as task-v2-02 / task-10), against the default
// dev stack (client :5173, server :2567). Proves design 19 end to end:
//
//   DESKTOP — two tabs:
//     1. A joins as 왕 (crown on the head) in third-person; own avatar visible.
//     2. B observes remote A as royal (character 4) with a crown.
//     3. A presses V → first-person: A's OWN avatar goes invisible
//        (window.__cv.getSelfVisible() === false, blend → 1) …
//     4. … while B STILL sees A as a connected royal (remote render unaffected).
//     5. A walks forward in FP → moves along the FP look direction.
//     6. A drags to look → the FP look yaw changes while the TP orbit yaw does NOT.
//     7. A wheel-out → back to TP with the pre-FP follow distance restored.
//     8. A wheel-in through minDistance → FP again (wheel path); V → back to TP.
//     9. A walks into the maze doorway, enters FP → camera pinned at eye height
//        (well under the wall cap; the maze cap is inert in FP), no errors.
//
//   MOBILE (iPhone 14, hasTouch):
//    10. The 👁 button toggles FP; the joystick still moves the avatar in FP;
//        a pinch-out returns to third-person.
//
// Automated assertions carry correctness; screenshots are the human guard. Zero
// console/page errors on any tab. Exit 0 = pass. Evidence → evidence/task-v2-05/.

import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const KING_CHAR = 4; // CHARACTERS index for 왕
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-05");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getCamera = (page) => page.evaluate(() => window.__cvCamera());
// View state read SYNCHRONOUSLY from the module mutable (mode/blend/fpYaw) —
// truthful even before the next rAF frame publishes __cvCamera. Chromium throttles
// requestAnimationFrame on background tabs, so with several tabs open we always
// bringToFront the tab under test AND prefer getView over the rAF-published probe.
const getView = (page) => page.evaluate(() => window.__cv.getView());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const getSelfVisible = (page) => page.evaluate(() => window.__cv.getSelfVisible());

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
  // Exact-match the label so 왕 does not also match 왕비 / 왕자.
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.waitForFunction(() => typeof window.__cvCamera === "function", null, { timeout: 20000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
  await sleep(400);
}

async function pollUntil(read, predicate, timeoutMs = 8000, stepMs = 100) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Press V (guarded toggle) on a canvas-focused desktop page. */
async function pressV(page) {
  await page.keyboard.press("v");
}

/** Move the mouse over the canvas centre, then scroll the wheel by deltaY. */
async function wheel(page, deltaY, times = 1) {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, deltaY);
    await sleep(60);
  }
}

/** One-finger drag on the canvas (synthetic PointerEvents — reliable headless). */
async function dragCanvas(page, { fromX, fromY, dx }) {
  await page.evaluate(
    ({ fromX, fromY, dx }) => {
      const canvas = document.querySelector(".cv-canvas canvas");
      const mk = (type, x) =>
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: fromY,
          bubbles: true,
          cancelable: true,
        });
      canvas.dispatchEvent(mk("pointerdown", fromX));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.34));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.67));
      canvas.dispatchEvent(mk("pointermove", fromX + dx));
      window.dispatchEvent(mk("pointerup", fromX + dx));
    },
    { fromX, fromY, dx },
  );
  await sleep(150);
}

/** Drive the virtual joystick (nipplejs pointer events) forward for holdMs. */
async function driveJoystick(page, { dx, dy, holdMs }) {
  await page.evaluate(
    ({ dx, dy }) => {
      const zone = document.querySelector(".cv-joystick-zone");
      const r = zone.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const mk = (type, x, y) =>
        new PointerEvent(type, {
          pointerId: 1,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        });
      zone.dispatchEvent(mk("pointerdown", cx, cy));
      document.dispatchEvent(mk("pointermove", cx + dx, cy + dy));
    },
    { dx, dy },
  );
  await sleep(holdMs);
  await page.evaluate(() =>
    document.dispatchEvent(
      new PointerEvent("pointerup", { pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true }),
    ),
  );
}

/** Two-finger pinch on the canvas: fingers together (spread shrinks) → zoom out. */
async function pinchTogether(page) {
  await page.evaluate(() => {
    const canvas = document.querySelector(".cv-canvas canvas");
    const mk = (type, id, x) =>
      new PointerEvent(type, {
        pointerId: id,
        pointerType: "touch",
        isPrimary: id === 20,
        clientX: x,
        clientY: 300,
        bubbles: true,
        cancelable: true,
      });
    canvas.dispatchEvent(mk("pointerdown", 20, 110));
    canvas.dispatchEvent(mk("pointerdown", 21, 280));
    canvas.dispatchEvent(mk("pointermove", 20, 160));
    canvas.dispatchEvent(mk("pointermove", 21, 230));
    window.dispatchEvent(mk("pointerup", 20, 160));
    window.dispatchEvent(mk("pointerup", 21, 230));
  });
  await sleep(150);
}

/**
 * Steer the avatar to (tx,tz), yaw-AWARE: reads the live camera yaw each poll and
 * projects the desired world direction onto the camera basis (F = forward,
 * R = screen-right) to choose w/s/a/d. Works no matter what the orbit yaw is
 * (FP round-trips leave it non-zero). Releases all keys on arrival/timeout.
 */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 22000 } = {}) {
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
      const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw); // forward projection
      const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw); // right projection
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

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  const allErrors = [];
  try {
    // ─────────────────────── DESKTOP: A (왕) + B (observer) ───────────────────────
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await ctxA.newPage();
    allErrors.push(watchErrors(pageA, "A"));
    await joinAs(pageA, { nickname: "왕앨리스", characterLabel: "왕", tintIndex: 0 });
    await pageA.bringToFront();
    await pageA.locator("canvas").click(); // keyboard focus; zero-length drag, no rotate

    const d0 = (await getOrbit(pageA)).distance;
    const view0 = await getView(pageA);
    log.start = { distance: d0, mode: view0.mode, selfVisible: await getSelfVisible(pageA) };
    if (view0.mode !== "tp") failures.push(`A did not start in TP (mode=${view0.mode})`);
    if (log.start.selfVisible !== true) failures.push("A own avatar not visible at start");
    await shot(pageA, "01-A-tp-crown.png");

    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageB = await ctxB.newPage();
    allErrors.push(watchErrors(pageB, "B"));
    await joinAs(pageB, { nickname: "구경밥", characterLabel: "기사", tintIndex: 2 });

    await pageB.bringToFront();
    const remotesBefore = await pollUntil(
      () => getRemotes(pageB),
      (rs) => rs.some((r) => r.character === KING_CHAR && r.connected),
      10000,
    );
    log.bSeesKingBefore = remotesBefore.some((r) => r.character === KING_CHAR && r.connected);
    if (!log.bSeesKingBefore) failures.push("B does not see A as a connected royal (before FP)");
    await shot(pageB, "02-B-sees-A.png");

    // ── Separate A from B's co-located spawn so the FP view looks out at open
    //    lounge (own avatar hidden) instead of straight into B's overlapping
    //    head. Walking keeps the TP orbit yaw at 0, so FP seeds a level -Z look. ──
    await pageA.bringToFront();
    await pageA.locator("canvas").click();
    await walkTo(pageA, -12, 3, { timeout: 9000 });

    // ── A → first-person: own avatar goes invisible. ──
    await pressV(pageA);
    const viewFp = await pollUntil(
      () => getView(pageA),
      (v) => v.mode === "fp" && v.blend > 0.99,
      5000,
    );
    log.fpEnter = { mode: viewFp.mode, blend: viewFp.blend };
    if (viewFp.mode !== "fp") failures.push("A did not enter FP on V");
    const selfHidden = await pollUntil(() => getSelfVisible(pageA), (v) => v === false, 3000);
    log.selfHiddenInFp = selfHidden;
    if (selfHidden !== false) failures.push("A own avatar still visible in FP (should be hidden)");
    await shot(pageA, "03-A-fp-own-hidden.png");

    // ── B STILL sees A (remote render unaffected by A's local FP). ──
    await pageB.bringToFront();
    const remotesAfter = await getRemotes(pageB);
    log.bStillSeesKing = remotesAfter.some((r) => r.character === KING_CHAR && r.connected);
    if (!log.bStillSeesKing) failures.push("B stopped seeing A as a connected royal while A was in FP");
    await shot(pageB, "04-B-still-sees-A.png");

    // ── A walks forward in FP → moves along the FP look direction. ──
    await pageA.bringToFront();
    await pageA.locator("canvas").click();
    const fpYaw0 = (await getView(pageA)).fpYaw;
    const posW0 = await getPos(pageA);
    await pageA.keyboard.down("w");
    await sleep(650);
    await pageA.keyboard.up("w");
    await sleep(120);
    const posW1 = await getPos(pageA);
    const moved = Math.hypot(posW1.x - posW0.x, posW1.z - posW0.z);
    const expX = -Math.sin(fpYaw0);
    const expZ = -Math.cos(fpYaw0);
    const dot = moved > 1e-6 ? ((posW1.x - posW0.x) * expX + (posW1.z - posW0.z) * expZ) / moved : 0;
    log.fpWalk = { fpYaw0, moved, dot };
    if (moved < 0.25) failures.push(`A did not walk forward in FP (moved ${moved.toFixed(3)}m)`);
    if (dot < 0.85) failures.push(`A's FP walk not aligned with the look yaw (dot ${dot.toFixed(3)})`);

    // ── A drags to look: FP look yaw changes, TP orbit yaw does NOT. ──
    const fpYawA = (await getView(pageA)).fpYaw;
    const orbitYawA = (await getOrbit(pageA)).yaw;
    await dragCanvas(pageA, { fromX: 640, fromY: 400, dx: 220 });
    const fpYawB = (await getView(pageA)).fpYaw;
    const orbitYawB = (await getOrbit(pageA)).yaw;
    log.fpLook = { fpYawA, fpYawB, dFp: Math.abs(fpYawB - fpYawA), dOrbit: Math.abs(orbitYawB - orbitYawA) };
    if (Math.abs(fpYawB - fpYawA) < 0.2) failures.push(`A drag did not rotate the FP look (Δ ${log.fpLook.dFp})`);
    if (Math.abs(orbitYawB - orbitYawA) > 0.02) failures.push("A FP drag leaked into the TP orbit yaw");
    await shot(pageA, "05-A-fp-looked.png");

    // ── A wheel-out → back to TP with the pre-FP distance restored. ──
    await wheel(pageA, 120, 1);
    const viewTp = await pollUntil(() => getView(pageA), (v) => v.mode === "tp" && v.blend < 0.01, 3000);
    const dRestored = (await getOrbit(pageA)).distance;
    log.wheelOut = { mode: viewTp.mode, distance: dRestored, d0 };
    if (viewTp.mode !== "tp") failures.push("A did not return to TP on wheel-out");
    if (Math.abs(dRestored - d0) > 0.3) failures.push(`A TP distance not restored (${dRestored} vs ${d0})`);
    const visRestored = await pollUntil(() => getSelfVisible(pageA), (v) => v === true, 3000);
    if (visRestored !== true) failures.push("A own avatar not restored on exit to TP");
    await shot(pageA, "06-A-tp-restored.png");

    // ── A wheel-in through minDistance → FP (wheel path); then V → TP. ──
    for (let i = 0; i < 12 && (await getView(pageA)).mode !== "fp"; i++) await wheel(pageA, -120, 1);
    log.wheelInToFp = (await getView(pageA)).mode;
    if (log.wheelInToFp !== "fp") failures.push("A did not reach FP by wheeling in through min");
    await shot(pageA, "07-A-wheel-fp.png");
    await pressV(pageA);
    const viewBackTp = await pollUntil(() => getView(pageA), (v) => v.mode === "tp", 3000);
    log.vBackToTp = viewBackTp.mode;
    if (viewBackTp.mode !== "tp") failures.push("A did not return to TP on V");
    if ((await pollUntil(() => getSelfVisible(pageA), (v) => v === true, 3000)) !== true) {
      failures.push("A own avatar not restored after wheel-FP → V");
    }

    // ── A walks to the maze doorway, enters FP → camera at eye height. ──
    // Route around the lounge furniture cluster on z ≈ 0 (coffee table at x=-22,
    // long sofa at x=-26): slide north to a clear z=2 lane, run west past the
    // furniture, then angle down to z=0 to pass through the maze east entrance.
    await walkTo(pageA, -15, 2, { timeout: 8000 });
    await walkTo(pageA, -27, 2, { timeout: 16000 });
    await walkTo(pageA, -29, 0, { timeout: 10000 }); // align to z=0 (entrance gap ±1.2) west of the sofa
    const atMaze = await walkTo(pageA, -34, 0, { timeout: 16000, tol: 0.5 }); // drive west through the door
    log.mazeWalk = atMaze;
    if (atMaze.x > -29.8) failures.push(`A did not reach the maze doorway (x=${atMaze.x.toFixed(2)}, z=${atMaze.z.toFixed(2)})`);
    await pressV(pageA);
    await pollUntil(() => getView(pageA), (v) => v.mode === "fp" && v.blend > 0.99, 4000);
    const camMaze = await pollUntil(() => getCamera(pageA), (c) => c.mode === "fp" && c.blend > 0.99, 4000);
    const inMaze = await pageA.evaluate((p) => p.x >= -66 && p.x <= -30 && p.z >= -18 && p.z <= 18, atMaze);
    log.mazeFp = { camY: camMaze.y, mode: camMaze.mode, inMaze };
    if (!(camMaze.y > 1.3 && camMaze.y < 1.9)) {
      failures.push(`A FP camera in maze not at eye height (y=${camMaze.y.toFixed(2)}, cap should be inert)`);
    }
    await shot(pageA, "08-A-fp-maze.png");
    await pressV(pageA); // back to TP (tidy)

    // ─────────────────────────── MOBILE (iPhone 14) ───────────────────────────
    const mCtx = await browser.newContext({ ...devices["iPhone 14"], viewport: { width: 390, height: 844 } });
    const mPage = await mCtx.newPage();
    allErrors.push(watchErrors(mPage, "mobile"));
    await joinAs(mPage, { nickname: "모바일뷰", characterLabel: "왕", tintIndex: 1 });
    await mPage.bringToFront();

    const viewBtn = mPage.locator(".cv-view-btn");
    log.mobileButtonVisible = await viewBtn.isVisible();
    if (!log.mobileButtonVisible) failures.push("mobile: 👁 view-toggle button not visible");
    log.mobileButtonAria = await viewBtn.getAttribute("aria-label");

    // 👁 → FP: own avatar hidden.
    await viewBtn.click();
    const mViewFp = await pollUntil(() => getView(mPage), (v) => v.mode === "fp" && v.blend > 0.99, 4000);
    const mHidden = await pollUntil(() => getSelfVisible(mPage), (v) => v === false, 3000);
    log.mobileFp = { mode: mViewFp.mode, selfVisible: mHidden };
    if (mViewFp.mode !== "fp") failures.push("mobile: 👁 button did not enter FP");
    if (mHidden !== false) failures.push("mobile: own avatar visible in FP");
    await shot(mPage, "09-mobile-fp.png");

    // Joystick still moves the avatar in FP.
    const mPos0 = await getPos(mPage);
    await driveJoystick(mPage, { dx: 0, dy: -46, holdMs: 750 });
    await sleep(150);
    const mPos1 = await getPos(mPage);
    log.mobileJoystick = { moved: Math.hypot(mPos1.x - mPos0.x, mPos1.z - mPos0.z) };
    if (log.mobileJoystick.moved < 0.15) failures.push("mobile: joystick did not move the avatar in FP");

    // Pinch-out → back to TP.
    await pinchTogether(mPage);
    const mViewTp = await pollUntil(() => getView(mPage), (v) => v.mode === "tp", 3000);
    log.mobilePinchOut = mViewTp.mode;
    if (mViewTp.mode !== "tp") failures.push("mobile: pinch-out did not return to TP");
    await shot(mPage, "10-mobile-tp.png");

    // ── Zero console/page errors across every tab. ──
    const errs = allErrors.flat();
    log.errors = errs;
    if (errs.length) failures.push(`console/page errors:\n  ${errs.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("start:", JSON.stringify(log.start));
  console.log("FP enter (own hidden):", JSON.stringify(log.fpEnter), "selfHidden:", log.selfHiddenInFp);
  console.log("B sees A royal before/after:", log.bSeesKingBefore, "/", log.bStillSeesKing);
  console.log("FP walk:", JSON.stringify(log.fpWalk));
  console.log("FP look (Δfp / Δorbit):", JSON.stringify(log.fpLook));
  console.log("wheel-out restore:", JSON.stringify(log.wheelOut));
  console.log("wheel-in→FP:", log.wheelInToFp, " V→TP:", log.vBackToTp);
  console.log("maze FP:", JSON.stringify(log.mazeFp));
  console.log("mobile FP:", JSON.stringify(log.mobileFp), "joystick:", JSON.stringify(log.mobileJoystick), "pinchOut:", log.mobilePinchOut);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — first-person toggle: own avatar hidden, remotes intact, all four toggle paths, maze eye-height.");
}

main();
