/**
 * Keypad smoke: join the village, walk to house_1's B-layout keypad, enter the server-only code,
 * verify the synced area becomes house:house_1, then use the shared interior exit pad.
 * Run with a dev server: `node e2e/village-keypad.mjs [--out=<folder>]`.
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/escape.mjs";

const run = createRun("village-keypad");
const outArg = process.argv.find((a) => a.startsWith("--out="));
run.evidence = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(run.evidence, { recursive: true });

const browser = await launchBrowser(DESKTOP);
const player = await openPlayer(browser, run, { tag: "keypad" });
try {
  await player.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
  await entryReady(player);
  await player.page.locator("input.cv-input").first().fill("번호키 테스트");
  await press(player, player.page.locator(".cv-submit"));
  await player.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  // house_1 = (21,-42), south-facing B footprint 11.2 × 8.4; keypad pad ≈ (21,-37.15).
  for (const [x, z] of [[0, 14], [0, -20], [15, -34], [21, -37.15]]) await walkAndWait(player, x, z, 40000, 1.2);
  await player.page.keyboard.press("KeyE");
  await player.page.locator(".cv-keypad input").fill("1004");
  await player.page.locator(".cv-keypad-submit").click();
  await player.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "house:house_1", null, { timeout: 15000 });
  await player.page.screenshot({ path: `${run.evidence}/house-interior.png` });
  await walkAndWait(player, 300, 5.2, 20000, 1.2);
  await player.page.keyboard.press("KeyE");
  await player.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "village", null, { timeout: 15000 });
  console.log(JSON.stringify({ ok: true, area: "village", evidence: run.evidence }));
} finally {
  await browser.close();
}

