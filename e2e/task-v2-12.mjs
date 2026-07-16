// v2 Task 12 E2E: 방 이름 포스터 3장 + 갤러리 입구 안내판 제거 (design 26).
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5178 →
// server :2572 — other ports belong to parallel lanes):
//   PORT=2572 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2572 npx vite --port 5178
//
// Proves design 26 end to end:
//   1. Join (spawn = lounge) → window.__cvRoomPosters() reports exactly the
//      three posters (미로방/강의실/갤러리) at their derived anchors — the
//      component really MOUNTED, not just that constants exist.
//   2. Three lounge cuts — looking west (미로방 🌀 on the maze east wall),
//      east (강의실 📚 on the divider), north (갤러리 🖼 on the north wall):
//      each poster in frame at eye level, clear of its door (screenshots).
//   3. The old lounge-side entrance sign over the gallery door is GONE — same
//      vantage as task-v2-11's 01-lounge-entrance-sign.png for comparison.
//   4. Gallery interior unchanged: walk in through the door, banner + north
//      portraits cut, and __cvGallery() still reports 9/9 photos loaded with
//      real (non-placeholder) pixels.
//   5. Zero console/page errors, zero local 4xx/5xx.
//      Evidence → .superpowers/sdd/evidence/task-v2-12/.
//
// Automated assertions carry correctness; screenshots are the human guard.
// Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5178";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-12");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

/** Poster anchors mirrored for assertions only (single source: RoomPosters.tsx). */
const EXPECTED_POSTERS = [
  // Maze z = 2.8: door edge (1.05) + clearance + half-card, slid south past the
  // first landmark plaque at z = 1.65 (RoomPosters' deterministic dodge).
  { room: "maze", title: "미로방", x: -29.85, z: 2.8 },
  { room: "lectureHall", title: "강의실", x: -0.25, z: 3.25 },
  { room: "gallery", title: "갤러리", x: -12.5, z: -18 },
];
/** CameraRig drag sensitivity (rad per px) — assert-only copy for aimCamera. */
const DRAG_SPEED = 0.005;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getPosters = (page) => page.evaluate(() => window.__cvRoomPosters?.() ?? []);
const getGallery = (page) => page.evaluate(() => window.__cvGallery?.() ?? []);

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
 * Steer the avatar to (tx,tz), yaw-AWARE (task-v2-06's helper): reads the live
 * camera yaw each poll and projects the desired world direction onto the camera
 * basis to pick w/s/a/d. Collision-slides along walls; releases keys on
 * arrival/timeout. Returns the final position.
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

/**
 * Aim the third-person camera by dragging on the canvas until orbit yaw/pitch
 * reach the targets (camera view direction is -(sin yaw, cos yaw): yaw 0 looks
 * north/-Z, +PI/2 looks west/-X, -PI/2 looks east/+X). Iterative because the
 * drag pixel→radian mapping saturates at viewport edges.
 */
async function aimCamera(page, targetYaw, targetPitch, tries = 8) {
  const box = await page.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  for (let i = 0; i < tries; i++) {
    const { yaw, pitch } = await getOrbit(page);
    const dYaw = norm(targetYaw - yaw);
    const dPitch = targetPitch - pitch;
    if (Math.abs(dYaw) < 0.04 && Math.abs(dPitch) < 0.04) break;
    // orbit.yaw -= dx·DRAG_SPEED, orbit.pitch += dy·DRAG_SPEED (CameraRig).
    const dx = Math.max(-350, Math.min(350, -dYaw / DRAG_SPEED));
    const dy = Math.max(-250, Math.min(250, dPitch / DRAG_SPEED));
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
    await page.mouse.up();
    await sleep(120);
  }
  return getOrbit(page);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  let errors = [];
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await ctx.newPage();
    errors = watchErrors(page, "A");

    await joinAs(page, { nickname: "길안내자", characterLabel: "기사", tintIndex: 1 });
    await page.bringToFront();
    await page.locator("canvas").click();

    // ── 1. The poster component really mounted, with the derived anchors. ──
    const posters = await pollUntil(() => getPosters(page), (p) => p.length === 3, 10000);
    log.posters = posters;
    if (posters.length !== 3) failures.push(`__cvRoomPosters reports ${posters.length} posters (want 3)`);
    for (const want of EXPECTED_POSTERS) {
      const got = posters.find((p) => p.room === want.room);
      if (!got) { failures.push(`poster for ${want.room} missing`); continue; }
      if (got.title !== want.title) failures.push(`${want.room} titled "${got.title}" (want "${want.title}")`);
      if (Math.abs(got.x - want.x) > 0.01 || Math.abs(got.z - want.z) > 0.01) {
        failures.push(`${want.room} anchored at (${got.x}, ${got.z}) (want (${want.x}, ${want.z}))`);
      }
    }

    // ── 2. Three lounge cuts — the posters read from across the room. Stand
    //       points sit OFF each poster's axis so the avatar never covers it
    //       (the first pass hid all three behind the avatar's head). ──
    // West: 미로방 on the maze east wall (x=-29.85, z=2.3), south of the door.
    await walkTo(page, -16, 5.5, { timeout: 9000 });
    await aimCamera(page, Math.PI / 2, 0.03);
    await sleep(300);
    await shot(page, "01-lounge-west-maze-poster.png");

    // East: 강의실 on the divider west face (x=-0.25, z=3.25).
    await walkTo(page, -13, 0.8, { timeout: 9000 });
    await aimCamera(page, -Math.PI / 2, 0.03);
    await sleep(300);
    await shot(page, "02-lounge-east-lecture-poster.png");

    // North: 갤러리 on the lounge north wall (x=-12.5, z=-18), east of the door
    // — framed together with the door opening it labels.
    await walkTo(page, -15.4, -6, { timeout: 12000 });
    await aimCamera(page, 0, 0.03);
    await sleep(300);
    await shot(page, "03-lounge-north-gallery-poster.png");

    // ── 3. The old entrance sign over the gallery door is GONE — the same
    //       vantage task-v2-11 used for 01-lounge-entrance-sign.png. Route
    //       EAST around the centre sofa at (-15,-7) first (it blocks a straight
    //       south march from the poster stand point). ──
    await walkTo(page, -12.5, -5.5, { timeout: 9000 });
    await walkTo(page, -12.5, -13, { timeout: 9000 });
    await walkTo(page, -15, -13.5, { timeout: 9000 });
    await aimCamera(page, 0, 0.1);
    await sleep(300);
    await shot(page, "04-gallery-door-no-sign.png");

    // ── 4. Gallery interior unchanged: enter and re-verify banner + photos. ──
    await walkTo(page, -15, -16.7, { tol: 0.4, timeout: 8000 });
    const inGallery = await walkTo(page, -15, -21, { tol: 0.5, timeout: 10000 });
    log.entered = inGallery;
    if (!(inGallery.z < -18.5)) failures.push(`did not enter the gallery (z=${inGallery.z.toFixed(2)})`);

    const gallery = await pollUntil(
      () => getGallery(page),
      (g) => g.length === 9 && g.every((e) => e.loaded && e.mean !== null),
      20000,
    );
    log.gallery = gallery.map((g) => ({ age: g.age, loaded: g.loaded, mean: Math.round(g.mean ?? -1) }));
    if (gallery.length !== 9) failures.push(`__cvGallery reports ${gallery.length} portraits (want 9)`);
    for (const g of gallery) {
      if (!g.loaded) failures.push(`age-${g.age} texture never loaded`);
      // The placeholder is #151022 (mean ≈ 24); a real photo reads far brighter.
      else if (!(g.mean > 35)) failures.push(`age-${g.age} pixels look like the placeholder (mean ${g.mean})`);
    }

    await walkTo(page, -18, -26.8, { timeout: 14000 });
    await aimCamera(page, 0, 0.1);
    await sleep(300);
    await shot(page, "05-gallery-banner-unchanged.png");

    // ── 5. Zero console/page errors, zero local 4xx/5xx. ──
    log.errors = errors;
    if (errors.length) failures.push(`console/page errors:\n  ${errors.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("posters:", JSON.stringify(log.posters));
  console.log("entered:", JSON.stringify(log.entered));
  console.log("gallery:", JSON.stringify(log.gallery));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — 3 posters mounted at derived anchors, entrance sign vantage captured, gallery photos 9/9 intact, zero errors.");
}

main();
