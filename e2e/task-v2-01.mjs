// v2 Task 1 two-tab E2E: 강의실 의자 앉기/일어서기 (sit / stand / occupancy race).
//
// Standalone Playwright (same shape as task-05..13.mjs). Two tabs, one context,
// against the dev servers (client :5173, server :2567). Deterministic keyboard
// navigation steered by window.__cv.getPos coordinates (camera stays at yaw 0 →
// d/a = +/-X, s/w = +/-Z).
//
//   1. A walks to the nearest student chair (seat 8 = 2nd row from the door, +z),
//      the desktop "E 앉기" hint appears, A presses E → A.seatIndex === 8, snapped
//      centre facing the screen (yaw ≈ +PI/2). B sees remote A seated at the seat.
//   2. B walks within reach of the SAME seat and forces a Sit on it (the prompt UI
//      hides taken seats, so the __cv.sit dev hook drives the race deterministically)
//      → B gets the "이미 사용 중인 자리예요" system row and stays unseated.
//   3. A holds W → A stands (seatIndex -1, ≈ its dismount point) and can walk; then
//      B sits on the now-free seat (SEAT_INDEX, currently 8 in the 20-seat grid).
//   4. Screenshots at each step; zero console/page errors; dev processes untouched
//      (started/killed by the caller).
//
// The screenshots are the human guard against a BACKWARDS-facing sit; the yaw
// assertion (≈ +PI/2) is the automated one. NICKNAME_MIN is 2 so B is "밥이".

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const ALICE = "앨리스";
const BOB = "밥이";

// SEATS[8] (derived in shared/worldMap, 20-seat grid): 2nd row from the door,
// chair at (7.7, 3), dismount at (6.8, 3), seated facing the screen (+X) ⇒
// player-yaw +PI/2. (This same (7.7, 3) chair was seat 2 in the old 12-seat grid.)
const SEAT_INDEX = 8;
const SEAT = { x: 7.7, z: 3 };
const STAND = { x: 6.8, z: 3 };
const SEAT_YAW = Math.PI / 2;
const OCCUPIED_NOTICE = "이미 사용 중인 자리예요";

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-01");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${tag}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return errors;
}

async function joinAs(page, { nickname, characterLabel, tintIndex }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
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
 * Steer the avatar to (tx,tz) by holding d/a (+/-X) and s/w (+/-Z) toward it,
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

/** Walk through the door (z≈0) then to the target — avoids the divider wall. */
async function walkToSeatArea(page, tx, tz) {
  await page.locator("canvas").click(); // focus for keyboard; no drag → yaw stays 0
  await walkTo(page, -2, 0, { timeout: 12000 });
  await walkTo(page, 2, 0, { timeout: 12000 });
  return walkTo(page, tx, tz, { timeout: 12000 });
}

/** The local user's system chat rows (dimmed personal notices). */
function systemRows(page) {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll(".cv-chat-row.is-system")).map((el) => el.textContent),
  );
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const errorsA = watchErrors(pageA, "A/앨리스");
  const errorsB = watchErrors(pageB, "B/밥이");

  const failures = [];
  const log = {};
  try {
    await joinAs(pageA, { nickname: ALICE, characterLabel: "기사", tintIndex: 5 });
    await joinAs(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });

    // Each observes the other as a remote before we begin.
    const remotesA = await pollUntil(
      () => getRemotes(pageA),
      (list) => list.some((r) => r.nickname === BOB),
      15000,
      250,
    );
    const bob = remotesA.find((r) => r.nickname === BOB);
    if (!bob) throw new Error("tab A never observed remote 밥이");
    const remotesB = await pollUntil(
      () => getRemotes(pageB),
      (list) => list.some((r) => r.nickname === ALICE),
      15000,
      250,
    );
    const alice = remotesB.find((r) => r.nickname === ALICE);
    if (!alice) throw new Error("tab B never observed remote 앨리스");
    log.aliceSid = alice.sessionId;
    log.bobSid = bob.sessionId;

    // ── Step 1: A walks to the seat, the hint appears, presses E → seated. ──
    const aArrived = await walkToSeatArea(pageA, STAND.x, STAND.z);
    log.aArrived = aArrived;
    // The desktop "E 앉기" hint must be showing (proximity within reach).
    const hint = pageA.locator(".cv-sit-hint");
    await hint.waitFor({ state: "visible", timeout: 4000 }).catch(() => {});
    log.hintText = (await hint.textContent().catch(() => null))?.trim() ?? null;
    if (!log.hintText || !log.hintText.includes("앉기")) {
      failures.push(`desktop sit hint not shown near the seat (got ${JSON.stringify(log.hintText)})`);
    }

    await pageA.keyboard.press("e"); // real E-key path (KeyE), honoring uiCapture
    // Wait for the LOCAL pose to actually snap onto the seat (one rAF after the
    // seatIndex decodes) — this proves the client isn't left 1 m off the chair.
    const aSeated = await pollUntil(
      () => getPos(pageA),
      (p) => p.seatIndex === SEAT_INDEX && Math.hypot(p.x - SEAT.x, p.z - SEAT.z) < 0.1,
      6000,
    );
    log.aSeated = aSeated;
    if (aSeated.seatIndex !== SEAT_INDEX) {
      failures.push(`A did not sit: seatIndex=${aSeated.seatIndex} (want ${SEAT_INDEX})`);
    }
    // Snapped to the seat centre, facing the screen (+X ⇒ yaw ≈ +PI/2).
    if (Math.hypot(aSeated.x - SEAT.x, aSeated.z - SEAT.z) > 0.1) {
      failures.push(`A local pose not snapped to the seat: ${JSON.stringify(aSeated)} vs ${JSON.stringify(SEAT)}`);
    }
    if (Math.abs(aSeated.yaw - SEAT_YAW) > 0.05) {
      failures.push(`A seated yaw ${aSeated.yaw} not facing the screen (want ≈ ${SEAT_YAW})`);
    }
    // B sees remote A seated AT the seat.
    const bViewOfA = await pollUntil(
      () => getRemotes(pageB),
      (list) => list.some((r) => r.sessionId === alice.sessionId && r.seatIndex === SEAT_INDEX),
      6000,
    );
    const aOnB = bViewOfA.find((r) => r.sessionId === alice.sessionId);
    log.aOnB = aOnB;
    if (!aOnB || aOnB.seatIndex !== SEAT_INDEX) {
      failures.push(`B never saw A seated: ${JSON.stringify(aOnB)}`);
    } else if (Math.hypot(aOnB.x - SEAT.x, aOnB.z - SEAT.z) > 0.3) {
      failures.push(`B sees A off the seat: ${JSON.stringify(aOnB)}`);
    }
    await sleep(300);
    await shot(pageA, "01-tabA-seated-facing-screen.png");
    await shot(pageB, "02-tabB-sees-A-seated.png");

    // ── Step 2: B walks within reach and forces a Sit on the taken seat. ──
    const bArrived = await walkToSeatArea(pageB, 6.6, 3);
    log.bArrived = bArrived;
    await pageB.evaluate((i) => window.__cv.sit(i), SEAT_INDEX);
    const rows = await pollUntil(
      () => systemRows(pageB),
      (list) => list.some((t) => t && t.includes(OCCUPIED_NOTICE)),
      6000,
    );
    log.bSystemRows = rows;
    if (!rows.some((t) => t && t.includes(OCCUPIED_NOTICE))) {
      failures.push(`B never got the occupied-seat notice: ${JSON.stringify(rows)}`);
    }
    const bStill = await getPos(pageB);
    log.bAfterReject = bStill;
    if (bStill.seatIndex !== -1) {
      failures.push(`B should still be standing after rejection: seatIndex=${bStill.seatIndex}`);
    }
    await shot(pageB, "03-tabB-occupied-rejected.png");

    // ── Step 3: A stands (holds W → movement intent), then B sits the free seat. ──
    await pageA.locator("canvas").click();
    await pageA.keyboard.down("w");
    await pollUntil(() => getPos(pageA), (p) => p.seatIndex === -1, 6000);
    await pageA.keyboard.up("w"); // release the instant the stand is confirmed
    await sleep(150); // let the local pose snap to the server dismount point
    const aStood = await getPos(pageA);
    log.aStood = aStood;
    if (aStood.seatIndex !== -1) failures.push(`A did not stand: seatIndex=${aStood.seatIndex}`);
    // Stood at (≈) the dismount point — a brief walk during the round-trip is fine.
    const standDist = Math.hypot(aStood.x - STAND.x, aStood.z - STAND.z);
    log.standDist = standDist;
    if (standDist > 1.2) {
      failures.push(`A did not stand near its dismount point: ${JSON.stringify(aStood)} (d=${standDist.toFixed(2)})`);
    }
    // …and can walk: holding W moves A a real distance.
    const beforeWalk = await getPos(pageA);
    await pageA.keyboard.down("w");
    await sleep(700);
    await pageA.keyboard.up("w");
    const afterWalk = await getPos(pageA);
    const walked = Math.hypot(afterWalk.x - beforeWalk.x, afterWalk.z - beforeWalk.z);
    log.walkedAfterStand = walked;
    if (!(walked > 0.5)) failures.push(`A could not walk after standing: moved ${walked.toFixed(2)}m`);
    await shot(pageA, "04-tabA-stood-and-walking.png");

    // B sits on the now-free seat (B is still within reach).
    await pageB.evaluate((i) => window.__cv.sit(i), SEAT_INDEX);
    const bSeated = await pollUntil(() => getPos(pageB), (p) => p.seatIndex === SEAT_INDEX, 6000);
    log.bSeated = bSeated;
    if (bSeated.seatIndex !== SEAT_INDEX) {
      failures.push(`B could not sit after A freed the seat: seatIndex=${bSeated.seatIndex}`);
    }
    await sleep(300);
    await shot(pageB, "05-tabB-sits-freed-seat.png");

    // ── Step 4: zero console/page errors on either tab. ──
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

  console.log("A seated:", JSON.stringify(log.aSeated));
  console.log("B sees A seated:", JSON.stringify(log.aOnB));
  console.log("B occupied-seat rows:", JSON.stringify(log.bSystemRows));
  console.log("A stood at:", JSON.stringify(log.aStood), "distFromDismount:", log.standDist);
  console.log("B sits freed seat:", JSON.stringify(log.bSeated));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — sit faces the screen, occupied-seat race rejected, stand frees the seat.");
}

main();
