// v2 Task 2 two-tab E2E: 캐릭터 8종 확장 — 왕실 4종 (왕·왕비·공주·왕자).
//
// Standalone Playwright (same shape as task-05..13 / task-v2-01). Verifies the
// COMPOSED royals: a crown on the `head` bone after tinting, accessory nodes
// hidden, rendered identically for self and remotes, and staying attached through
// the Sit_Chair_* animation (v2 Task 1).
//
//   0. Mobile-width (390px) entry screen: 8 character buttons, each ≥44px tall.
//   1. A joins as 왕 (barbarian body): crown on, Barbarian_Hat + Mug hidden.
//   2. B joins as 왕자 (knight body): helmet hidden → bare head + circlet.
//   3. B observes remote A as character index 4 (royal) with a crown — same
//      assembly path remotely (screenshot of B's view of A).
//   4. A walks to a student chair and sits → crown stays on through the sit anim.
//   5. Zero console/page errors on either tab.
//
// Crowns are verified by SCREENSHOT (the human guard, like v2-01's facing check);
// the character-index + hidden-node effects are asserted where programmatic.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const KING = "왕앨리스";
const PRINCE = "왕자밥";
const KING_CHAR = 4; // CHARACTERS index for 왕

// SEATS[2]: front row student chair at (7.7, 3); dismount at (6.8, 3).
const SEAT_INDEX = 2;
const SEAT = { x: 7.7, z: 3 };
const STAND = { x: 6.8, z: 3 };

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-02");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());

const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

/**
 * App-error watcher. Real JS exceptions (pageerror) and app console.errors are
 * always failures. A bare "Failed to load resource" console.error is a NETWORK
 * failure whose URL isn't in the message — we instead judge those via the network
 * events below: a same-origin (localhost) 4xx/failure (e.g. a missing crown.glb)
 * fails the test, but an EXTERNAL host failing (the production og.png behind
 * Cloudflare, which returns 522 while asleep) is environmental noise, not a
 * regression in this feature, and is ignored.
 */
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
  page.on("requestfailed", (r) => {
    if (r.url().startsWith(CLIENT_ORIGIN)) {
      errors.push(`[${tag}] local reqfail ${r.failure()?.errorText}: ${r.url()}`);
    }
  });
  return errors;
}

async function joinAs(page, { nickname, characterLabel, tintIndex }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").fill(nickname);
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
}

async function pollUntil(read, predicate, timeoutMs = 8000, stepMs = 120) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Zoom the follow camera IN by scrolling the wheel over the canvas centre. */
async function zoomIn(page, steps = 30) {
  const box = await page.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  for (let i = 0; i < steps; i++) await page.mouse.wheel(0, -120);
  await sleep(200);
}

/** Orbit the follow camera by dragging horizontally across the canvas (rad ≈ px*0.005). */
async function orbit(page, dxPx) {
  const box = await page.locator("canvas").boundingBox();
  const cy = box.y + box.height / 2;
  const startX = box.x + box.width / 2;
  await page.mouse.move(startX, cy);
  await page.mouse.down();
  const steps = 24;
  for (let i = 1; i <= steps; i++) {
    await page.mouse.move(startX + (dxPx * i) / steps, cy);
    await sleep(10);
  }
  await page.mouse.up();
  await sleep(200);
}

/**
 * Steer to world (tx,tz). Movement is camera-relative, so we read the live camera
 * yaw each poll and project the desired world direction onto camera-forward
 * (w/s) and camera-right (d/a) — robust to any prior orbit (no "yaw must be 0"
 * assumption). Camera-forward F=(-sinφ,-cosφ), right R=(cosφ,-sinφ) per input.ts.
 */
async function walkTo(page, tx, tz, { tol = 0.4, timeout = 15000 } = {}) {
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      const p = await getPos(page);
      const o = await page.evaluate(() => window.__cv.getOrbit());
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) <= tol) break;
      const s = Math.sin(o.yaw), c = Math.cos(o.yaw);
      const fwd = dx * -s + dz * -c; // component along camera-forward
      const rgt = dx * c + dz * -s; // component along camera-right
      const t = tol / 2;
      const want = new Set();
      if (fwd > t) want.add("w"); else if (fwd < -t) want.add("s");
      if (rgt > t) want.add("d"); else if (rgt < -t) want.add("a");
      await press(want);
      await sleep(55);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
  }
  return getPos(page);
}

/** Walk through the door (z≈0) then to the target — avoids the divider wall. */
async function walkToSeatArea(page, tx, tz) {
  await page.locator("canvas").click(); // focus for keyboard input
  await walkTo(page, -2, 0, { timeout: 12000 });
  await walkTo(page, 2, 0, { timeout: 12000 });
  return walkTo(page, tx, tz, { timeout: 12000 });
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });

  const failures = [];
  const log = {};
  try {
    // ── Step 0: mobile-width entry screen — 8 buttons, each ≥44px tall. ──
    const mobileCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const mobile = await mobileCtx.newPage();
    await mobile.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
    await mobile.locator("input.cv-input").waitFor({ state: "visible", timeout: 20000 });
    const btns = mobile.locator(".cv-character");
    await btns.first().waitFor({ state: "visible" });
    const labels = await btns.allTextContents();
    const boxes = await btns.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
    log.mobileLabels = labels;
    log.mobileButtonHeights = boxes;
    if (labels.length !== 8) failures.push(`entry grid should have 8 buttons, got ${labels.length}: ${JSON.stringify(labels)}`);
    const expectedLabels = ["기사", "바바리안", "마법사", "도적", "왕", "왕비", "공주", "왕자"];
    if (JSON.stringify(labels) !== JSON.stringify(expectedLabels)) {
      failures.push(`entry labels ${JSON.stringify(labels)} !== ${JSON.stringify(expectedLabels)}`);
    }
    const tooShort = boxes.filter((h) => h < 44);
    if (tooShort.length) failures.push(`entry buttons below 44px touch floor: ${JSON.stringify(tooShort)}`);
    await shot(mobile, "00-entry-mobile-8-grid.png");
    await mobileCtx.close();

    // ── Steps 1-5: two desktop tabs. ──
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await context.newPage();
    const pageB = await context.newPage();
    const errorsA = watchErrors(pageA, "A/왕");
    const errorsB = watchErrors(pageB, "B/왕자");

    await joinAs(pageA, { nickname: KING, characterLabel: "왕", tintIndex: 3 }); // 왕 (barbarian)
    await joinAs(pageB, { nickname: PRINCE, characterLabel: "왕자", tintIndex: 6 }); // 왕자 (knight)

    // Each observes the other; assert B sees A as a royal (character index 4).
    const remotesB = await pollUntil(
      () => getRemotes(pageB),
      (list) => list.some((r) => r.nickname === KING),
      15000,
      250,
    );
    const kingOnB = remotesB.find((r) => r.nickname === KING);
    if (!kingOnB) throw new Error("tab B never observed remote 왕");
    log.kingOnB = kingOnB;
    if (kingOnB.character !== KING_CHAR) {
      failures.push(`remote 왕 character should be ${KING_CHAR}, got ${kingOnB.character}`);
    }
    const remotesA = await pollUntil(
      () => getRemotes(pageA),
      (list) => list.some((r) => r.nickname === PRINCE),
      15000,
      250,
    );
    if (!remotesA.some((r) => r.nickname === PRINCE)) throw new Error("tab A never observed remote 왕자");

    // ── Step 1: 왕's own avatar — crown on, hat + mug gone (zoom + orbit). ──
    await pageA.locator("canvas").click();
    await zoomIn(pageA, 30);
    await shot(pageA, "01-tabA-king-back.png");
    await orbit(pageA, 620); // ~180° → face the front
    await shot(pageA, "02-tabA-king-front.png");
    await orbit(pageA, -300); // ~3/4 side
    await shot(pageA, "03-tabA-king-threequarter.png");

    // ── Step 2: 왕자's own avatar — bare head + circlet, no helmet. ──
    await pageB.locator("canvas").click();
    await zoomIn(pageB, 30);
    await shot(pageB, "04-tabB-prince-back.png");
    await orbit(pageB, 620);
    await shot(pageB, "05-tabB-prince-front.png");

    // ── Step 3: B walks next to A, orbits, and screenshots the REMOTE 왕's crown. ──
    // Reset B's zoom out a bit first so both fit, then approach A.
    await pageB.mouse.move(640, 400);
    for (let i = 0; i < 12; i++) await pageB.mouse.wheel(0, 120); // zoom back out
    const aPos = await getPos(pageA);
    await pageB.locator("canvas").click();
    await walkTo(pageB, aPos.x - 1.4, aPos.z, { timeout: 15000, tol: 0.5 });
    await sleep(400);
    await zoomIn(pageB, 14);
    await shot(pageB, "06-tabB-sees-remote-king.png");

    // ── Step 4: 왕 sits on a student chair; crown stays on through the sit anim. ──
    await pageA.mouse.move(640, 400);
    for (let i = 0; i < 30; i++) await pageA.mouse.wheel(0, 120); // zoom back out for the walk
    const aArrived = await walkToSeatArea(pageA, STAND.x, STAND.z);
    log.aArrived = aArrived;
    const hint = pageA.locator(".cv-sit-hint");
    await hint.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    await pageA.keyboard.press("e");
    const aSeated = await pollUntil(
      () => getPos(pageA),
      (p) => p.seatIndex === SEAT_INDEX && Math.hypot(p.x - SEAT.x, p.z - SEAT.z) < 0.1,
      6000,
    );
    log.aSeated = aSeated;
    if (aSeated.seatIndex !== SEAT_INDEX) failures.push(`왕 did not sit: seatIndex=${aSeated.seatIndex}`);
    await sleep(600); // let the sit-down clip settle into the held seated pose
    await zoomIn(pageA, 26);
    await shot(pageA, "07-tabA-king-seated-back.png");
    await orbit(pageA, 620);
    await shot(pageA, "08-tabA-king-seated-front.png");
    // B sees A seated (remote crown stays on through the seated pose).
    const bSeesSeated = await pollUntil(
      () => getRemotes(pageB),
      (list) => list.some((r) => r.nickname === KING && r.seatIndex === SEAT_INDEX),
      6000,
    );
    log.bSeesSeated = bSeesSeated.find((r) => r.nickname === KING);
    await shot(pageB, "09-tabB-sees-king-seated.png");

    // ── Step 5: zero console/page errors on either tab. ──
    const allErrors = [...errorsA, ...errorsB];
    if (allErrors.length) failures.push(`console/page errors:\n  ${allErrors.join("\n  ")}`);
    log.errors = allErrors;
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("mobile labels:", JSON.stringify(log.mobileLabels));
  console.log("mobile button heights:", JSON.stringify(log.mobileButtonHeights));
  console.log("B sees remote 왕:", JSON.stringify(log.kingOnB));
  console.log("왕 seated:", JSON.stringify(log.aSeated));
  console.log("B sees 왕 seated:", JSON.stringify(log.bSeesSeated));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — 8-preset grid, royals composed with crowns, seated crown stays attached.");
}

main();
