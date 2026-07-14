// Task 9 two-tab E2E smoke: 관리자 — 공지 배너 + 강퇴 (admin announce banner + kick).
//
// Standalone Playwright fallback (same shape as task-05/06/07/08.mjs). Two tabs
// in one context:
//   1. Tab A(선생님) joins WITH the admin code (→ admin panel visible); tab B(밥이)
//      joins normally. A waits until it observes 밥이 as a remote.
//   2. A types the announcement `오늘 수업은 8시 시작!` in the admin panel and clicks
//      [공지 보내기] → the top banner appears in BOTH tabs (schema state, not a
//      broadcast). Screenshot tab B with the banner.
//   3. A clicks [공지 지우기] → the banner disappears in BOTH tabs.
//   4. A clicks [강퇴] on 밥이's row then [확인] → tab B is closed with code 4001
//      and lands on the entry screen showing `관리자에 의해 퇴장되었습니다`.
//      Screenshot tab B's entry.
//   5. B re-fills 밥이 and submits again → the join is REJECTED with
//      `입장이 제한되었습니다` (denySet nickname key). Screenshot the error.
//   6. No console/page errors on either tab (the kick close is consented).
//
// Requires the dev servers with ADMIN_CODE set (client :5173, server :2567).
// Windows dev-server launch used for the evidence run (Git Bash / PowerShell):
//   Bash:       ADMIN_CODE=cayson-admin-2026 npm run dev:server   (+ npm run dev:client)
//   PowerShell: $env:ADMIN_CODE = "cayson-admin-2026"; npm run dev:server
// The same code is passed to tab A via CV_ADMIN_CODE (default below). Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const ADMIN_CODE = process.env.CV_ADMIN_CODE || "cayson-admin-2026";
const TEACHER = "선생님";
const BOB = "밥이";
const ANNOUNCE = "오늘 수업은 8시 시작!";
const KICK_NOTICE = "관리자에 의해 퇴장되었습니다";
const DENY_NOTICE = "입장이 제한되었습니다";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-09");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const bannerText = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".cv-banner .cv-banner-text");
    return el ? el.textContent : null;
  });
const entryMessage = (page) =>
  page.evaluate(() => {
    const el = document.querySelector(".cv-entry .cv-message");
    return el ? el.textContent : null;
  });

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${tag}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return errors;
}

/** Fill the entry form on the CURRENT entry screen (no navigation). */
async function fillEntry(page, { nickname, characterLabel, tintIndex, adminCode }) {
  await page.locator("input.cv-input").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  if (adminCode) {
    await page.locator(".cv-admin-link").click();
    await page.getByLabel("관리자 코드").fill(adminCode);
  }
  await page.locator(".cv-submit").click();
}

/** Navigate to the client and join, waiting until in-world. */
async function joinAs(page, opts) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await fillEntry(page, opts);
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
}

/** Poll until `predicate(value)` or timeout; returns the last value. */
async function pollUntil(read, predicate, timeoutMs = 6000, stepMs = 150) {
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
  const errorsA = watchErrors(pageA, "A/선생님");
  const errorsB = watchErrors(pageB, "B/밥이");

  const failures = [];
  const log = {};
  try {
    // ── Step 1: A joins as admin (with code), B joins normally. ──
    await joinAs(pageA, {
      nickname: TEACHER,
      characterLabel: "기사",
      tintIndex: 5,
      adminCode: ADMIN_CODE,
    });
    await joinAs(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });

    // Admin panel must be visible for tab A only.
    log.adminPanelVisibleA = await pageA.locator(".cv-admin").isVisible();
    log.adminPanelCountB = await pageB.locator(".cv-admin").count();
    if (!log.adminPanelVisibleA) failures.push("tab A (admin) has no admin panel");
    if (log.adminPanelCountB !== 0) failures.push("tab B (normal) should NOT see an admin panel");

    const remotesA = await pollUntil(
      () => getRemotes(pageA),
      (list) => list.some((r) => r.nickname === BOB),
      15000,
      250,
    );
    const bob = remotesA.find((r) => r.nickname === BOB);
    if (!bob) throw new Error("tab A never observed remote 밥이");
    log.bobSid = bob.sessionId;

    // ── Step 2: A announces → banner appears in BOTH tabs. ──
    await pageA.locator(".cv-admin-textarea").fill(ANNOUNCE);
    await pageA.getByRole("button", { name: "공지 보내기" }).click();

    const bannerB = await pollUntil(() => bannerText(pageB), (t) => t === ANNOUNCE, 6000, 150);
    const bannerA = await pollUntil(() => bannerText(pageA), (t) => t === ANNOUNCE, 6000, 150);
    log.bannerA = bannerA;
    log.bannerB = bannerB;
    if (bannerB !== ANNOUNCE) failures.push(`tab B banner missing/incorrect: ${JSON.stringify(bannerB)}`);
    if (bannerA !== ANNOUNCE) failures.push(`tab A banner missing/incorrect: ${JSON.stringify(bannerA)}`);
    await sleep(250);
    await shot(pageB, "01-tabB-banner.png");
    await shot(pageA, "02-tabA-admin-panel.png");

    // ── Step 3: A clears → banner gone in BOTH tabs. ──
    await pageA.getByRole("button", { name: "공지 지우기" }).click();
    const clearedB = await pollUntil(() => bannerText(pageB), (t) => t === null, 6000, 150);
    const clearedA = await pollUntil(() => bannerText(pageA), (t) => t === null, 6000, 150);
    log.bannerClearedB = clearedB === null;
    log.bannerClearedA = clearedA === null;
    if (clearedB !== null) failures.push(`tab B banner not cleared: ${JSON.stringify(clearedB)}`);
    if (clearedA !== null) failures.push(`tab A banner not cleared: ${JSON.stringify(clearedA)}`);
    await shot(pageB, "03-tabB-banner-cleared.png");

    // ── Step 4: A kicks 밥이 → B lands on entry with the kick notice. ──
    const bobRow = pageA.locator(".cv-admin-user", { hasText: BOB });
    await bobRow.getByRole("button", { name: "강퇴" }).click();
    await bobRow.getByRole("button", { name: "확인" }).click();

    await pageB.locator(".cv-entry").waitFor({ state: "visible", timeout: 10000 });
    const kickMsg = await pollUntil(
      () => entryMessage(pageB),
      (t) => typeof t === "string" && t.includes(KICK_NOTICE),
      8000,
      150,
    );
    log.kickMessageB = kickMsg;
    if (!(typeof kickMsg === "string" && kickMsg.includes(KICK_NOTICE))) {
      failures.push(`tab B missing kick notice, got: ${JSON.stringify(kickMsg)}`);
    }
    await shot(pageB, "04-tabB-kicked-entry.png");

    // ── Step 5: B rejoins with the SAME nickname → rejected by the denySet. ──
    await fillEntry(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });
    const denyMsg = await pollUntil(
      () => entryMessage(pageB),
      (t) => typeof t === "string" && t.includes(DENY_NOTICE),
      10000,
      150,
    );
    log.denyMessageB = denyMsg;
    if (!(typeof denyMsg === "string" && denyMsg.includes(DENY_NOTICE))) {
      failures.push(`tab B rejoin should be rejected with "${DENY_NOTICE}", got: ${JSON.stringify(denyMsg)}`);
    }
    // Confirm B did NOT get back into the world.
    log.bRejoinedWorld = await pageB.locator("canvas").count();
    if (log.bRejoinedWorld !== 0) failures.push("tab B re-entered the world despite the ban");
    await shot(pageB, "05-tabB-rejoin-rejected.png");

    // ── Step 6: no console/page errors on either tab. ──
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

  console.log("admin panel visible in A (want true):", log.adminPanelVisibleA);
  console.log("admin panel count in B (want 0):", log.adminPanelCountB);
  console.log("banner in A/B (want announce text):", JSON.stringify(log.bannerA), JSON.stringify(log.bannerB));
  console.log("banner cleared in A/B (want true):", log.bannerClearedA, log.bannerClearedB);
  console.log("kick notice in B:", JSON.stringify(log.kickMessageB));
  console.log("rejoin deny notice in B:", JSON.stringify(log.denyMessageB));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — banner shown to both tabs + cleared, 밥이 kicked (4001), same-name rejoin denied.");
}

main();
