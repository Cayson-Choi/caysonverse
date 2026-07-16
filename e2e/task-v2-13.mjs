// v2 Task 13 E2E: 왕실 캐릭터 재제작 — 왕실 의상 합성 (design 28).
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5179 →
// server :2573 — other ports belong to parallel lanes):
//   PORT=2573 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2573 npx vite --port 5179
//
// Proves design 28 end to end:
//   1. Entry screen: the 8-preset grid; selecting a royal DISABLES all tint
//      swatches with the "왕실 의상은 고정 색상입니다" notice; a base preset
//      re-enables them (screenshots both states).
//   2. Each royal joins and reads AS royalty up close: fixed palette built
//      (__cvRoyalPalettes), no weapons, repainted cape, crown — front and back
//      cuts per royal (screenshots are the human guard for the recipes).
//   3. Side-by-side: a base knight (tab B) stands next to the king (tab A) —
//      B's REMOTE render of the king builds the same palette (asserted via
//      __cvRoyalPalettes on B) and the difference is obvious in one frame.
//   4. Princess seat cycle: sit → peplum hidden (__cvRoyalPeplums() → [false]),
//      stand → restored ([true]); prince walking cut (epaulettes + cape).
//   5. Zero console/page errors, zero local 4xx/5xx.
//      Evidence → .superpowers/sdd/evidence/task-v2-13/.
//
// Automated assertions carry correctness; screenshots are the human guard.
// Exit 0 = pass.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5179";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-13");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

/** CameraRig drag sensitivity (rad per px) — assert-only copy for aimCamera. */
const DRAG_SPEED = 0.005;
/**
 * Measured drag→orbit response signs (design 29 flips the drag direction — a
 * parallel lane — so this script CALIBRATES instead of assuming, staying green
 * on either side of that landing). Keyed per page via a WeakMap.
 */
const dragSigns = new WeakMap();
/** Student seat 3 (2.7, 3) — the chair nearest the divider door from spawn. */
const SEAT_INDEX = 3;
const SEAT_POS = { x: 2.7, z: 3 };

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getPalettes = (page) => page.evaluate(() => window.__cvRoyalPalettes?.() ?? []);
const getPeplums = (page) => page.evaluate(() => window.__cvRoyalPeplums?.() ?? []);

function watchErrors(page, tag, sink) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged via network events
    sink.push(`[${tag}] console.error: ${text}`);
  });
  page.on("pageerror", (err) => sink.push(`[${tag}] pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) {
      sink.push(`[${tag}] local ${r.status()}: ${r.url()}`);
    }
  });
}

/** Join as `characterLabel`. Royals have DISABLED swatches — skip the tint. */
async function joinAs(page, { nickname, characterLabel, tintIndex = null }) {
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-character", { hasText: new RegExp(`^${characterLabel}$`) }).click();
  if (tintIndex !== null) await page.getByLabel(`색상 ${tintIndex + 1}`).click();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getPos === "function", null, {
    timeout: 45000,
  });
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

/** One canvas drag by (dx, dy) pixels from the viewport centre. */
async function drag(page, dx, dy) {
  const box = await page.locator("canvas").boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + dx, cy + dy, { steps: 8 });
  await page.mouse.up();
  await sleep(120);
}

/**
 * Aim the third-person camera by dragging on the canvas until orbit yaw/pitch
 * reach the targets. First CALIBRATES the drag→orbit signs with one probe drag
 * (see dragSigns), then iterates because the pixel→radian mapping saturates at
 * viewport edges.
 */
async function aimCamera(page, targetYaw, targetPitch, tries = 8) {
  const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  let signs = dragSigns.get(page);
  if (!signs) {
    // A BIG probe drag: anything under CLICK_MAX_PX would be a click-to-move
    // (design 29) and walk the avatar instead of rotating the camera.
    const before = await getOrbit(page);
    await drag(page, 200, 60);
    const after = await getOrbit(page);
    signs = {
      yaw: Math.sign(norm(after.yaw - before.yaw)) || -1,
      pitch: Math.sign(after.pitch - before.pitch) || 1,
    };
    dragSigns.set(page, signs);
  }
  for (let i = 0; i < tries; i++) {
    const { yaw, pitch } = await getOrbit(page);
    const dYaw = norm(targetYaw - yaw);
    const dPitch = targetPitch - pitch;
    if (Math.abs(dYaw) < 0.04 && Math.abs(dPitch) < 0.04) break;
    const dx = Math.max(-350, Math.min(350, (signs.yaw * dYaw) / DRAG_SPEED));
    const dy = Math.max(-250, Math.min(250, (signs.pitch * dPitch) / DRAG_SPEED));
    // Never issue a sub-click-threshold drag (it would WALK the avatar): treat
    // a correction this small as converged.
    if (Math.hypot(dx, dy) < 12) break;
    await drag(page, dx, dy);
  }
  return getOrbit(page);
}

/** Zoom the TP camera in/out via wheel (zoomSpeed 0.01 m per delta unit). */
async function zoomBy(page, metres) {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, metres / 0.01);
  await sleep(200);
}

/** Face cut: put the camera ON the model's facing side, slightly above. */
async function frontCut(page, name, { zoom = -3 } = {}) {
  const { yaw } = await getPos(page);
  await aimCamera(page, yaw, 0.15);
  if (zoom) await zoomBy(page, zoom);
  await sleep(300);
  await shot(page, name);
}

/** Back cut: camera behind the model (cape side). */
async function backCut(page, name) {
  const { yaw } = await getPos(page);
  await aimCamera(page, yaw + Math.PI, 0.15);
  await sleep(300);
  await shot(page, name);
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  const errors = [];
  try {
    // ── 1. Entry screen: 8-preset grid + royal tint lockout. ──
    const ctxE = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageE = await ctxE.newPage();
    watchErrors(pageE, "entry", errors);
    await pageE.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
    await pageE.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 20000 });
    const labels = await pageE.locator(".cv-character").allTextContents();
    log.characters = labels;
    if (labels.length !== 8) failures.push(`entry grid has ${labels.length} presets (want 8)`);
    for (const royal of ["왕", "왕비", "공주", "왕자"]) {
      if (!labels.includes(royal)) failures.push(`entry grid missing royal "${royal}"`);
    }
    await shot(pageE, "00-entry-grid.png");

    // Selecting a royal disables all 8 swatches and shows the fixed-color note.
    await pageE.locator(".cv-character", { hasText: /^왕비$/ }).click();
    const disabledCount = await pageE.locator(".cv-swatch:disabled").count();
    const note = (await pageE.locator(".cv-swatch-note").textContent().catch(() => "")) ?? "";
    log.royalLockout = { disabledCount, note };
    if (disabledCount !== 8) failures.push(`royal selection disables ${disabledCount}/8 swatches`);
    if (!note.includes("왕실 의상은 고정 색상입니다")) {
      failures.push(`fixed-color note missing/wrong: "${note}"`);
    }
    await shot(pageE, "01-entry-royal-locked.png");

    // Back to a base preset: swatches usable again, note gone.
    await pageE.locator(".cv-character", { hasText: /^기사$/ }).click();
    const reEnabled = await pageE.locator(".cv-swatch:not(:disabled)").count();
    const noteGone = await pageE.locator(".cv-swatch-note").count();
    if (reEnabled !== 8) failures.push(`base selection re-enables ${reEnabled}/8 swatches`);
    if (noteGone !== 0) failures.push("fixed-color note still visible for a base preset");
    await ctxE.close();

    // ── 2+3. King (tab A) + base knight (tab B): royal cuts + side-by-side. ──
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageA = await ctxA.newPage();
    watchErrors(pageA, "A/king", errors);
    await joinAs(pageA, { nickname: "폐하", characterLabel: "왕" });
    // NOTE: no canvas click — design 29 click-to-move would walk the avatar.

    const palettesA = await pollUntil(() => getPalettes(pageA), (p) => p.includes("king"));
    log.kingPalette = palettesA;
    if (!palettesA.includes("king")) failures.push("tab A never built the king palette");

    await frontCut(pageA, "10-king-front.png");
    await backCut(pageA, "11-king-back-cape.png");

    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageB = await ctxB.newPage();
    watchErrors(pageB, "B/knight", errors);
    await joinAs(pageB, { nickname: "기사단장", characterLabel: "기사", tintIndex: 2 });
    // NOTE: no canvas click — design 29 click-to-move would walk the avatar.

    // B renders the king REMOTELY through the same palette path (design 28:
    // 원격 렌더 동일 규칙) — the cache on B's page must gain "king".
    const palettesB = await pollUntil(() => getPalettes(pageB), (p) => p.includes("king"), 15000);
    log.remoteKingPaletteOnB = palettesB;
    if (!palettesB.includes("king")) failures.push("tab B (remote view) never built the king palette");

    // Stand B beside the king and frame BOTH. The camera is aimed OFF the
    // B→king axis: aiming straight at the king puts B's own avatar exactly in
    // front of him (first pass eclipsed the king behind the knight's back).
    const kingPos = await pageA.evaluate(() => window.__cv.getPos());
    await walkTo(pageB, kingPos.x + 2.4, kingPos.z + 2.4, { timeout: 15000 });
    const bPos = await getPos(pageB);
    const toKing = Math.atan2(-(kingPos.x - bPos.x), -(kingPos.z - bPos.z));
    await aimCamera(pageB, toKing + 0.55, 0.12);
    await sleep(400);
    await shot(pageB, "12-knight-vs-remote-king.png");
    await ctxB.close();
    await ctxA.close();
    // Closed tabs linger as 50%-opacity ghosts for RECONNECT_WINDOW_S (20s) —
    // wait it out so they can't photobomb the next royal's cuts.
    await sleep(21000);

    // ── Queen: fixed purple+gold gown, train, medallion; front/back cuts. ──
    const ctxQ = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageQ = await ctxQ.newPage();
    watchErrors(pageQ, "queen", errors);
    await joinAs(pageQ, { nickname: "왕비마마", characterLabel: "왕비" });
    // NOTE: no canvas click — design 29 click-to-move would walk the avatar.
    const palettesQ = await pollUntil(() => getPalettes(pageQ), (p) => p.includes("queen"));
    if (!palettesQ.includes("queen")) failures.push("queen palette never built");
    await frontCut(pageQ, "20-queen-front.png");
    await backCut(pageQ, "21-queen-back-train.png");
    await ctxQ.close();
    await sleep(21000); // ghost window (see above)

    // ── Princess: rose dress + peplum; seat cycle hides/restores the peplum. ──
    const ctxP = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageP = await ctxP.newPage();
    watchErrors(pageP, "princess", errors);
    await joinAs(pageP, { nickname: "공주님", characterLabel: "공주" });
    // NOTE: no canvas click — design 29 click-to-move would walk the avatar.
    const palettesP = await pollUntil(() => getPalettes(pageP), (p) => p.includes("princess"));
    if (!palettesP.includes("princess")) failures.push("princess palette never built");

    const peplumStanding = await pollUntil(() => getPeplums(pageP), (p) => p.length === 1);
    log.peplumStanding = peplumStanding;
    if (!(peplumStanding.length === 1 && peplumStanding[0] === true)) {
      failures.push(`standing peplum state ${JSON.stringify(peplumStanding)} (want [true])`);
    }
    await frontCut(pageP, "30-princess-front.png");
    await backCut(pageP, "31-princess-back-cape-peplum.png");

    // Walk through the divider door to seat 3, then a server-validated Sit.
    await walkTo(pageP, -2, 0.3, { timeout: 20000 });
    await walkTo(pageP, 1.6, 0.6, { timeout: 12000 });
    await walkTo(pageP, SEAT_POS.x - 0.4, SEAT_POS.z - 0.7, { tol: 0.5, timeout: 12000 });
    await pageP.evaluate((i) => window.__cv.sit(i), SEAT_INDEX);
    const seated = await pollUntil(() => getPos(pageP), (p) => p.seatIndex === SEAT_INDEX, 8000);
    if (seated.seatIndex !== SEAT_INDEX) {
      failures.push(`princess never seated (seatIndex=${seated.seatIndex})`);
    }
    // The sit-down clip must drive the hips past the threshold → peplum hides.
    const peplumSeated = await pollUntil(() => getPeplums(pageP), (p) => p[0] === false, 6000);
    log.peplumSeated = peplumSeated;
    if (peplumSeated[0] !== false) failures.push("seated peplum still visible (knee clipping!)");
    await sleep(600);
    await aimCamera(pageP, Math.PI, 0.25);
    await sleep(300);
    await shot(pageP, "32-princess-seated-peplum-hidden.png");

    // Stand back up → the pose returns below the threshold → peplum restored.
    await pageP.evaluate(() => window.__cv.stand());
    await pollUntil(() => getPos(pageP), (p) => p.seatIndex === -1, 8000);
    const peplumRestored = await pollUntil(() => getPeplums(pageP), (p) => p[0] === true, 6000);
    log.peplumRestored = peplumRestored;
    if (peplumRestored[0] !== true) failures.push("peplum not restored after standing");
    await sleep(400);
    await shot(pageP, "33-princess-stood-peplum-restored.png");
    await ctxP.close();
    await sleep(21000); // ghost window (see above)

    // ── Prince: gold plate + blue cape + epaulettes; idle front + walking cut. ──
    const ctxR = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const pageR = await ctxR.newPage();
    watchErrors(pageR, "prince", errors);
    await joinAs(pageR, { nickname: "왕자님", characterLabel: "왕자" });
    // NOTE: no canvas click — design 29 click-to-move would walk the avatar.
    const palettesR = await pollUntil(() => getPalettes(pageR), (p) => p.includes("prince"));
    if (!palettesR.includes("prince")) failures.push("prince palette never built");
    await frontCut(pageR, "40-prince-front.png");
    // Walking cut from behind: cape + epaulettes in motion.
    const { yaw } = await getPos(pageR);
    await aimCamera(pageR, yaw + Math.PI, 0.2);
    await pageR.keyboard.down("w");
    await sleep(700);
    await shot(pageR, "41-prince-walking-back.png");
    await pageR.keyboard.up("w");
    await ctxR.close();

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

  console.log("characters:", JSON.stringify(log.characters));
  console.log("royalLockout:", JSON.stringify(log.royalLockout));
  console.log("kingPalette(A):", JSON.stringify(log.kingPalette));
  console.log("remoteKingPalette(B):", JSON.stringify(log.remoteKingPaletteOnB));
  console.log("peplum standing/seated/restored:",
    JSON.stringify(log.peplumStanding),
    JSON.stringify(log.peplumSeated),
    JSON.stringify(log.peplumRestored));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log(
    "\nE2E PASSED — royal tint lockout, 4 royal palettes (local + remote), peplum seat cycle, zero errors.",
  );
}

main();
