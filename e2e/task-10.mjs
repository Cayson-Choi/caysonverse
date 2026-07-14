// Task 10 E2E smoke: 모바일 — 가상 조이스틱 + 터치 카메라 + 저사양 프로파일.
//
// Standalone Playwright (same shape as task-05..09.mjs). Two contexts in one
// browser exercise the mobile experience and prove the desktop path is intact:
//
//   MOBILE (iPhone 14 emulation: 390x844, hasTouch → maxTouchPoints > 0):
//     1. Entry screen renders at phone size → screenshot → join.
//     2. The virtual joystick is visible bottom-left → screenshot.
//     3. Drive the joystick (synthetic PointerEvents over its zone, forward push)
//        → window.__cv.getPos() moves. Then release → intent recentres.
//     4. Drag one finger OUTSIDE the zone on the canvas → the camera yaw rotates
//        (window.__cv.getOrbit().yaw changes). Before/after screenshots.
//     5. No joystick pointer ever rotated the camera (checked in step 3: yaw held
//        while the stick moved the avatar).
//
//   DESKTOP (1280x800, no touch): regression — no joystick is rendered, and
//   WASD still walks the avatar (window.__cv.getPos() moves).
//
// No console/page errors on any page. Requires the dev servers (client :5173,
// server :2567). Exit 0 = pass. Evidence + assertions.json → evidence/task-10/.

import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-10");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${tag}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return errors;
}

/** Fill the entry form on the current entry screen and submit. */
async function fillEntry(page, { nickname, characterLabel, tintIndex }) {
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
}

/** Navigate + join, waiting until in-world (the dev hook + canvas are present). */
async function joinAs(page, opts) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await fillEntry(page, opts);
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
  await sleep(400); // let the first frames settle
}

/**
 * Drive the virtual joystick via synthetic PointerEvents (nipplejs binds pointer
 * events in Chromium). pointerdown on the zone, one pointermove offset by
 * (dx,dy) on document, hold, then pointerup. Returns nothing; caller reads pos.
 */
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
  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1,
        pointerType: "touch",
        isPrimary: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

/** One-finger drag on the canvas OUTSIDE the joystick zone (camera rotate). */
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
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.5));
      canvas.dispatchEvent(mk("pointermove", fromX + dx));
      window.dispatchEvent(mk("pointerup", fromX + dx));
    },
    { fromX, fromY, dx },
  );
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
    // ─────────────────────────── MOBILE ───────────────────────────
    // iPhone 14 emulation (hasTouch → maxTouchPoints > 0), viewport pinned to the
    // brief's 390×844 (the device descriptor otherwise trims height for chrome).
    const mobileCtx = await browser.newContext({
      ...devices["iPhone 14"],
      viewport: { width: 390, height: 844 },
    });
    const mPage = await mobileCtx.newPage();
    allErrors.push(watchErrors(mPage, "mobile"));

    // Step 1: entry screen at phone size → screenshot → join.
    await mPage.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
    await mPage.locator(".cv-entry").waitFor({ state: "visible", timeout: 20000 });
    log.mobileViewport = mPage.viewportSize();
    log.maxTouchPoints = await mPage.evaluate(() => navigator.maxTouchPoints);
    await shot(mPage, "01-mobile-entry.png");
    await fillEntry(mPage, { nickname: "모바일", characterLabel: "기사", tintIndex: 2 });
    await mPage.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
      timeout: 45000,
    });
    await mPage.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
    await sleep(500);

    // Step 2: joystick visible bottom-left.
    log.joystickVisible = await mPage.locator(".cv-joystick-zone").isVisible();
    if (!log.joystickVisible) failures.push("mobile: joystick zone not visible");
    // nipplejs injects its own collection element into the zone → confirm it mounted.
    log.nippleMounted = await mPage.evaluate(
      () => !!document.querySelector(".cv-joystick-zone .nipple, .cv-joystick-zone > *"),
    );
    await shot(mPage, "02-mobile-joystick.png");

    // Step 3: drive the joystick forward → the avatar moves; camera yaw must NOT
    // change from a stick touch.
    const posBefore = await getPos(mPage);
    const yawBeforeStick = (await getOrbit(mPage)).yaw;
    await driveJoystick(mPage, { dx: 0, dy: -46, holdMs: 750 });
    await sleep(150);
    const posAfter = await getPos(mPage);
    const yawAfterStick = (await getOrbit(mPage)).yaw;
    log.joystickMove = { posBefore, posAfter, moved: dist2(posBefore, posAfter) };
    log.yawUnchangedByStick = Math.abs(yawAfterStick - yawBeforeStick);
    if (dist2(posBefore, posAfter) < 0.15) {
      failures.push(`mobile: joystick did not move the avatar (Δ=${dist2(posBefore, posAfter)})`);
    }
    if (Math.abs(yawAfterStick - yawBeforeStick) > 0.02) {
      failures.push("mobile: a joystick touch rotated the camera (should not)");
    }

    // Step 4: one-finger drag on the canvas OUTSIDE the zone rotates the camera.
    const orbitBefore = await getOrbit(mPage);
    await shot(mPage, "03-mobile-camera-before.png");
    await dragCanvas(mPage, { fromX: 195, fromY: 300, dx: 130 });
    await sleep(200);
    const orbitAfter = await getOrbit(mPage);
    await shot(mPage, "04-mobile-camera-after.png");
    log.cameraDrag = { yawBefore: orbitBefore.yaw, yawAfter: orbitAfter.yaw };
    if (Math.abs(orbitAfter.yaw - orbitBefore.yaw) < 0.1) {
      failures.push(
        `mobile: canvas drag did not rotate the camera (Δyaw=${Math.abs(
          orbitAfter.yaw - orbitBefore.yaw,
        )})`,
      );
    }

    // Step 4b: two-finger pinch on the canvas zooms within the clamp range.
    const distBefore = (await getOrbit(mPage)).distance;
    await mPage.evaluate(() => {
      const canvas = document.querySelector(".cv-canvas canvas");
      const mk = (type, id, x) =>
        new PointerEvent(type, {
          pointerId: id,
          pointerType: "touch",
          isPrimary: id === 10,
          clientX: x,
          clientY: 300,
          bubbles: true,
          cancelable: true,
        });
      // Two fingers start close, then spread apart → zoom IN (distance shrinks).
      canvas.dispatchEvent(mk("pointerdown", 10, 160));
      canvas.dispatchEvent(mk("pointerdown", 11, 230));
      canvas.dispatchEvent(mk("pointermove", 10, 110));
      canvas.dispatchEvent(mk("pointermove", 11, 280));
      window.dispatchEvent(mk("pointerup", 10, 110));
      window.dispatchEvent(mk("pointerup", 11, 280));
    });
    await sleep(150);
    const distAfter = (await getOrbit(mPage)).distance;
    log.pinchZoom = { distBefore, distAfter };
    if (!(distAfter < distBefore - 0.1)) {
      failures.push(
        `mobile: pinch-spread did not zoom in (distance ${distBefore} → ${distAfter})`,
      );
    }

    // Step 5: mobile chat — the input is usable and the log opens as a bottom
    // sheet (default-collapsed on touch).
    await mPage.locator(".cv-chat-field").fill("모바일 테스트");
    await mPage.locator(".cv-chat-field").press("Enter");
    await sleep(500);
    await mPage.locator(".cv-chat-toggle").click();
    await sleep(300);
    log.chatSheetVisible = await mPage.locator(".cv-chat-log.is-touch .cv-chat-rows").isVisible();
    if (!log.chatSheetVisible) failures.push("mobile: chat log did not open as a bottom sheet");
    await shot(mPage, "05-mobile-chat-sheet.png");

    await mobileCtx.close();

    // ─────────────────────────── DESKTOP ──────────────────────────
    const deskCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dPage = await deskCtx.newPage();
    allErrors.push(watchErrors(dPage, "desktop"));
    await joinAs(dPage, { nickname: "데스크탑", characterLabel: "마법사", tintIndex: 3 });

    // No joystick on a non-touch device.
    log.desktopJoystickCount = await dPage.locator(".cv-joystick-zone").count();
    if (log.desktopJoystickCount !== 0) failures.push("desktop: joystick should NOT render");
    log.desktopMaxTouchPoints = await dPage.evaluate(() => navigator.maxTouchPoints);

    // WASD still walks the avatar.
    const dPosBefore = await getPos(dPage);
    await dPage.keyboard.down("KeyW");
    await sleep(700);
    await dPage.keyboard.up("KeyW");
    await sleep(150);
    const dPosAfter = await getPos(dPage);
    log.wasdMove = { dPosBefore, dPosAfter, moved: dist2(dPosBefore, dPosAfter) };
    if (dist2(dPosBefore, dPosAfter) < 0.15) {
      failures.push(`desktop: WASD did not move the avatar (Δ=${dist2(dPosBefore, dPosAfter)})`);
    }
    await shot(dPage, "06-desktop-regression.png");

    await deskCtx.close();

    // No console/page errors anywhere.
    const flat = allErrors.flat();
    log.errors = flat;
    if (flat.length) failures.push(`console/page errors:\n  ${flat.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("mobile viewport:", JSON.stringify(log.mobileViewport), "maxTouchPoints:", log.maxTouchPoints);
  console.log("joystick visible (want true):", log.joystickVisible);
  console.log("joystick moved avatar (want >=0.15):", log.joystickMove && log.joystickMove.moved.toFixed(3));
  console.log("yaw unchanged by stick (want ~0):", log.yawUnchangedByStick?.toFixed(4));
  console.log("camera drag Δyaw (want >=0.1):", log.cameraDrag && Math.abs(log.cameraDrag.yawAfter - log.cameraDrag.yawBefore).toFixed(3));
  console.log("pinch zoom distance (want smaller):", log.pinchZoom && `${log.pinchZoom.distBefore.toFixed(2)} → ${log.pinchZoom.distAfter.toFixed(2)}`);
  console.log("mobile chat bottom-sheet opened (want true):", log.chatSheetVisible);
  console.log("desktop joystick count (want 0):", log.desktopJoystickCount);
  console.log("desktop WASD moved (want >=0.15):", log.wasdMove && log.wasdMove.moved.toFixed(3));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — joystick moves the avatar (no stick-rotate), touch-drag rotates the camera, desktop WASD intact.");
}

main();
