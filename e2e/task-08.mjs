// Task 8 two-tab E2E smoke: 이모지 리액션 (emoji reactions).
//
// Standalone Playwright fallback (same shape as task-05/06/07.mjs). Two tabs in
// one context:
//   1. A(앨리스) + B(밥이) join, and each observes the other as a remote.
//   2. B clicks the 👏 palette button (index 3) -> tab A observes {sid: bob,
//      index: 3} via window.__cv.getEmojis() (the float-up sprite's data
//      source). Screenshot tab A.
//   3. Tab A's chat is unfocused (click canvas first, proving the shortcut
//      path is live) -> press `3` (shortcut for EMOJIS[2] = 😂) -> tab B
//      observes {sid: alice, index: 2}. Screenshot tab B.
//   4. That reaction is left to expire (EMOJI_DISPLAY_MS), then tab A's chat
//      input is focused -> press `3` again -> the input receives the literal
//      "3" character (typed, not a shortcut) and NO new emoji reaches tab B
//      (polled across the window instead of a single snapshot). Screenshot
//      tab A with "3" in the input.
//   5. No console/page errors on either tab.
//
// The brief names B "밥"; NICKNAME_MIN is 2, so (as in task-05/07) we use
// "밥이", which keeps the same identity. Requires the dev servers (client
// :5173, server :2567). Exit code 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const BOB = "밥이";
const ALICE = "앨리스";
// EMOJIS = ["👍","❤️","😂","👏","🎉","🙋"] — 👏 is index 3, 😂 (shortcut "3") is index 2.
const CLAP_INDEX = 3;
const LAUGH_INDEX = 2;
const EMOJI_DISPLAY_MS = 3000;
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-08");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const getEmojis = (page) => page.evaluate(() => window.__cv.getEmojis());

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
async function pollUntil(read, predicate, timeoutMs = 4000, stepMs = 150) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Sample `read()` repeatedly across `durationMs`; true if `predicate` ever failed. */
async function neverDuring(read, predicate, durationMs, stepMs = 150) {
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    const value = await read();
    if (!predicate(value)) return { ok: false, value };
    await sleep(stepMs);
  }
  return { ok: true, value: await read() };
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
    // Join both tabs, then wait until each observes the other as a remote.
    await joinAs(pageA, { nickname: ALICE, characterLabel: "기사", tintIndex: 5 });
    await joinAs(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });

    const remotesA = await pollUntil(
      () => getRemotes(pageA),
      (list) => list.some((r) => r.nickname === BOB),
      15000,
      250,
    );
    const bob = remotesA.find((r) => r.nickname === BOB);
    if (!bob) throw new Error("tab A never observed remote 밥이");
    log.bobSid = bob.sessionId;

    const remotesB = await pollUntil(
      () => getRemotes(pageB),
      (list) => list.some((r) => r.nickname === ALICE),
      15000,
      250,
    );
    const alice = remotesB.find((r) => r.nickname === ALICE);
    if (!alice) throw new Error("tab B never observed remote 앨리스");
    log.aliceSid = alice.sessionId;

    // ── Step 1: B clicks 👏 -> tab A sees {sid: bob, index: 3}. ──
    await pageB.getByLabel("👏 리액션 보내기 (단축키 4)").click();

    const emojisA = await pollUntil(
      () => getEmojis(pageA),
      (list) => list.some((e) => e.sid === bob.sessionId && e.index === CLAP_INDEX),
      6000,
      150,
    );
    log.emojisA = emojisA;
    if (!emojisA.some((e) => e.sid === bob.sessionId && e.index === CLAP_INDEX)) {
      failures.push(`tab A never observed 👏 over 밥이: ${JSON.stringify(emojisA)}`);
    }
    await sleep(200); // let the sprite render for the screenshot
    await shot(pageA, "01-tabA-clap-over-bob.png");

    // ── Step 2: focus guard control — tab A chat unfocused, press `3`. ──
    await pageA.locator("canvas").click(); // ensure the chat input is NOT focused
    await pageA.keyboard.press("3"); // shortcut for EMOJIS[2] = 😂

    const emojisB = await pollUntil(
      () => getEmojis(pageB),
      (list) => list.some((e) => e.sid === alice.sessionId && e.index === LAUGH_INDEX),
      6000,
      150,
    );
    log.emojisB = emojisB;
    if (!emojisB.some((e) => e.sid === alice.sessionId && e.index === LAUGH_INDEX)) {
      failures.push(`tab B never observed 😂 over 앨리스: ${JSON.stringify(emojisB)}`);
    }
    await sleep(200);
    await shot(pageB, "02-tabB-laugh-over-alice.png");

    // ── Step 3: let that reaction fully expire, then re-test WITH the chat
    // input focused — `3` must type into the field, not fire a new emoji. ──
    await sleep(EMOJI_DISPLAY_MS + 300);
    const clearedB = await getEmojis(pageB);
    log.clearedBeforeGuardTest = clearedB.filter((e) => e.sid === alice.sessionId);

    await pageA.locator(".cv-chat-field").click();
    await pageA.keyboard.press("3");
    await sleep(80);
    const inputValue = await pageA.locator(".cv-chat-field").inputValue();
    log.chatInputValueAfterGuardedPress = inputValue;
    if (inputValue !== "3") {
      failures.push(`chat input should contain the typed "3", got ${JSON.stringify(inputValue)}`);
    }

    const guardCheck = await neverDuring(
      () => getEmojis(pageB),
      (list) => !list.some((e) => e.sid === alice.sessionId),
      1200,
      150,
    );
    log.guardCheckOk = guardCheck.ok;
    log.guardCheckValue = guardCheck.value;
    if (!guardCheck.ok) {
      failures.push(
        `focus guard failed — emoji fired while chat input was focused: ${JSON.stringify(guardCheck.value)}`,
      );
    }
    await shot(pageA, "03-tabA-focus-guard-no-emoji.png");
    await pageA.keyboard.press("Escape"); // blur the input (cleanup)

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

  console.log("emoji over 밥이 in A (want index 3):", JSON.stringify(log.emojisA));
  console.log("emoji over 앨리스 in B (want index 2):", JSON.stringify(log.emojisB));
  console.log("chat input value after guarded press (want \"3\"):", log.chatInputValueAfterGuardedPress);
  console.log("guard held for the whole window (want true):", log.guardCheckOk);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log(
    "\nE2E PASSED — 👏 relayed to A, shortcut `3` relayed 😂 to B, focus guard blocks the shortcut while typing.",
  );
}

main();
