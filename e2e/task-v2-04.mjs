// v2 Task 4 E2E: 강의실 의자 방향 정정 + 학생석 20석 확장.
//
// Standalone Playwright (same shape as task-v2-01.mjs). One tab, one context,
// against the ISOLATED dev stack (client :5175, server :2569). Deterministic
// keyboard navigation steered by window.__cv.getPos (camera at yaw 0 → d/a = ±X,
// s/w = ±Z; the screen sits at +X, i.e. to the RIGHT of the fixed camera view).
//
// Proves three things the owner asked for:
//   1. CHAIR ORIENTATION — after the 12→20 grid rebuild the student chairs face
//      the screen (seat toward +X, backrest west). Screenshots 01/02/03 are the
//      human guard; the seated-yaw assertion (≈ +PI/2) is the automated one.
//   2. NEW BACK SEAT — a player walks to and sits on seat 17 (row x=19, a seat that
//      only exists in the 20-seat grid, index ≥ 13) → seatIndex 17, snapped to the
//      chair centre facing the screen.
//   3. CENTRAL AISLE — the door→screen corridor at z ≈ 0 survives the 5-column
//      layout: the avatar walks a straight line east along z = 0 deep into the hall.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5175";

// SEATS[17] (derived in shared/worldMap): row x=19 (front, nearest the screen),
// column z=-3. Chair at (17.7, -3), dismount at (16.8, -3), seated facing +X ⇒
// player-yaw +PI/2. Index 17 ≥ 13 ⇒ a seat that only the 20-seat grid adds.
const SEAT_INDEX = 17;
const SEAT = { x: 17.7, z: -3 };
const STAND = { x: 16.8, z: -3 };
const SEAT_YAW = Math.PI / 2;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-04");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${tag}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return errors;
}

async function joinAs(page, { nickname }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character").first().click(); // pick by index (label-agnostic)
  await page.getByLabel("색상 1").click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
}

/** Poll until `predicate(value)` or timeout; returns the last value. */
async function pollUntil(read, predicate, timeoutMs = 6000, stepMs = 120) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/**
 * Steer the avatar to (tx,tz) by holding d/a (±X) and s/w (±Z) toward it,
 * re-deciding every poll from getPos. Camera yaw stays 0 (we never drag), so the
 * key→axis mapping is fixed. Releases all keys on arrival/timeout.
 */
async function walkTo(page, tx, tz, { tol = 0.4, timeout = 15000 } = {}) {
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) {
      if (!want.has(k)) {
        await page.keyboard.up(k);
        held.delete(k);
      }
    }
    for (const k of want) {
      if (!held.has(k)) {
        await page.keyboard.down(k);
        held.add(k);
      }
    }
  };
  const deadline = Date.now() + timeout;
  try {
    while (Date.now() < deadline) {
      const p = await getPos(page);
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) <= tol) break;
      const want = new Set();
      if (dx > tol / 2) want.add("d");
      else if (dx < -tol / 2) want.add("a");
      if (dz > tol / 2) want.add("s");
      else if (dz < -tol / 2) want.add("w");
      await press(want);
      await sleep(55);
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
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = watchErrors(page, "학생");

  const failures = [];
  const log = {};
  try {
    await joinAs(page, { nickname: "학생하나" });
    await page.locator("canvas").click(); // focus for keyboard; no drag → yaw stays 0

    // ── Step 1: walk the central aisle door→screen (z ≈ 0) into the hall. ──
    await walkTo(page, -2, 0, { timeout: 12000 }); // approach the door (lounge side)
    await walkTo(page, 2, 0, { timeout: 12000 }); // through the door into the hall
    await shot(page, "01-hall-entry-chairs-overview.png"); // rows ahead; screen at right
    // A straight eastbound walk along z = 0 must reach deep into the hall — proving
    // no student column blocks the central corridor (instructor set at x≈25 stops us).
    const aisleEnd = await walkTo(page, 21, 0, { timeout: 14000 });
    log.aisleEnd = aisleEnd;
    if (!(aisleEnd.x >= 18 && Math.abs(aisleEnd.z) < 1.0)) {
      failures.push(`central aisle not walkable to the front: ended ${JSON.stringify(aisleEnd)}`);
    }
    await shot(page, "02-aisle-walkthrough-front.png"); // near the front, chairs both sides

    // ── Step 2: approach the new back-row seat's dismount from the aisle. ──
    await walkTo(page, STAND.x, 0, { timeout: 12000 }); // slide west along the aisle to the seat's x
    const nearSeat = await walkTo(page, STAND.x, STAND.z, { timeout: 12000 }); // south into the row gap
    log.nearSeat = nearSeat;
    await shot(page, "03-beside-seat-chair-profile.png"); // chair in profile: seat faces +X (right)

    // The desktop "E 앉기" hint must be showing (proximity within reach).
    const hint = page.locator(".cv-sit-hint");
    await hint.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    log.hintText = (await hint.textContent().catch(() => null))?.trim() ?? null;
    if (!log.hintText || !log.hintText.includes("앉기")) {
      failures.push(`desktop sit hint not shown near the seat (got ${JSON.stringify(log.hintText)})`);
    }

    // ── Step 3: press E → sit on the new seat, snapped + facing the screen. ──
    await page.keyboard.press("e");
    const seated = await pollUntil(
      () => getPos(page),
      (p) => p.seatIndex === SEAT_INDEX && Math.hypot(p.x - SEAT.x, p.z - SEAT.z) < 0.1,
      6000,
    );
    log.seated = seated;
    if (seated.seatIndex !== SEAT_INDEX) {
      failures.push(`did not sit on the new seat: seatIndex=${seated.seatIndex} (want ${SEAT_INDEX})`);
    }
    if (Math.hypot(seated.x - SEAT.x, seated.z - SEAT.z) > 0.1) {
      failures.push(`local pose not snapped to the seat: ${JSON.stringify(seated)} vs ${JSON.stringify(SEAT)}`);
    }
    if (Math.abs(seated.yaw - SEAT_YAW) > 0.05) {
      failures.push(`seated yaw ${seated.yaw} not facing the screen (want ≈ ${SEAT_YAW})`);
    }
    await sleep(300);
    await shot(page, "04-seated-facing-screen.png"); // player in the chair, facing +X screen

    // ── Step 4: stand back up (hold W) → seat freed, near the dismount point. ──
    await page.locator("canvas").click();
    await page.keyboard.down("w");
    await pollUntil(() => getPos(page), (p) => p.seatIndex === -1, 6000);
    await page.keyboard.up("w");
    await sleep(150);
    const stood = await getPos(page);
    log.stood = stood;
    if (stood.seatIndex !== -1) failures.push(`did not stand: seatIndex=${stood.seatIndex}`);
    const standDist = Math.hypot(stood.x - STAND.x, stood.z - STAND.z);
    log.standDist = standDist;
    if (standDist > 1.2) {
      failures.push(`did not stand near the dismount point: ${JSON.stringify(stood)} (d=${standDist.toFixed(2)})`);
    }
    await shot(page, "05-stood-back-up.png");

    // ── Step 5: zero console/page errors. ──
    if (errors.length) failures.push(`console/page errors:\n  ${errors.join("\n  ")}`);
    log.errors = errors;
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("aisle walked to:", JSON.stringify(log.aisleEnd));
  console.log("seated:", JSON.stringify(log.seated));
  console.log("stood at:", JSON.stringify(log.stood), "distFromDismount:", log.standDist);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — chairs face the screen, new back seat (17) sittable, central aisle walkable.");
}

main();
