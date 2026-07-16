// v2 Task 3 two-tab E2E: 미로방 — 라운지 서편 증축 (enter, camera cap, wall collision).
//
// Standalone Playwright (same shape as task-05..13 / task-v2-01/02). Two tabs,
// one context, against ISOLATED dev servers (client :5174, server :2568 — see the
// task brief). Deterministic keyboard navigation via window.__cv.getPos (camera
// yaw stays 0 → d/a = +/-X, s/w = +/-Z). The maze camera cap is read via the
// dev-only window.__cvCamera() published by CameraRig.
//
//   1. A routes around the lounge furniture and walks WEST through the lounge
//      door into the maze (x < -30) → screenshot inside a corridor.
//   2. Camera cap: at max zoom-out INSIDE the maze, __cvCamera().y ≤ 3.5 and the
//      effective distance ≤ 6 (no bird's-eye) → screenshot proving the walls fill
//      the view.
//   3. Wall collision: pushing west into an internal maze wall STOPS A (no
//      pass-through) — final x settles at the wall, never tunnels past it.
//   4. A exits the maze → the cap RELEASES: at max zoom-out in the lounge the
//      camera can rise and the distance exceeds 6 again.
//   5. Goal/portal are server-judged (integration tests) — a full keyboard solve
//      is out of scope here (brief step 5), so we assert coverage in the log.
//   6. B sees remote A INSIDE the maze zone (remote sync through the new zone).
//   7. Zero console/page errors on either tab.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5174";
const ALICE = "앨리스";
const BOB = "밥이";

// Derived from shared/maze.ts (seed 12): maze zone x ∈ [-66,-30]; the east door
// opens at z≈0; the entrance cell centre is (-31.2, 0); straight west of it is an
// internal wall (a body stops at x ≈ -31.85, never past -32.25). Cap: y ≤ 3.5, d ≤ 6.
const MAZE_EAST = -30; // maze/lounge boundary (x < this ⇒ inside the maze)
const ENTRANCE = { x: -31.2, z: 0 };
const CORRIDOR = { x: -31.2, z: 3 }; // a few cells south along the east-wall corridor
const CAM_MAX_Y = 3.5;
const CAM_MAX_DIST = 6;
const EPS = 0.25;

const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-03");
mkdirSync(EVIDENCE, { recursive: true });

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getRemotes = (page) => page.evaluate(() => window.__cv.getRemotes());
const getCamera = (page) => page.evaluate(() => (window.__cvCamera ? window.__cvCamera() : null));

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
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, { timeout: 45000 });
  await page.locator("canvas").waitFor({ state: "visible", timeout: 20000 });
}

async function pollUntil(read, predicate, timeoutMs = 6000, stepMs = 120) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!predicate(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/** Steer to (tx,tz) by holding d/a (+/-X) and s/w (+/-Z), re-deciding each poll. */
async function walkTo(page, tx, tz, { tol = 0.4, timeout = 20000 } = {}) {
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
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

/** Push a single direction key for `ms`, then release — for the wall-stop probe. */
async function pushDir(page, key, ms) {
  await page.keyboard.down(key);
  await sleep(ms);
  await page.keyboard.up(key);
  return getPos(page);
}

/** Zoom the third-person camera fully out (wheel), then settle a few frames. */
async function zoomOut(page) {
  await page.mouse.move(640, 400);
  for (let i = 0; i < 4; i++) {
    await page.mouse.wheel(0, 4000);
    await sleep(60);
  }
  await sleep(500); // let the cap engagement lerp settle (~0.3s)
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
    const remotesA = await pollUntil(() => getRemotes(pageA), (l) => l.some((r) => r.nickname === BOB), 15000, 250);
    const bob = remotesA.find((r) => r.nickname === BOB);
    const remotesB = await pollUntil(() => getRemotes(pageB), (l) => l.some((r) => r.nickname === ALICE), 15000, 250);
    const alice = remotesB.find((r) => r.nickname === ALICE);
    if (!bob || !alice) throw new Error("tabs never observed each other as remotes");
    log.aliceSid = alice.sessionId;

    // ── Step 1: A routes around the lounge furniture and enters the maze. ──
    await pageA.locator("canvas").click(); // focus; no drag → yaw stays 0
    await walkTo(pageA, -15, 12); // north, clear of the sofa cluster
    await walkTo(pageA, -29, 12); // west along the north edge
    await walkTo(pageA, -29, 0); // south to the door approach (lounge side)
    await shot(pageA, "01-tabA-door-approach.png");
    await walkTo(pageA, ENTRANCE.x, ENTRANCE.z); // west through the door into the maze
    await walkTo(pageA, CORRIDOR.x, CORRIDOR.z); // a bit south into the corridor
    const aInMaze = await getPos(pageA);
    log.aInMaze = aInMaze;
    if (!(aInMaze.x < MAZE_EAST)) {
      failures.push(`A never entered the maze: x=${aInMaze.x} (want < ${MAZE_EAST})`);
    }
    await shot(pageA, "02-tabA-inside-corridor.png");

    // ── Step 2: camera cap at max zoom-out INSIDE the maze. ──
    await zoomOut(pageA);
    const camIn = await getCamera(pageA);
    log.cameraInMaze = camIn;
    if (!camIn) {
      failures.push("window.__cvCamera() unavailable (dev hook missing)");
    } else {
      if (camIn.y > CAM_MAX_Y + EPS) {
        failures.push(`camera peeks over the walls: y=${camIn.y.toFixed(2)} (cap ${CAM_MAX_Y})`);
      }
      if (camIn.distance > CAM_MAX_DIST + EPS) {
        failures.push(`camera not distance-capped in maze: d=${camIn.distance.toFixed(2)} (cap ${CAM_MAX_DIST})`);
      }
    }
    // Still inside the maze after zooming (cap didn't move the player).
    log.aAfterZoom = await getPos(pageA);
    await shot(pageA, "03-tabA-maze-camera-capped.png");

    // ── Step 3: wall collision — push WEST into the internal wall, must stop. ──
    // From the corridor, walk back to the entrance cell, then shove west.
    await walkTo(pageA, ENTRANCE.x, ENTRANCE.z);
    const beforeWall = await getPos(pageA);
    const afterWall = await pushDir(pageA, "a", 1200); // hold west 1.2s
    log.wallStop = { beforeWall, afterWall };
    if (afterWall.x < -32.3) {
      failures.push(`A tunneled through a maze wall: x=${afterWall.x} (wall face ≈ -32.25)`);
    }
    if (!(afterWall.x < MAZE_EAST)) {
      failures.push(`A pushed back out of the maze unexpectedly: x=${afterWall.x}`);
    }
    await shot(pageA, "04-tabA-blocked-by-wall.png");

    // ── Step 6 (before exit): B sees remote A inside the maze zone. ──
    const bViewOfA = await pollUntil(
      () => getRemotes(pageB),
      (l) => l.some((r) => r.sessionId === alice.sessionId && r.x < MAZE_EAST),
      8000,
    );
    const aOnB = bViewOfA.find((r) => r.sessionId === alice.sessionId);
    log.aOnB = aOnB;
    if (!aOnB || !(aOnB.x < MAZE_EAST)) {
      failures.push(`B never saw A inside the maze: ${JSON.stringify(aOnB)}`);
    }
    await shot(pageB, "05-tabB-sees-A-in-maze.png");

    // ── Step 4: exit the maze → the cap RELEASES (zoom-out works again). ──
    await walkTo(pageA, ENTRANCE.x, ENTRANCE.z);
    await walkTo(pageA, -29, 0); // back through the door into the lounge
    await walkTo(pageA, -22, 12); // clear lounge floor, well east of the maze
    const aOut = await getPos(pageA);
    log.aOut = aOut;
    if (aOut.x < MAZE_EAST) failures.push(`A failed to exit the maze: x=${aOut.x}`);
    await zoomOut(pageA);
    const camOut = await getCamera(pageA);
    log.cameraOutMaze = camOut;
    if (camOut && !(camOut.distance > CAM_MAX_DIST + EPS)) {
      failures.push(`cap did not release outside the maze: d=${camOut.distance?.toFixed(2)} (want > ${CAM_MAX_DIST})`);
    }
    await shot(pageA, "06-tabA-lounge-zoom-restored.png");

    // ── Step 5: goal/portal are server-judged — covered by integration tests. ──
    log.goalPortalNote = "goal broadcast + portal teleport covered by WorldRoom integration tests (server-authoritative)";

    // ── Step 7: zero console/page errors. ──
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

  console.log("A inside maze:", JSON.stringify(log.aInMaze));
  console.log("camera in maze:", JSON.stringify(log.cameraInMaze));
  console.log("wall stop:", JSON.stringify(log.wallStop));
  console.log("B sees A in maze:", JSON.stringify(log.aOnB));
  console.log("camera out of maze:", JSON.stringify(log.cameraOutMaze));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — enter maze, camera capped (no peek), walls block, cap released on exit, remote sync.");
}

main();
