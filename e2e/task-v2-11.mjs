// v2 Task 11 E2E: 최무호 일대기 갤러리방 — 초상 9점 연대순 전시 (design 25).
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5177 →
// server :2571 — 2568/5174 and 2569/5175 belong to parallel lanes):
//   PORT=2571 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2571 npx vite --port 5177
//
// Proves design 25 end to end:
//   1. Join → the lounge-side entrance sign over the gallery door (screenshot),
//      then walk THROUGH the 2.5 m door into the annex (position crosses z=-18).
//   2. All NINE photo textures really load: window.__cvGallery() reports
//      loaded=true for every age, each texture's sampled mean luminance is far
//      above the dark placeholder, exactly 9 distinct /gallery/age-N.jpg
//      responses returned 200, and zero local 4xx/5xx.
//   3. Wall tour screenshots: west (1·4·17) → a zoomed close-up → north
//      (28·40·60 + "최무호 일대기" title banner) → east (70·80·100).
//   4. Collision: pushing into the gallery west/north walls never crosses them;
//      pushing at the lounge north wall AWAY from the door stays in the lounge —
//      the door is the only way in (the shared wall-seal test proves the rest).
//   5. M overview → whole map including the annex (WORLD_BOUNDS extension is
//      picked up automatically by the fit) — screenshot + ov mode assert.
//   6. Zero console/page errors. Evidence → .superpowers/sdd/evidence/task-v2-11/.
//
// Automated assertions carry correctness; screenshots are the human guard.
// Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5177";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-11");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

/** Map data mirrored for assertions only (single source stays in shared). */
const GALLERY = { minX: -24, maxX: -6, minZ: -34, maxZ: -18 };
const PORTRAIT_AGES = [1, 4, 17, 28, 40, 60, 70, 80, 100];
/** CameraRig drag sensitivity (rad per px) — assert-only copy for aimCamera. */
const DRAG_SPEED = 0.005;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getView = (page) => page.evaluate(() => window.__cv.getView());
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
 * arrival/timeout. Returns the final position — collision asserts read it.
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

    // Track every gallery photo response (deduped by URL path).
    const photo200 = new Set();
    const photoBad = [];
    page.on("response", (r) => {
      const m = r.url().match(/\/gallery\/age-(\d+)\.jpg$/);
      if (!m) return;
      if (r.status() === 200) photo200.add(`age-${m[1]}`);
      else if (r.status() >= 400) photoBad.push(`${r.status()} age-${m[1]}`);
    });

    await joinAs(page, { nickname: "관장님", characterLabel: "기사", tintIndex: 2 });
    await page.bringToFront();
    await page.locator("canvas").click();

    // ── 1. All nine photo textures really load (flags + pixels + network). ──
    const gallery = await pollUntil(
      () => getGallery(page),
      (g) => g.length === 9 && g.every((e) => e.loaded && e.mean !== null),
      20000,
    );
    log.gallery = gallery;
    if (gallery.length !== 9) failures.push(`__cvGallery reports ${gallery.length} portraits (want 9)`);
    const ages = gallery.map((g) => g.age);
    if (JSON.stringify(ages) !== JSON.stringify(PORTRAIT_AGES)) {
      failures.push(`portrait ages out of life order: ${ages.join(",")}`);
    }
    for (const g of gallery) {
      if (!g.loaded) failures.push(`age-${g.age} texture never loaded`);
      // The placeholder is #151022 (mean ≈ 24); a real photo reads far brighter.
      else if (!(g.mean > 35)) failures.push(`age-${g.age} pixels look like the placeholder (mean ${g.mean})`);
    }
    log.photoResponses = { ok: [...photo200].sort(), bad: photoBad };
    if (photo200.size !== 9) failures.push(`expected 9 distinct 200s for /gallery/*.jpg, got ${photo200.size}`);
    if (photoBad.length) failures.push(`gallery photo error responses: ${photoBad.join(", ")}`);

    // ── 2. Lounge-side entrance sign over the door. Route WEST around the
    //       centre sofa at (-15,-7) — a straight north march wedges on it. ──
    await walkTo(page, -18, -3, { timeout: 9000 });
    await walkTo(page, -18, -11, { timeout: 9000 });
    await walkTo(page, -15, -13.5, { timeout: 9000 });
    await aimCamera(page, 0, 0.1);
    await sleep(250);
    await shot(page, "01-lounge-entrance-sign.png");

    // ── 3. Through the door (the only opening) into the annex. ──
    await walkTo(page, -15, -16.7, { tol: 0.4, timeout: 8000 });
    const inGallery = await walkTo(page, -15, -21, { tol: 0.5, timeout: 10000 });
    log.entered = inGallery;
    if (!(inGallery.z < -18.5)) failures.push(`did not enter the gallery (z=${inGallery.z.toFixed(2)})`);
    if (!(inGallery.x > GALLERY.minX && inGallery.x < GALLERY.maxX)) {
      failures.push(`entered outside the annex x-range (x=${inGallery.x.toFixed(2)})`);
    }

    // ── 4. Wall tour: west (1·4·17) → close-up → north (+banner) → east.
    //       Stand positions sit BETWEEN portrait axes so the avatar never
    //       covers a photo (the first pass hid each wall's middle portrait). ──
    await walkTo(page, -17.5, -23.3, { timeout: 14000 });
    await aimCamera(page, Math.PI / 2, 0.1);
    await sleep(300);
    await shot(page, "02-west-wall-1-4-17.png");

    await walkTo(page, -21.8, -27.4, { timeout: 8000 });
    await page.mouse.wheel(0, -300); // zoom in (TP distance shrinks toward min)
    await aimCamera(page, 1.15, 0.03); // angled past the avatar onto 4살 + plaque
    await sleep(300);
    await shot(page, "03-portrait-closeup-age4.png");
    await page.mouse.wheel(0, 300); // restore the default framing

    await walkTo(page, -18, -26.8, { timeout: 10000 });
    await aimCamera(page, 0, 0.1);
    await sleep(300);
    await shot(page, "04-north-wall-banner-28-40-60.png");

    await walkTo(page, -11.5, -23.3, { timeout: 10000 });
    await aimCamera(page, -Math.PI / 2, 0.1);
    await sleep(300);
    await shot(page, "05-east-wall-70-80-100.png");

    // ── 5. Collision: the annex walls hold; the door is the only way in. ──
    const westPush = await walkTo(page, -26, -26, { timeout: 3500 });
    log.westPush = westPush;
    if (!(westPush.x >= GALLERY.minX + 0.3)) {
      failures.push(`pushed through the gallery WEST wall (x=${westPush.x.toFixed(2)})`);
    }
    const northPush = await walkTo(page, -15, -36, { timeout: 3500 });
    log.northPush = northPush;
    if (!(northPush.z >= GALLERY.minZ + 0.3)) {
      failures.push(`pushed through the gallery NORTH wall (z=${northPush.z.toFixed(2)})`);
    }
    // Exit through the door, then push at the SEALED lounge wall west of it.
    await walkTo(page, -15, -20, { timeout: 10000 });
    await walkTo(page, -15, -16, { timeout: 8000 });
    await walkTo(page, -27, -16, { timeout: 14000 });
    const sealedPush = await walkTo(page, -27, -20, { timeout: 3500 });
    log.sealedPush = sealedPush;
    if (!(sealedPush.z >= -18 + 0.3)) {
      failures.push(`crossed the lounge north wall OFF the door (z=${sealedPush.z.toFixed(2)})`);
    }

    // ── 6. M overview: the fit derives from WORLD_BOUNDS → annex included. ──
    await page.locator("canvas").click();
    await page.keyboard.press("m");
    const view = await pollUntil(() => getView(page), (v) => v.mode === "ov" && v.ovBlend > 0.98, 6000);
    log.overview = { mode: view.mode, ovBlend: view.ovBlend };
    if (view.mode !== "ov") failures.push(`M did not enter overview (mode=${view.mode})`);
    await sleep(400);
    await shot(page, "06-overview-with-gallery.png");
    await page.keyboard.press("m"); // leave overview before teardown

    // ── 7. Zero console/page errors, zero local 4xx/5xx. ──
    log.errors = errors;
    if (errors.length) failures.push(`console/page errors:\n  ${errors.join("\n  ")}`);
  } catch (err) {
    failures.push(`exception: ${err instanceof Error ? err.stack || err.message : String(err)}`);
  } finally {
    log.failures = failures;
    writeFileSync(join(EVIDENCE, "assertions.json"), JSON.stringify(log, null, 2));
    await browser.close();
  }

  console.log("gallery:", JSON.stringify(log.gallery?.map((g) => ({ age: g.age, loaded: g.loaded, mean: Math.round(g.mean ?? -1) }))));
  console.log("photo 200s:", JSON.stringify(log.photoResponses));
  console.log("entered:", JSON.stringify(log.entered));
  console.log("westPush:", JSON.stringify(log.westPush), "northPush:", JSON.stringify(log.northPush), "sealedPush:", JSON.stringify(log.sealedPush));
  console.log("overview:", JSON.stringify(log.overview));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — 9 portraits loaded & lit, walls hold, door-only entry, overview covers the annex, zero errors.");
}

main();
