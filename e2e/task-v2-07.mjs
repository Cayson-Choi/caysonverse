// v2 Task 7 E2E: 1인칭 시선 동행 + 오버뷰(맵 전체 보기) 모드.
//
// Standalone Playwright (same shape as task-v2-05), against the default dev stack
// (client :5173, server :2567 — this task's OWN ports). One desktop tab is enough
// (the feature is pure client). Proves design 20 end to end:
//
//   1. FP 진입 → A(strafe-left) 홀드 → the FP look yaw swings LEFT (numeric,
//      accumulated wrap-safe) and the avatar actually moves (curved follow).
//   2. M → overview: the camera lifts to the whole-map fit height, centred on the
//      map; own avatar shown; self-marker visible (mode === 'ov'). Full-map shot.
//   3. In overview: drag-pan moves the centre (clamped in bounds), wheel zoom
//      changes the height (clamped), and W moves the avatar toward -Z (screen
//      north) while the camera stays put (does NOT follow).
//   4. M → restores the PREVIOUS mode (FP) with the FP look yaw preserved; a TP
//      round-trip (V→TP, M→ov, M→TP) preserves the orbit.
//   5. Zero console/page errors. Evidence → evidence/task-v2-07/.
//
// Exit 0 = pass. Numeric assertions carry correctness; screenshots are the human
// guard.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-07");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getView = (page) => page.evaluate(() => window.__cv.getView());
const getCamera = (page) => page.evaluate(() => window.__cvCamera());
const getSelfVisible = (page) => page.evaluate(() => window.__cv.getSelfVisible());

const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a)); // → [-π, π]

function watchErrors(page, tag) {
  const errors = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return;
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
  await page.waitForFunction(() => typeof window.__cvCamera === "function", null, { timeout: 20000 });
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

/** Move the mouse over the canvas centre, then scroll the wheel by deltaY. */
async function wheel(page, deltaY, times = 1) {
  const box = await page.locator("canvas").boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  for (let i = 0; i < times; i++) {
    await page.mouse.wheel(0, deltaY);
    await sleep(60);
  }
}

/** One-finger drag on the canvas (synthetic PointerEvents — reliable headless). */
async function dragCanvas(page, { fromX, fromY, dx, dy = 0 }) {
  await page.evaluate(
    ({ fromX, fromY, dx, dy }) => {
      const canvas = document.querySelector(".cv-canvas canvas");
      const mk = (type, x, y) =>
        new PointerEvent(type, {
          pointerId: 7,
          pointerType: "touch",
          isPrimary: true,
          clientX: x,
          clientY: y,
          bubbles: true,
          cancelable: true,
        });
      canvas.dispatchEvent(mk("pointerdown", fromX, fromY));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.34, fromY + dy * 0.34));
      canvas.dispatchEvent(mk("pointermove", fromX + dx * 0.67, fromY + dy * 0.67));
      canvas.dispatchEvent(mk("pointermove", fromX + dx, fromY + dy));
      window.dispatchEvent(mk("pointerup", fromX + dx, fromY + dy));
    },
    { fromX, fromY, dx, dy },
  );
  await sleep(150);
}

/** Yaw-aware steer to (tx,tz) using the live camera basis (works in TP/FP). */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 12000 } = {}) {
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
    await joinAs(page, { nickname: "오버뷰앨리스", characterLabel: "기사", tintIndex: 0 });
    await page.bringToFront();
    await page.locator("canvas").click();

    // Move to an open lounge spot so the FP curved-follow isn't wall-jammed.
    await walkTo(page, -12, 4, { timeout: 9000 });

    // ─────────────── 1. FP look-follows-movement (A → swings LEFT) ───────────────
    await page.keyboard.press("v");
    const fpEnter = await pollUntil(() => getView(page), (v) => v.mode === "fp" && v.blend > 0.99, 5000);
    if (fpEnter.mode !== "fp") failures.push("did not enter FP on V");

    const fpYaw0 = (await getView(page)).fpYaw;
    const pos0 = await getPos(page);
    // Hold A and accumulate the wrap-safe yaw change (left = positive).
    await page.keyboard.down("a");
    let prev = fpYaw0;
    let accum = 0;
    const holdDeadline = Date.now() + 1200;
    while (Date.now() < holdDeadline) {
      await sleep(150);
      const cur = (await getView(page)).fpYaw;
      accum += norm(cur - prev);
      prev = cur;
    }
    await page.keyboard.up("a");
    await sleep(120);
    const pos1 = await getPos(page);
    const moved = Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z);
    log.fpFollow = { fpYaw0, accumYaw: accum, moved };
    if (accum < 1.0) failures.push(`FP look did not swing LEFT on A-hold (Σ ${accum.toFixed(3)} rad, want > 1.0)`);
    if (moved < 0.3) failures.push(`FP avatar did not move during the curved follow (moved ${moved.toFixed(3)}m)`);
    await shot(page, "01-fp-follow.png");

    // W should cause ZERO look rotation (forward = current look).
    const yBeforeW = (await getView(page)).fpYaw;
    await page.keyboard.down("w");
    await sleep(500);
    await page.keyboard.up("w");
    const yAfterW = (await getView(page)).fpYaw;
    log.fpForwardNoRotate = { yBeforeW, yAfterW, delta: Math.abs(norm(yAfterW - yBeforeW)) };
    if (Math.abs(norm(yAfterW - yBeforeW)) > 0.15) {
      failures.push(`W (straight forward) rotated the FP look (Δ ${log.fpForwardNoRotate.delta.toFixed(3)} rad, want ~0)`);
    }

    // ─────────────────────────── 2. M → overview ───────────────────────────
    const fpYawAtOv = (await getView(page)).fpYaw; // must survive the overview round-trip
    await page.keyboard.press("m");
    const ovView = await pollUntil(() => getView(page), (v) => v.mode === "ov" && v.ovBlend > 0.99, 5000);
    const ovCam = await pollUntil(() => getCamera(page), (c) => c.mode === "ov" && c.ovBlend > 0.99, 5000);
    const ovSelfVisible = await getSelfVisible(page);
    log.overview = {
      mode: ovView.mode,
      camY: ovCam.y,
      center: { x: ovView.ovCenterX, z: ovView.ovCenterZ },
      height: ovView.ovHeight,
      prevMode: ovView.prevMode,
      selfVisible: ovSelfVisible,
    };
    if (ovView.mode !== "ov") failures.push("M did not enter overview");
    if (ovView.prevMode !== "fp") failures.push(`overview did not remember FP as the previous mode (got ${ovView.prevMode})`);
    if (!(ovCam.y > 45 && ovCam.y < 85)) failures.push(`overview camera not at whole-map fit height (y=${ovCam.y.toFixed(1)})`);
    if (Math.abs(ovView.ovCenterX - -18) > 2 || Math.abs(ovView.ovCenterZ) > 2) {
      failures.push(`overview not centred on the map (centre ${ovView.ovCenterX.toFixed(1)},${ovView.ovCenterZ.toFixed(1)})`);
    }
    if (ovSelfVisible !== true) failures.push("own avatar hidden in overview (should be shown as 3rd-person + marker)");
    await shot(page, "02-overview-map.png"); // whole map: maze + lounge + lecture hall + marker

    // ───────────── 3. overview pan + zoom + screen-relative movement ─────────────
    const cx0 = (await getView(page)).ovCenterX;
    await dragCanvas(page, { fromX: 900, fromY: 400, dx: -260, dy: 0 }); // drag left → pan
    const cx1 = (await getView(page)).ovCenterX;
    log.pan = { cx0, cx1, dCenter: Math.abs(cx1 - cx0) };
    if (Math.abs(cx1 - cx0) < 3) failures.push(`overview drag did not pan the centre (Δ ${log.pan.dCenter.toFixed(2)})`);
    if (cx1 < -66 || cx1 > 30) failures.push(`overview pan centre left the world bounds (x=${cx1.toFixed(1)})`);

    const h0 = (await getView(page)).ovHeight;
    await wheel(page, -120, 4); // zoom IN (lower)
    const h1 = (await getView(page)).ovHeight;
    log.zoom = { h0, h1 };
    if (h1 >= h0) failures.push(`overview wheel-in did not lower the camera (h ${h0.toFixed(1)} → ${h1.toFixed(1)})`);
    if (h1 < 15) failures.push(`overview height dived below the floor (${h1.toFixed(1)} < 15)`);
    await wheel(page, -120, 40); // slam in → must clamp at the floor
    const hFloor = (await getView(page)).ovHeight;
    if (Math.abs(hFloor - 15) > 0.001) failures.push(`overview height floor clamp failed (${hFloor.toFixed(2)}, want 15)`);
    await wheel(page, 120, 8); // back out a little for the screenshot
    await shot(page, "03-overview-panzoom.png");

    // W (screen north) moves the avatar toward -Z; the camera does NOT follow.
    const pOv0 = await getPos(page);
    const camOv0 = await getCamera(page);
    await page.keyboard.down("w");
    await sleep(650);
    await page.keyboard.up("w");
    await sleep(120);
    const pOv1 = await getPos(page);
    const camOv1 = await getCamera(page);
    const camFollowed = Math.hypot(camOv1.x - camOv0.x, camOv1.z - camOv0.z);
    log.ovMove = { dz: pOv1.z - pOv0.z, dx: pOv1.x - pOv0.x, camFollowed };
    if (!(pOv1.z < pOv0.z - 0.4)) failures.push(`overview W did not move the avatar north/-Z (Δz ${(pOv1.z - pOv0.z).toFixed(3)})`);
    if (camFollowed > 0.5) failures.push(`overview camera followed the avatar (moved ${camFollowed.toFixed(2)}m; it must stay panned)`);

    // ───────────── 4. M → restore FP (fpYaw preserved); TP round-trip ─────────────
    await page.keyboard.press("m");
    const backFp = await pollUntil(() => getView(page), (v) => v.mode === "fp" && v.ovBlend < 0.01, 5000);
    log.restoreFp = { mode: backFp.mode, fpYawAtOv, fpYawBack: backFp.fpYaw, dYaw: Math.abs(norm(backFp.fpYaw - fpYawAtOv)) };
    if (backFp.mode !== "fp") failures.push(`overview exit did not restore FP (got ${backFp.mode})`);
    if (Math.abs(norm(backFp.fpYaw - fpYawAtOv)) > 0.02) {
      failures.push(`FP look yaw not preserved across overview (${fpYawAtOv.toFixed(3)} → ${backFp.fpYaw.toFixed(3)})`);
    }

    // V → TP, then a TP overview round-trip preserving the orbit.
    await page.keyboard.press("v");
    await pollUntil(() => getView(page), (v) => v.mode === "tp" && v.blend < 0.01, 4000);
    const orbitBefore = await getOrbit(page);
    await page.keyboard.press("m");
    const ovFromTp = await pollUntil(() => getView(page), (v) => v.mode === "ov" && v.ovBlend > 0.99, 5000);
    if (ovFromTp.prevMode !== "tp") failures.push(`TP overview did not remember TP (got ${ovFromTp.prevMode})`);
    await page.keyboard.press("m");
    const backTp = await pollUntil(() => getView(page), (v) => v.mode === "tp" && v.ovBlend < 0.01, 5000);
    const orbitAfter = await getOrbit(page);
    log.restoreTp = {
      mode: backTp.mode,
      dYaw: Math.abs(norm(orbitAfter.yaw - orbitBefore.yaw)),
      dDist: Math.abs(orbitAfter.distance - orbitBefore.distance),
      dPitch: Math.abs(orbitAfter.pitch - orbitBefore.pitch),
    };
    if (backTp.mode !== "tp") failures.push(`TP overview exit did not restore TP (got ${backTp.mode})`);
    if (log.restoreTp.dYaw > 0.02 || log.restoreTp.dDist > 0.02 || log.restoreTp.dPitch > 0.02) {
      failures.push(`TP orbit not preserved across overview (${JSON.stringify(log.restoreTp)})`);
    }
    await shot(page, "04-restored-tp.png");

    // ─────────────────────── 5. Zero console/page errors ───────────────────────
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

  console.log("FP follow (A→left):", JSON.stringify(log.fpFollow));
  console.log("FP forward no-rotate:", JSON.stringify(log.fpForwardNoRotate));
  console.log("overview:", JSON.stringify(log.overview));
  console.log("pan:", JSON.stringify(log.pan), " zoom:", JSON.stringify(log.zoom));
  console.log("overview move (W→-Z, cam static):", JSON.stringify(log.ovMove));
  console.log("restore FP:", JSON.stringify(log.restoreFp));
  console.log("restore TP:", JSON.stringify(log.restoreTp));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — FP look-follows-movement + overview (fit/pan/zoom/marker/restore).");
}

main();
