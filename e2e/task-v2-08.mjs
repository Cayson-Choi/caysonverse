// v2 Task 8 E2E: 모바일 1인칭 D-패드 (슬라이드 8방향 이산 입력).
//
// Standalone Playwright (same shape as task-10/task-v2-07), against the default
// dev stack (client :5173, server :2567 — this task's OWN ports). One mobile
// context (iPhone 14 emulation: 390x844, hasTouch). Proves design 21 end to end:
//
//   1. Join → joystick shows (TP). 👁 tap → FP: the D-pad replaces the joystick.
//      Reverse-toggle once (FP→TP): the joystick returns, the D-pad unmounts.
//   2. Touch-hold the ▲ point 1.5 s → fpYaw is STABLE (Σ|Δ| < 0.02 rad — the
//      keyboard-exact zero-δ forward) and the avatar advances along the look
//      direction. ▲ chip highlighted.
//   3. Without lifting, slide to the ◀ sector → fpYaw swings LEFT (positive
//      wrap-safe accumulation, same convention as task-v2-07's A-hold) — the
//      curved turn. ◀ chip highlighted; a diagonal slide lights two chips.
//   4. Tremble simulation (this task's reason to exist): oscillate the touch
//      angle ±8° around ▲ 6 times → fpYaw Σ|Δ| < 0.05 rad (quantization kills
//      the analog jitter that used to saturate the follow loop at 143°/s).
//      4b. Boundary wobble 22.5°±9° with a held ▲ → sector sticks (hysteresis),
//      fpYaw still stable.
//   5. Release → the avatar stops. 5b. Mid-hold 👁 switch (FP→TP while ▲ held) →
//      movement stops (unmount cleanup zeroes the shared moveInput — no stuck
//      walk across the mount switch), then the joystick still drives movement.
//   6. Zero console/page errors. Evidence → evidence/task-v2-08/.
//
// Exit 0 = pass. Numeric assertions carry correctness; screenshots are the
// human guard.

import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-08");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());
const getView = (page) => page.evaluate(() => window.__cv.getView());
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
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

/** Yaw-aware keyboard steer to (tx,tz) — TP only (keyboard works on touch too). */
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

// ── D-pad driver: synthetic touch PointerEvents at an ANGLE (deg clockwise from
// ▲/north, r = fraction of the pad radius). down targets the zone; moves go to
// document (TouchDpad listens on window — the nipplejs-style contract); up/cancel
// on window. pointerId 42 avoids colliding with Playwright's own pointers.
const DPAD_PTR = 42;

function dpadEval(page, fn, arg) {
  return page.evaluate(fn, arg);
}

async function dpadDown(page, deg, r = 0.8) {
  await dpadEval(
    page,
    ({ deg, r, id }) => {
      const zone = document.querySelector(".cv-dpad-zone");
      const rect = zone.getBoundingClientRect();
      const rad = (deg * Math.PI) / 180;
      const radius = Math.min(rect.width, rect.height) / 2;
      const x = rect.left + rect.width / 2 + Math.sin(rad) * r * radius;
      const y = rect.top + rect.height / 2 - Math.cos(rad) * r * radius; // screen up = smaller clientY
      zone.dispatchEvent(
        new PointerEvent("pointerdown", {
          pointerId: id, pointerType: "touch", isPrimary: true,
          clientX: x, clientY: y, bubbles: true, cancelable: true,
        }),
      );
    },
    { deg, r, id: DPAD_PTR },
  );
}

async function dpadMove(page, deg, r = 0.8) {
  await dpadEval(
    page,
    ({ deg, r, id }) => {
      const zone = document.querySelector(".cv-dpad-zone");
      const rect = zone.getBoundingClientRect();
      const rad = (deg * Math.PI) / 180;
      const radius = Math.min(rect.width, rect.height) / 2;
      const x = rect.left + rect.width / 2 + Math.sin(rad) * r * radius;
      const y = rect.top + rect.height / 2 - Math.cos(rad) * r * radius;
      document.dispatchEvent(
        new PointerEvent("pointermove", {
          pointerId: id, pointerType: "touch", isPrimary: true,
          clientX: x, clientY: y, bubbles: true, cancelable: true,
        }),
      );
    },
    { deg, r, id: DPAD_PTR },
  );
}

async function dpadUp(page) {
  await dpadEval(
    page,
    ({ id }) => {
      window.dispatchEvent(
        new PointerEvent("pointerup", {
          pointerId: id, pointerType: "touch", isPrimary: true,
          bubbles: true, cancelable: true,
        }),
      );
    },
    { id: DPAD_PTR },
  );
}

/** Sample fpYaw every stepMs for durMs; returns Σ|wrap-safe Δ| and Σ(signed Δ). */
async function trackYaw(page, durMs, stepMs = 120) {
  let prev = (await getView(page)).fpYaw;
  let absAccum = 0;
  let accum = 0;
  const deadline = Date.now() + durMs;
  while (Date.now() < deadline) {
    await sleep(stepMs);
    const cur = (await getView(page)).fpYaw;
    const d = norm(cur - prev);
    absAccum += Math.abs(d);
    accum += d;
    prev = cur;
  }
  return { absAccum, accum };
}

/** Drive the nipplejs joystick (task-10 pattern) — post-switch regression check. */
async function driveJoystick(page, { dx, dy, holdMs }) {
  await page.evaluate(
    ({ dx, dy }) => {
      const zone = document.querySelector(".cv-joystick-zone");
      const r = zone.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const mk = (type, x, y) =>
        new PointerEvent(type, {
          pointerId: 1, pointerType: "touch", isPrimary: true,
          clientX: x, clientY: y, bubbles: true, cancelable: true,
        });
      zone.dispatchEvent(mk("pointerdown", cx, cy));
      document.dispatchEvent(mk("pointermove", cx + dx, cy + dy));
    },
    { dx, dy },
  );
  await sleep(holdMs);
  await page.evaluate(() => {
    document.dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: 1, pointerType: "touch", isPrimary: true, bubbles: true, cancelable: true,
      }),
    );
  });
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
    const ctx = await browser.newContext({
      ...devices["iPhone 14"],
      viewport: { width: 390, height: 844 },
    });
    const page = await ctx.newPage();
    allErrors.push(watchErrors(page, "mobile"));
    await joinAs(page, { nickname: "디패드테스터", characterLabel: "기사", tintIndex: 1 });

    // Open corridor for the FP forward hold: (-9, 6) with a clear 6 m north run
    // (plants sit at x=-3, the sofa cluster at x≤-15). orbit.yaw is untouched (no
    // drag), so the FP look will seed to yaw 0 = north (-Z).
    await walkTo(page, -9, 6, { timeout: 12000 });

    // ─────────── 1. Mount switch: TP joystick ↔ FP D-pad (both directions) ───────────
    log.tpJoystick = {
      joystick: await page.locator(".cv-joystick-zone").count(),
      dpad: await page.locator(".cv-dpad-zone").count(),
    };
    if (log.tpJoystick.joystick !== 1 || log.tpJoystick.dpad !== 0) {
      failures.push(`TP should show joystick only (got ${JSON.stringify(log.tpJoystick)})`);
    }
    await shot(page, "01-tp-joystick.png");

    await page.locator(".cv-view-btn").tap();
    const fpEnter = await pollUntil(() => getView(page), (v) => v.mode === "fp" && v.blend > 0.99, 5000);
    if (fpEnter.mode !== "fp") failures.push("👁 tap did not enter FP");
    log.fpDpad = {
      joystick: await page.locator(".cv-joystick-zone").count(),
      dpad: await page.locator(".cv-dpad-zone").count(),
      dpadVisible: await page.locator(".cv-dpad-zone").isVisible().catch(() => false),
    };
    if (log.fpDpad.joystick !== 0 || log.fpDpad.dpad !== 1 || !log.fpDpad.dpadVisible) {
      failures.push(`FP should show D-pad only (got ${JSON.stringify(log.fpDpad)})`);
    }
    await shot(page, "02-fp-dpad.png");

    // Reverse toggle once: FP → TP restores the joystick, unmounts the D-pad.
    await page.locator(".cv-view-btn").tap();
    await pollUntil(() => getView(page), (v) => v.mode === "tp" && v.blend < 0.01, 5000);
    log.backToTp = {
      joystick: await page.locator(".cv-joystick-zone").count(),
      dpad: await page.locator(".cv-dpad-zone").count(),
    };
    if (log.backToTp.joystick !== 1 || log.backToTp.dpad !== 0) {
      failures.push(`FP→TP should restore the joystick (got ${JSON.stringify(log.backToTp)})`);
    }
    await shot(page, "03-back-tp-joystick.png");

    // Re-enter FP for the movement tests.
    await page.locator(".cv-view-btn").tap();
    await pollUntil(() => getView(page), (v) => v.mode === "fp" && v.blend > 0.99, 5000);

    // ─────────── 2. ▲ hold 1.5 s: fpYaw rock-stable + advance along the look ───────────
    const fpYaw0 = (await getView(page)).fpYaw;
    const p0 = await getPos(page);
    await dpadDown(page, 0); // ▲
    await sleep(120);
    const upActive = await page.locator(".cv-dpad-up.is-active").count();
    if (upActive !== 1) failures.push("▲ hold did not highlight the up chip");
    const fwdTrack = await trackYaw(page, 1500);
    await shot(page, "04-dpad-forward-hold.png");
    const p1 = await getPos(page);
    const disp = { x: p1.x - p0.x, z: p1.z - p0.z };
    const dispLen = Math.hypot(disp.x, disp.z);
    // FP forward for yaw φ is (-sin φ, -cos φ) — the look direction.
    const along = disp.x * -Math.sin(fpYaw0) + disp.z * -Math.cos(fpYaw0);
    log.forwardHold = { fpYaw0, absAccum: fwdTrack.absAccum, moved: dispLen, along };
    if (fwdTrack.absAccum >= 0.02) {
      failures.push(`▲ hold wobbled the FP look (Σ|Δ| ${fwdTrack.absAccum.toFixed(4)} rad, want < 0.02)`);
    }
    if (dispLen < 1.5) failures.push(`▲ hold did not advance the avatar (moved ${dispLen.toFixed(2)} m)`);
    if (along < 0.85 * dispLen) {
      failures.push(`▲ advance was not along the look (along ${along.toFixed(2)} of ${dispLen.toFixed(2)} m)`);
    }

    // ─────────── 3. Slide (no lift) ▲ → ◀: curved LEFT turn (positive yaw accum) ───────────
    await dpadMove(page, 270); // ◀ sector
    await sleep(120);
    const leftActive = await page.locator(".cv-dpad-left.is-active").count();
    const upStillActive = await page.locator(".cv-dpad-up.is-active").count();
    if (leftActive !== 1 || upStillActive !== 0) {
      failures.push(`◀ slide highlight wrong (left=${leftActive}, up=${upStillActive})`);
    }
    // Left strafe curves the look LEFT = positive wrap-safe accumulation (the
    // task-v2-07 A-hold convention; FP_FOLLOW_RATE 2.5 rad/s → ~2 rad in 0.8 s).
    const leftTrack = await trackYaw(page, 800, 100);
    log.slideLeft = { accum: leftTrack.accum, absAccum: leftTrack.absAccum };
    if (leftTrack.accum < 0.8) {
      failures.push(`◀ slide did not curve the look left (Σ ${leftTrack.accum.toFixed(3)} rad, want > 0.8)`);
    }
    await shot(page, "05-dpad-slide-left.png");

    // Diagonal: slide to ↖ (315°) — BOTH ▲ and ◀ chips light.
    await dpadMove(page, 315);
    await sleep(120);
    const diagUp = await page.locator(".cv-dpad-up.is-active").count();
    const diagLeft = await page.locator(".cv-dpad-left.is-active").count();
    log.diagonal = { up: diagUp, left: diagLeft };
    if (diagUp !== 1 || diagLeft !== 1) {
      failures.push(`↖ diagonal should light ▲+◀ (got up=${diagUp}, left=${diagLeft})`);
    }
    await dpadUp(page);
    await sleep(200);

    // ─────────── 4. Tremble ±8° around ▲, 6 cycles → look must NOT oscillate ───────────
    await dpadDown(page, 0);
    await sleep(100);
    let trembleAbs = 0;
    let prevYaw = (await getView(page)).fpYaw;
    for (let i = 0; i < 6; i++) {
      for (const deg of [8, -8]) {
        await dpadMove(page, deg);
        await sleep(80);
        const cur = (await getView(page)).fpYaw;
        trembleAbs += Math.abs(norm(cur - prevYaw));
        prevYaw = cur;
      }
    }
    log.tremble = { absAccum: trembleAbs };
    if (trembleAbs >= 0.05) {
      failures.push(
        `±8° tremble oscillated the FP look (Σ|Δ| ${trembleAbs.toFixed(4)} rad, want < 0.05) — quantization/hysteresis broken`,
      );
    }
    await shot(page, "06-tremble.png");

    // 4b. Boundary wobble: 22.5°±9° with ▲ held → hysteresis keeps sector 0.
    let boundaryAbs = 0;
    prevYaw = (await getView(page)).fpYaw;
    for (let i = 0; i < 4; i++) {
      for (const deg of [31.5, 13.5]) {
        await dpadMove(page, deg);
        await sleep(80);
        const cur = (await getView(page)).fpYaw;
        boundaryAbs += Math.abs(norm(cur - prevYaw));
        prevYaw = cur;
      }
    }
    const upHeld = await page.locator(".cv-dpad-up.is-active").count();
    log.boundaryWobble = { absAccum: boundaryAbs, upHeld };
    if (boundaryAbs >= 0.05) {
      failures.push(`boundary ±9° wobble broke hysteresis (Σ|Δ| ${boundaryAbs.toFixed(4)} rad, want < 0.05)`);
    }
    if (upHeld !== 1) failures.push("boundary wobble flipped the held ▲ sector (hysteresis)");

    // ─────────── 5. Release → full stop ───────────
    await dpadUp(page);
    await sleep(250);
    const stop0 = await getPos(page);
    await sleep(400);
    const stop1 = await getPos(page);
    log.releaseStop = { drift: dist2(stop0, stop1) };
    if (dist2(stop0, stop1) > 0.05) {
      failures.push(`release did not stop the avatar (drifted ${dist2(stop0, stop1).toFixed(3)} m)`);
    }

    // 5b. Mid-hold mount switch: ▲ held (moving) → 👁 to TP → movement must stop
    // (TouchDpad unmount zeroes the shared moveInput; nothing sticks).
    await dpadDown(page, 0);
    await sleep(300); // confirm we are moving
    const moving0 = await getPos(page);
    await sleep(300);
    const moving1 = await getPos(page);
    if (dist2(moving0, moving1) < 0.15) failures.push("pre-switch ▲ hold was not moving (setup)");
    await page.locator(".cv-view-btn").tap();
    await pollUntil(() => getView(page), (v) => v.mode === "tp", 5000);
    await sleep(250); // let any stranded intent show up
    const sw0 = await getPos(page);
    await sleep(400);
    const sw1 = await getPos(page);
    log.midHoldSwitch = { preMove: dist2(moving0, moving1), postDrift: dist2(sw0, sw1) };
    if (dist2(sw0, sw1) > 0.05) {
      failures.push(`FP→TP mid-hold stranded movement (drifted ${dist2(sw0, sw1).toFixed(3)} m after switch)`);
    }
    await shot(page, "07-switch-midhold-stopped.png");
    await dpadUp(page); // stray up for the now-gone pad — must be harmless

    // Joystick still drives movement after the switch (shared moveInput intact).
    const j0 = await getPos(page);
    await driveJoystick(page, { dx: 0, dy: -46, holdMs: 700 });
    await sleep(150);
    const j1 = await getPos(page);
    log.joystickAfterSwitch = { moved: dist2(j0, j1) };
    if (dist2(j0, j1) < 0.15) {
      failures.push(`joystick dead after the mode switch (moved ${dist2(j0, j1).toFixed(3)} m)`);
    }

    // ─────────── 6. Zero console/page errors ───────────
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

  console.log("mount TP (joystick only):", JSON.stringify(log.tpJoystick));
  console.log("mount FP (dpad only):", JSON.stringify(log.fpDpad));
  console.log("mount back to TP:", JSON.stringify(log.backToTp));
  console.log("▲ hold (want Σ|Δ|<0.02, moved>=1.5 along look):", JSON.stringify(log.forwardHold));
  console.log("◀ slide (want Σ>0.8 left):", JSON.stringify(log.slideLeft));
  console.log("↖ diagonal chips (want 1/1):", JSON.stringify(log.diagonal));
  console.log("tremble ±8° (want Σ|Δ|<0.05):", JSON.stringify(log.tremble));
  console.log("boundary wobble ±9° (want Σ|Δ|<0.05, ▲ held):", JSON.stringify(log.boundaryWobble));
  console.log("release stop (want <=0.05):", JSON.stringify(log.releaseStop));
  console.log("mid-hold switch (want postDrift<=0.05):", JSON.stringify(log.midHoldSwitch));
  console.log("joystick after switch (want >=0.15):", JSON.stringify(log.joystickAfterSwitch));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — FP D-pad: 8-way discrete slide, stable ▲ look, curved ◀ turn, tremble immunity, clean mount switches.");
}

main();
