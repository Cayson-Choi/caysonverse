// Task 7 two-tab E2E smoke: 말풍선 채팅 (speech-bubble chat).
//
// Standalone Playwright fallback (same shape as task-05/06.mjs). Two tabs in one
// context:
//   1. A(앨리스) + B(밥이) join. B sends `안녕하세요!` → tab A shows a speech
//      bubble over 밥이's avatar (asserted via window.__cv.getBubbles()) and a
//      log row `[밥이] 안녕하세요!`.
//   2. After the rate window clears, B sends 4 messages rapidly → the 4th is
//      rejected: B shows a dimmed system row (너무 빨라요…) and tab A received
//      only 3 of the 4 (asserted via the chat-log rows).
//   3. Focus tab A's chat input and hold `w` 0.5s → window.__cv.getPos() is
//      unchanged (focus guard). A control run first proves the keyboard path is
//      live (moves when NOT captured), so the no-move is the guard, not a dud.
//   4. Screenshots → .superpowers/sdd/evidence/task-07/. No console errors.
//
// The brief names B "밥"; NICKNAME_MIN is 2, so (as in task-05) we use "밥이",
// which keeps the same identity. Requires the dev servers (client :5173,
// server :2567). Exit code 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const BOB = "밥이";
const HELLO = "안녕하세요!";
const RAPID = ["빠른메시지0", "빠른메시지1", "빠른메시지2", "빠른메시지3"];
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-07");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getBubbles = (page) => page.evaluate(() => window.__cv.getBubbles());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const poseDelta = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + Math.abs(a.yaw - b.yaw);

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

/** Type `text` into the chat bar and send it (fill avoids the IME path). */
async function sendChat(page, text) {
  const field = page.locator(".cv-chat-field");
  await field.click();
  await field.fill(text);
  await field.press("Enter");
}

/** All non-system chat-log row texts. */
function messageRows(page) {
  return page.locator(".cv-chat-row:not(.is-system)").allTextContents();
}

/** All dimmed system-row texts. */
function systemRows(page) {
  return page.locator(".cv-chat-row.is-system").allTextContents();
}

/** Poll until `predicate(value)` or timeout; returns the last value. */
async function pollUntil(read, predicate, timeoutMs = 4000, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
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
    // Join both tabs, then wait until A sees B as a remote (so B has an avatar).
    await joinAs(pageA, { nickname: "앨리스", characterLabel: "기사", tintIndex: 5 });
    await joinAs(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });

    const remotes = await pollUntil(
      () => getRemotes(pageA),
      (list) => list.some((r) => r.nickname === BOB),
      15000,
      250,
    );
    const bob = remotes.find((r) => r.nickname === BOB);
    if (!bob) throw new Error("tab A never observed remote 밥이");
    log.bobSid = bob.sessionId;

    // ── Step 1: B sends 안녕하세요! → bubble over 밥이 + log row in tab A. ──
    await sendChat(pageB, HELLO);

    const bubbles = await pollUntil(
      () => getBubbles(pageA),
      (list) => list.some((b) => b.sid === bob.sessionId && b.text === HELLO),
      6000,
      150,
    );
    log.bubblesA = bubbles;
    const rowsA1 = await pollUntil(
      () => messageRows(pageA),
      (rows) => rows.some((t) => t.includes(BOB) && t.includes(HELLO)),
      4000,
    );
    log.helloRowInA = rowsA1.find((t) => t.includes(HELLO)) ?? null;

    if (!bubbles.some((b) => b.sid === bob.sessionId && b.text === HELLO)) {
      failures.push(`no speech bubble over 밥이 in tab A: ${JSON.stringify(bubbles)}`);
    }
    if (!rowsA1.some((t) => t.includes(BOB) && t.includes(HELLO))) {
      failures.push(`tab A log missing "[밥이] 안녕하세요!": ${JSON.stringify(rowsA1)}`);
    }
    await sleep(400); // let the bubble render for the screenshot
    await shot(pageA, "01-tabA-bubble-and-log.png");

    // ── Step 2: clear the 5s window, then 4 rapid sends → 4th rejected. ──
    await sleep(5300); // rate window is 3 per 5000ms — let it fully clear
    const beforeCount = (await messageRows(pageA)).filter((t) => t.includes("빠른메시지")).length;
    for (const text of RAPID) await sendChat(pageB, text);

    const rowsA2 = await pollUntil(
      () => messageRows(pageA),
      (rows) => rows.filter((t) => t.includes("빠른메시지")).length >= 3,
      5000,
    );
    const receivedByA = rowsA2.filter((t) => t.includes("빠른메시지")).length - beforeCount;
    log.rapidReceivedByA = receivedByA;

    const sysB = await pollUntil(
      () => systemRows(pageB),
      (rows) => rows.some((t) => t.includes("너무 빨라요")),
      4000,
    );
    log.systemRowsB = sysB;

    if (receivedByA !== 3) {
      failures.push(`tab A should receive exactly 3 of 4 rapid messages, got ${receivedByA}`);
    }
    if (!sysB.some((t) => t.includes("너무 빨라요"))) {
      failures.push(`tab B missing the rate-limit system row: ${JSON.stringify(sysB)}`);
    }
    await shot(pageB, "02-tabB-rejection.png");
    await shot(pageA, "03-tabA-received-3.png");

    // ── Step 3: focus guard. Control run proves the keyboard path is live. ──
    await pageA.locator("canvas").click(); // ensure the input is NOT focused
    const beforeMove = await getPos(pageA);
    await pageA.keyboard.down("w");
    await sleep(500);
    await pageA.keyboard.up("w");
    await sleep(150);
    const afterMove = await getPos(pageA);
    const controlDelta = poseDelta(beforeMove, afterMove);
    log.controlMoveDelta = controlDelta;
    if (!(controlDelta > 0.2)) {
      failures.push(`keyboard movement not live (control): delta=${controlDelta.toFixed(4)}`);
    }

    // Now focus the chat input and hold `w` — the guard must suppress movement.
    await pageA.locator(".cv-chat-field").click();
    const beforeGuard = await getPos(pageA);
    await pageA.keyboard.down("w");
    await sleep(500);
    await pageA.keyboard.up("w");
    await sleep(150);
    const afterGuard = await getPos(pageA);
    const guardDelta = poseDelta(beforeGuard, afterGuard);
    log.beforeGuard = beforeGuard;
    log.afterGuard = afterGuard;
    log.guardDelta = guardDelta;
    if (!(guardDelta < 1e-6)) {
      failures.push(`focus guard failed — player moved while typing: delta=${guardDelta}`);
    }
    await pageA.keyboard.press("Escape"); // blur the input
    await shot(pageA, "04-tabA-focus-guard.png");

    // ── Step 4: no console/page errors on either tab. ──
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

  console.log("bubble over 밥이 in A:", JSON.stringify(log.bubblesA));
  console.log("hello row in A:", JSON.stringify(log.helloRowInA));
  console.log("rapid received by A (want 3):", log.rapidReceivedByA);
  console.log("B system rows:", JSON.stringify(log.systemRowsB));
  console.log("control move delta (want > 0.2):", log.controlMoveDelta);
  console.log("guard delta (want ~0):", log.guardDelta);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — bubble + log relayed, 4th message rate-rejected, focus guard holds.");
}

main();
