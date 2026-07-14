// Task 5 two-tab E2E smoke: remote-avatar sync + interpolation.
//
// Standalone Playwright fallback (used because the Playwright MCP server was not
// available in this environment). Drives two pages in ONE browser context:
//   - Tab A joins as 앨리스 (knight, blue), Tab B joins as 밥 (mage, red).
//   - Screenshots tab A showing both avatars (self + remote 밥 with nametag).
//   - Holds `w` in tab B ~1.5s, then asserts — via window.__cv.getRemotes() in
//     tab A — that 밥's synced position changed, with no console/page errors.
//
// Requires the dev servers running (npm run dev → client :5173, server :2567).
// Screenshots land in .superpowers/sdd/evidence/task-05/. Exit code 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
// The brief names the second player 밥, but the app's NICKNAME_MIN is 2 chars and
// 밥 is a single Hangul syllable (length 1), rejected client- AND server-side.
// Use a valid 2-char name that keeps the same 밥 identity.
const BOB = "밥이";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-05");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Attach console/page-error collectors; returns the collected error strings. */
function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[${tag}] console.error: ${msg.text()}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  return errors;
}

/** Fill the entry form and enter the world; resolves once window.__cv exists. */
async function joinAs(page, { nickname, characterLabel, tintIndex }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").fill(nickname);
  await page.locator(".cv-character", { hasText: characterLabel }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(
    () => typeof window.__cv?.getRemotes === "function",
    null,
    { timeout: 45000 }, // generous: first load is a cold Vite compile + GLB fetch
  );
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
}

/** 밥's newest synced position as seen from tab A (or null if not yet present). */
function findBob(page) {
  return page.evaluate((bob) => {
    const list = window.__cv.getRemotes();
    return list.find((r) => r.nickname === bob) ?? null;
  }, BOB);
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
  const errorsB = watchErrors(pageB, "B/밥");

  const failures = [];
  try {
    // 1) Join both tabs. 앨리스: knight(기사) + 색상6(blue). 밥: mage(마법사) + 색상2(red).
    await joinAs(pageA, { nickname: "앨리스", characterLabel: "기사", tintIndex: 5 });
    await joinAs(pageB, { nickname: BOB, characterLabel: "마법사", tintIndex: 1 });

    // 2) Wait until tab A sees 밥 as a remote, then screenshot both avatars.
    let before = null;
    for (let i = 0; i < 40 && !before; i++) {
      before = await findBob(pageA);
      if (!before) await sleep(250);
    }
    if (!before) throw new Error("tab A never observed remote 밥 via getRemotes()");
    await sleep(500); // let a few interpolated frames render for the screenshot
    await shot(pageA, "01-tabA-both-avatars.png");

    // 3) Hold `w` in tab B ~1.5s to walk 밥 forward.
    await pageB.locator("canvas").click(); // focus the canvas for keyboard input
    await pageB.keyboard.down("w");
    await sleep(1500);
    await pageB.keyboard.up("w");
    await shot(pageB, "02-tabB-after-moving.png");

    // 4) Let the final move patch reach tab A, then re-read 밥's position.
    await sleep(500);
    const after = await findBob(pageA);
    if (!after) throw new Error("tab A lost remote 밥 after movement");
    await shot(pageA, "03-tabA-after-move.png");

    const delta = Math.hypot(after.x - before.x, after.z - before.z);
    console.log("before 밥:", JSON.stringify(before));
    console.log("after  밥:", JSON.stringify(after));
    console.log("moved distance (m):", delta.toFixed(3));

    // 5) Assertions: 밥 moved a real distance, and neither tab logged errors.
    if (!(delta > 0.5)) failures.push(`밥 did not move: delta=${delta.toFixed(3)}m (expected > 0.5)`);
    const allErrors = [...errorsA, ...errorsB];
    if (allErrors.length) failures.push(`console/page errors:\n  ${allErrors.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    await browser.close();
  }

  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — remote avatar synced and moved smoothly, no errors.");
}

main();
