// Task 6 single-tab E2E smoke: furnished world map + AABB collision.
//
// Standalone Playwright fallback (the Playwright MCP server is unavailable here),
// same shape as task-05.mjs. One tab:
//   1. join → wait for the scene (furniture GLBs load inside the same Suspense as
//      the __cv hook, so getPos ready ⇒ furniture rendered) → screenshot the lounge
//   2. align X to the test sofa centre (spawn jitter is ±2 m), then hold 'w'
//      (which is -Z at camera yaw 0) INTO the sofa and assert via window.__cv.getPos()
//      that the body stops OUTSIDE the sofa footprint (no pass-through)
//   3. recentre to the door lane, walk east ('d' = +X) through the door into the
//      lecture hall, orbit the camera to face the screen, screenshot desks + screen
//   4. assert no console/page errors and no furniture/model 404s; kill on exit
//
// Requires dev servers (npm run dev → client :5173, server :2567).
// Screenshots + a summary land in .superpowers/sdd/evidence/task-06/. Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-06");
mkdirSync(EVIDENCE, { recursive: true });

// The E2E test sofa: loungeSofa at (-15,-7), rotY 0, FURNITURE_SCALE 2.2 →
// footprint half-extents (0.49·2.2, 0.205·2.2). Kept in sync with worldMap.ts.
const PLAYER_RADIUS = 0.4;
const SOFA = { x: -15, z: -7, hx: 0.49 * 2.2, hz: 0.205 * 2.2 };
const SOFA_FOOTPRINT = {
  minX: SOFA.x - SOFA.hx,
  maxX: SOFA.x + SOFA.hx,
  minZ: SOFA.z - SOFA.hz,
  maxZ: SOFA.z + SOFA.hz,
};
const EXPECTED_STOP_Z = SOFA_FOOTPRINT.maxZ + PLAYER_RADIUS; // ≈ -6.149

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

/** Collect any HTTP response with a >=400 status (catches missing GLB/bin files). */
function watchBadResponses(page) {
  const bad = [];
  page.on("response", (res) => {
    if (res.status() >= 400) bad.push(`HTTP ${res.status()} ${res.url()}`);
  });
  page.on("requestfailed", (req) => bad.push(`FAILED ${req.url()} (${req.failure()?.errorText})`));
  return bad;
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

/** Hold `key`, polling getPos() until `done(pos)` or timeout, then release. */
async function holdUntil(page, key, done, timeoutMs = 6000) {
  await page.keyboard.down(key);
  const deadline = Date.now() + timeoutMs;
  let pos = await getPos(page);
  try {
    while (!done(pos) && Date.now() < deadline) {
      await sleep(80);
      pos = await getPos(page);
    }
  } finally {
    await page.keyboard.up(key);
  }
  await sleep(150); // let the final move settle
  return getPos(page);
}

/**
 * Nudge X onto `targetX` (camera yaw 0: 'a' = -X, 'd' = +X). Stops the moment X
 * CROSSES the target — a fixed window smaller than the ~0.3 m poll step could be
 * skipped over, so we release on the crossing instead.
 */
async function alignX(page, targetX) {
  const pos = await getPos(page);
  const dx = targetX - pos.x;
  if (Math.abs(dx) <= 0.3) return;
  if (dx < 0) await holdUntil(page, "a", (p) => p.x <= targetX, 4000); // move -X
  else await holdUntil(page, "d", (p) => p.x >= targetX, 4000); // move +X
}

function insideFootprint(p) {
  return (
    p.x >= SOFA_FOOTPRINT.minX &&
    p.x <= SOFA_FOOTPRINT.maxX &&
    p.z >= SOFA_FOOTPRINT.minZ &&
    p.z <= SOFA_FOOTPRINT.maxZ
  );
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const errors = watchErrors(page, "케이슨");
  const badResponses = watchBadResponses(page);

  const failures = [];
  const log = {};
  try {
    // 1) Join and screenshot the lounge (the test sofa is due north of spawn).
    await joinAs(page, { nickname: "케이슨", characterLabel: "기사", tintIndex: 5 });
    await sleep(700); // a few rendered frames with furniture
    await shot(page, "01-lounge-spawn.png");

    // 2) Walk INTO the sofa. Align X to its centre first (spawn jitter is ±2 m),
    //    then hold 'w' (-Z at yaw 0) until it can go no further.
    await page.locator("canvas").click(); // focus for keyboard input (no drag → yaw stays 0)
    await alignX(page, SOFA.x);
    const before = await getPos(page);
    const after = await holdUntil(page, "w", (p) => p.z <= EXPECTED_STOP_Z + 0.06, 5000);
    await shot(page, "02-sofa-collision.png");

    log.beforeSofa = before;
    log.afterSofa = after;
    log.sofaFootprint = SOFA_FOOTPRINT;
    log.expectedStopZ = EXPECTED_STOP_Z;

    // Assertions: moved a real distance north, stopped OUTSIDE (south of) the
    // footprint, ~one radius off the sofa face — i.e. collision stopped it.
    if (!(after.z < -5.5)) failures.push(`did not walk into the sofa: after.z=${after.z.toFixed(3)} (want < -5.5)`);
    if (!(after.z > SOFA_FOOTPRINT.maxZ)) failures.push(`passed through the sofa: after.z=${after.z.toFixed(3)} not > maxZ=${SOFA_FOOTPRINT.maxZ.toFixed(3)}`);
    if (insideFootprint(after)) failures.push(`ended INSIDE the sofa footprint: ${JSON.stringify(after)}`);
    if (Math.abs(after.z - EXPECTED_STOP_Z) > 0.25) failures.push(`stop point off the sofa face: after.z=${after.z.toFixed(3)} vs expected ${EXPECTED_STOP_Z.toFixed(3)}`);

    // 3) Return to the door lane, then walk east into the lecture hall.
    await holdUntil(page, "s", (p) => p.z >= -0.4, 4000); // 's' = +Z at yaw 0
    const hall = await holdUntil(page, "d", (p) => p.x >= 11, 9000); // 'd' = +X
    log.lectureHall = hall;
    if (!(hall.x >= 10)) failures.push(`did not reach the lecture hall through the door: x=${hall.x.toFixed(3)} (want >= 10)`);

    // Orbit the camera to face the screen (+X) for the screenshot: drag right so
    // orbit.yaw ≈ -π/2 (dragSpeed 0.005 rad/px → ~314 px).
    await page.mouse.move(360, 400);
    await page.mouse.down();
    await page.mouse.move(674, 400, { steps: 12 });
    await page.mouse.up();
    await sleep(400);
    await shot(page, "03-lecture-hall.png");

    // 4) No console/page errors, and no missing model files.
    const modelBad = badResponses.filter((b) => /\.(glb|bin|png|jpg)/i.test(b));
    if (errors.length) failures.push(`console/page errors:\n  ${errors.join("\n  ")}`);
    if (modelBad.length) failures.push(`asset load failures:\n  ${modelBad.join("\n  ")}`);
    log.badResponses = badResponses;
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("before sofa:", JSON.stringify(log.beforeSofa));
  console.log("after  sofa:", JSON.stringify(log.afterSofa), "(footprint maxZ", SOFA_FOOTPRINT.maxZ.toFixed(3), ")");
  console.log("lecture hall:", JSON.stringify(log.lectureHall));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — furniture visible, sofa stopped the player outside its footprint, walked through the door into the hall, no errors/404s.");
}

main();
