// v2 Task 6 E2E: 미로 시인성 — 밝은 벽 + 이모지 그림 팻말 (maze legibility).
//
// Standalone Playwright (same shape as task-v2-05), run against an ISOLATED stack
// so it never collides with the parallel camera agent's default ports:
//
//     server  PORT=2568           (default is 2567)
//     client  vite --port 5174    (default is 5173)
//     client → VITE_SERVER_URL=http://localhost:2568
//
// Proves design §20's maze half end to end:
//   1. Join, enter the maze through the east door, stand in a corridor → screenshot
//      shows the BRIGHTENED walls and ≥2 emoji plaques in frame (asserted via the
//      dev-only window.__cvPlaques() placement hook — ≥2 plaques within 4 m).
//   2. Walk to a DIFFERENT corridor → ≥2 plaques again, and the nearby emoji SET
//      differs from the first corridor (distinguishable landmarks).
//   3. A bonus eye-level first-person shot per corridor (best plaque view), guarded
//      so it never fails the run if the (foreign-lane) FP toggle is mid-change.
//   4. Zero console/page errors. Evidence → evidence/task-v2-06/.
//
// Automated assertions carry correctness; screenshots are the human guard. Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5174";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-06");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getView = (page) => page.evaluate(() => window.__cv?.getView?.() ?? { mode: "tp" });
const getPlaques = (page) => page.evaluate(() => window.__cvPlaques?.() ?? []);

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
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 45000 });
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

/**
 * Steer the avatar to (tx,tz), yaw-AWARE: reads the live camera yaw each poll and
 * projects the desired world direction onto the camera basis to pick w/s/a/d.
 * Collision-slides along maze walls; releases all keys on arrival/timeout.
 */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 20000 } = {}) {
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
      const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
      const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
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

/** Plaques within `radius` m of (x,z), with their unique emoji set. */
function nearbyPlaques(plaques, x, z, radius) {
  const near = plaques.filter((p) => Math.hypot(p.x - x, p.z - z) <= radius);
  const emojis = [...new Set(near.map((p) => p.emojiIndex))].sort((a, b) => a - b);
  return { count: near.length, emojis };
}

/** Best-effort eye-level FP shot (foreign-lane toggle; never fails the run). */
async function fpShot(page, name, log, key) {
  try {
    await page.locator("canvas").click();
    await page.keyboard.press("v");
    const v = await pollUntil(() => getView(page), (s) => s.mode === "fp", 3500);
    log[key] = v.mode;
    await sleep(250);
    await shot(page, name);
    await page.keyboard.press("v"); // back to TP
    await pollUntil(() => getView(page), (s) => s.mode === "tp", 3000);
  } catch (e) {
    log[key] = `skipped: ${e instanceof Error ? e.message : String(e)}`;
  }
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
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    allErrors.push(watchErrors(page, "A"));
    await joinAs(page, { nickname: "미로탐험", characterLabel: "기사", tintIndex: 0 });
    await page.bringToFront();
    await page.locator("canvas").click();

    // ── Placement hook sanity: plaques exist and use many distinct emojis. ──
    const plaques = await getPlaques(page);
    const distinct = new Set(plaques.map((p) => p.emojiIndex)).size;
    log.placement = { total: plaques.length, distinctEmojis: distinct };
    if (plaques.length < 40) failures.push(`too few plaques placed (${plaques.length})`);
    if (distinct < 12) failures.push(`too few distinct emojis (${distinct})`);

    // ── Enter the maze through the east door (z ≈ 0), routing around the sofa. ──
    await walkTo(page, -15, 2, { timeout: 9000 });
    await walkTo(page, -27, 2, { timeout: 16000 });
    await walkTo(page, -29, 0, { timeout: 10000 });
    await walkTo(page, -34, 0, { timeout: 16000, tol: 0.5 });
    const posA = await getPos(page);
    log.corridorA = { pos: posA };
    const inMaze = posA.x <= -30 && posA.x >= -66 && posA.z >= -18 && posA.z <= 18;
    if (!inMaze) failures.push(`A did not enter the maze (x=${posA.x.toFixed(2)}, z=${posA.z.toFixed(2)})`);

    // Corridor A: ≥2 plaques within 4 m in frame.
    const nearA = nearbyPlaques(plaques, posA.x, posA.z, 4);
    log.corridorA.near = nearA;
    if (nearA.count < 2) failures.push(`corridor A has <2 plaques within 4m (${nearA.count})`);
    await sleep(200);
    await shot(page, "01-corridor-A-bright-walls.png");
    await fpShot(page, "02-corridor-A-fp.png", log, "fpA");

    // ── Move to a DIFFERENT corridor (deeper west). ──
    await page.locator("canvas").click();
    await walkTo(page, -42, 0, { timeout: 20000, tol: 0.6 });
    await walkTo(page, -42, -4, { timeout: 14000, tol: 0.8 });
    const posB = await getPos(page);
    log.corridorB = { pos: posB };
    const moved = Math.hypot(posB.x - posA.x, posB.z - posA.z);
    log.moved = moved;
    if (moved < 3) failures.push(`did not reach a different corridor (moved ${moved.toFixed(2)}m)`);

    const nearB = nearbyPlaques(plaques, posB.x, posB.z, 4);
    log.corridorB.near = nearB;
    if (nearB.count < 2) failures.push(`corridor B has <2 plaques within 4m (${nearB.count})`);
    const sameSet = JSON.stringify(nearA.emojis) === JSON.stringify(nearB.emojis);
    log.distinctCorridors = !sameSet;
    if (sameSet) failures.push(`corridor B shows the SAME emoji set as A (${nearB.emojis.join(",")})`);
    await sleep(200);
    await shot(page, "03-corridor-B-different-emojis.png");
    await fpShot(page, "04-corridor-B-fp.png", log, "fpB");

    // ── Zero console/page errors. ──
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

  console.log("placement:", JSON.stringify(log.placement));
  console.log("corridor A:", JSON.stringify(log.corridorA));
  console.log("corridor B:", JSON.stringify(log.corridorB), "moved:", log.moved?.toFixed?.(2));
  console.log("distinct corridors:", log.distinctCorridors, " fpA:", log.fpA, " fpB:", log.fpB);
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — brighter maze walls + ≥2 distinguishable emoji plaques per corridor, zero errors.");
}

main();
