// v2 Task 10 E2E: 채팅 음성 낭독 (TTS) — 근접 거리 게이트 + 음소거 토글.
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5175 →
// server :2569 — other ports belong to parallel lanes):
//   PORT=2569 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2569 npx vite --port 5175
//
// Headless Chromium cannot emit audio, so speechSynthesis.speak is SPIED in the
// page context (addInitScript wraps it before app code runs): each call's
// text/volume/lang is recorded to window.__ttsCalls, and onend is fired ~50ms
// later so the serial queue advances deterministically (tts.ts's done() is
// exactly-once, so a late real onend is harmless). Assertions are therefore
// about CALLS (text/volume/lang), never about audible sound.
//
// Scenarios (design 23):
//   0. Join click primes the engine → one silent utterance (text "", volume 0).
//   1. B chats NEAR A (< 15m) → A speaks it once, ko-KR, distance-attenuated volume.
//   2. A chats itself → A speaks it at volume exactly 1 (distance 0).
//   3. 🔇 on A → B chats → NO speak; 🔊 again → B chats → speaks.
//   4. B walks beyond the radius (> 15m) → B chats → NO speak on A.
//   5. Mute persists: localStorage cv-tts-muted=1 → reload + rejoin → still 🔇.
//   6. Layout: 🔊 button overlaps NOTHING — mobile 390×844 (default stack AND
//      first-person D-pad state) + desktop; chat-focus dodge hides it on touch.
//   7. Zero console/page errors on every tab.
//
// Exit 0 = pass. Evidence → .superpowers/sdd/evidence/task-v2-10/.

import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5175";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-10");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const TTS_RADIUS_M = 15; // mirrors client/src/game/tts.ts (assert-only copy)
const TTS_MIN_VOLUME = 0.35;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());

/** Spy installed BEFORE any app code: records speak() calls, self-fires onend. */
function ttsSpy() {
  const synth = window.speechSynthesis;
  if (!synth) return;
  window.__ttsCalls = [];
  const orig = synth.speak.bind(synth);
  synth.speak = (u) => {
    window.__ttsCalls.push({ text: u.text, volume: u.volume, lang: u.lang });
    setTimeout(() => {
      try {
        if (u.onend) u.onend(new Event("end"));
      } catch {}
    }, 50);
    try {
      orig(u);
    } catch {}
  };
}

const getCalls = (page) => page.evaluate(() => window.__ttsCalls || []);
/** Spoken-content calls only (the silent prime has text "" / volume 0). */
const getSpoken = async (page) => (await getCalls(page)).filter((c) => c.text.length > 0);

async function waitForSpoken(page, text, timeout = 8000) {
  await page.waitForFunction(
    (t) => (window.__ttsCalls || []).some((c) => c.text === t),
    text,
    { timeout },
  );
}

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

/** Yaw-aware WASD steer to (tx,tz) — same helper as previous task E2Es. */
async function walkTo(page, tx, tz, { tol = 0.6, timeout = 22000 } = {}) {
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

async function sendChatVia(page, text) {
  await page.locator(".cv-chat-field").fill(text);
  await page.keyboard.press("Enter");
  // The SAME Enter keydown bubbles on to ChatInput's global focus-on-Enter
  // handler AFTER submit() blurred (capture already released), refocusing the
  // field — so WASD would stay captured. Escape blurs it for the next walk.
  await page.keyboard.press("Escape");
  await sleep(300);
}

/** Player-to-player distance between two tabs' own positions. */
async function distanceBetween(pageA, pageB) {
  const a = await getPos(pageA);
  const b = await getPos(pageB);
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Visible-element bounding rects (display:none / absent → null). */
async function rects(page, selectors) {
  return page.evaluate((sel) => {
    const out = {};
    for (const [name, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = r.width > 0 && r.height > 0
        ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom, w: r.width, h: r.height }
        : null;
    }
    return out;
  }, selectors);
}

/** Pairwise positive-area intersections among the visible tracked elements. */
function overlaps(rs) {
  const names = Object.keys(rs).filter((n) => rs[n]);
  const hits = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = rs[names[i]];
      const b = rs[names[j]];
      const w = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const h = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      if (w > 0 && h > 0) hits.push({ pair: `${names[i]} × ${names[j]}`, w: +w.toFixed(1), h: +h.toFixed(1) });
    }
  }
  return hits;
}

const MOBILE_SELECTORS = {
  chatInput: ".cv-chat-input",
  emojiPalette: ".cv-emoji-palette",
  viewToggle: ".cv-view-btn",
  overviewToggle: ".cv-overview-btn",
  soundToggle: ".cv-sound-btn",
  joystickZone: ".cv-joystick-zone",
  dpadZone: ".cv-dpad-zone",
};

const DESKTOP_SELECTORS = {
  chatInput: ".cv-chat-input",
  emojiPalette: ".cv-emoji-palette",
  soundToggle: ".cv-sound-btn",
};

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  const allErrors = [];

  try {
    // ── Setup: A (observer) and B (sender), both desktop, spy installed ──
    const ctxA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const ctxB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctxA.addInitScript(ttsSpy);
    await ctxB.addInitScript(ttsSpy);
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    allErrors.push(watchErrors(pageA, "A"), watchErrors(pageB, "B"));

    await joinAs(pageA, { nickname: "관찰가", characterLabel: "기사", tintIndex: 0 });

    // ── 0. Priming: the join click spoke ONE silent utterance ──
    const primeCalls = (await getCalls(pageA)).filter((c) => c.text === "" && c.volume === 0);
    log.primeCalls = primeCalls.length;
    if (primeCalls.length !== 1) failures.push(`priming: expected 1 silent utterance after join, got ${primeCalls.length}`);

    await joinAs(pageB, { nickname: "발신나", characterLabel: "도적", tintIndex: 2 });

    // ── 1. Near chat: B (spawn-adjacent, jitter ≤ 4m apart) → A speaks it ──
    const dNear = await distanceBetween(pageA, pageB);
    log.nearDistance = dNear;
    if (!(dNear < TTS_RADIUS_M)) failures.push(`near setup: A-B distance ${dNear.toFixed(2)}m not inside the ${TTS_RADIUS_M}m radius`);
    const NEAR_TEXT = "안녕 낭독 테스트";
    await sendChatVia(pageB, NEAR_TEXT);
    await waitForSpoken(pageA, NEAR_TEXT).catch(() => failures.push(`near: A never spoke "${NEAR_TEXT}"`));
    const nearCalls = (await getSpoken(pageA)).filter((c) => c.text === NEAR_TEXT);
    log.nearCall = nearCalls[0] ?? null;
    if (nearCalls.length === 1) {
      const { volume, lang } = nearCalls[0];
      if (lang !== "ko-KR") failures.push(`near: utterance lang ${lang}, want ko-KR`);
      const expected = 1 - (1 - TTS_MIN_VOLUME) * (dNear / TTS_RADIUS_M);
      if (Math.abs(volume - expected) > 0.15) {
        failures.push(`near: volume ${volume.toFixed(3)} not ≈ distance-attenuated ${expected.toFixed(3)} (d=${dNear.toFixed(2)}m)`);
      }
    } else if (nearCalls.length > 1) {
      failures.push(`near: spoken ${nearCalls.length} times, want exactly 1`);
    }
    await shot(pageA, "01-near-chat.png");

    // ── 2. Self chat: A's own message is always spoken at volume 1 ──
    const SELF_TEXT = "내 메시지 낭독";
    await sendChatVia(pageA, SELF_TEXT);
    await waitForSpoken(pageA, SELF_TEXT).catch(() => failures.push(`self: A never spoke own "${SELF_TEXT}"`));
    const selfCall = (await getSpoken(pageA)).find((c) => c.text === SELF_TEXT);
    log.selfCall = selfCall ?? null;
    if (selfCall && selfCall.volume !== 1) failures.push(`self: volume ${selfCall.volume}, want exactly 1 (distance 0)`);

    // ── 3. Mute toggle (B still near): 🔇 skips, 🔊 speaks again ──
    const soundBtn = pageA.locator(".cv-sound-btn");
    if (!(await soundBtn.isVisible())) failures.push("mute: 🔊 button not visible on DESKTOP (must render on every device)");
    await soundBtn.click(); // → muted
    const MUTED_TEXT = "음소거 중 메시지";
    await sendChatVia(pageB, MUTED_TEXT);
    await sleep(1500);
    if ((await getSpoken(pageA)).some((c) => c.text === MUTED_TEXT)) {
      failures.push(`mute: A spoke "${MUTED_TEXT}" while muted`);
    }
    const mutedUi = await soundBtn.evaluate((el) => ({
      glyph: el.textContent,
      pressed: el.getAttribute("aria-pressed"),
      isMuted: el.classList.contains("is-muted"),
    }));
    log.mutedUi = mutedUi;
    if (mutedUi.glyph !== "🔇" || mutedUi.pressed !== "false" || !mutedUi.isMuted) {
      failures.push(`mute: button state wrong while muted → ${JSON.stringify(mutedUi)}`);
    }
    await shot(pageA, "02-muted.png");

    await soundBtn.click(); // → unmuted
    const UNMUTED_TEXT = "다시 들리는 메시지";
    await sendChatVia(pageB, UNMUTED_TEXT);
    await waitForSpoken(pageA, UNMUTED_TEXT).catch(() => failures.push(`unmute: A never spoke "${UNMUTED_TEXT}" after re-enabling`));

    // ── 4. Far chat: B beyond the radius → A must NOT speak it ──
    // Route: door gap at x=0 is z∈[-2,2]; from spawn (~-15,0) go (-2,0) → (6,0)
    // into the lecture hall ⇒ ~21m from A, straight z=0 lane clear of chairs.
    await pageB.bringToFront();
    await walkTo(pageB, -2, 0, { timeout: 30000 });
    await walkTo(pageB, 6, 0, { timeout: 20000 });
    const dFar = await distanceBetween(pageA, pageB);
    log.farDistance = dFar;
    if (!(dFar > TTS_RADIUS_M)) failures.push(`far setup: A-B distance ${dFar.toFixed(2)}m not beyond the ${TTS_RADIUS_M}m radius`);
    const FAR_TEXT = "먼 거리 메시지";
    await sendChatVia(pageB, FAR_TEXT);
    await pageA.bringToFront();
    await sleep(1500);
    if ((await getSpoken(pageA)).some((c) => c.text === FAR_TEXT)) {
      failures.push(`far: A spoke "${FAR_TEXT}" from ${dFar.toFixed(2)}m (outside the radius)`);
    }
    // The bubble/log still received it (TTS-only gate, chat unaffected):
    const farBubbleSeen = await pageA.evaluate(
      (t) => window.__cv.getBubbles().some((b) => b.text === t),
      FAR_TEXT,
    );
    if (!farBubbleSeen) failures.push("far: bubble missing on A — distance gate must be TTS-only");
    await shot(pageA, "03-far-chat.png");

    // ── 5. Mute persists across reload (localStorage) ──
    await soundBtn.click(); // → muted again
    const stored = await pageA.evaluate(() => localStorage.getItem("cv-tts-muted"));
    log.storedMuted = stored;
    if (stored !== "1") failures.push(`persist: localStorage cv-tts-muted = ${JSON.stringify(stored)}, want "1"`);
    await joinAs(pageA, { nickname: "관찰가", characterLabel: "기사", tintIndex: 0 }); // goto = reload + rejoin
    const persistedUi = await pageA.locator(".cv-sound-btn").evaluate((el) => ({
      glyph: el.textContent,
      isMuted: el.classList.contains("is-muted"),
    }));
    log.persistedUi = persistedUi;
    if (persistedUi.glyph !== "🔇" || !persistedUi.isMuted) {
      failures.push(`persist: after reload the button is not muted → ${JSON.stringify(persistedUi)}`);
    }
    await shot(pageA, "04-persisted-mute.png");
    await pageA.locator(".cv-sound-btn").click(); // leave ON for the error sweep

    // ── 6a. Desktop layout: 🔊 present, zero overlap with the bottom-right UI ──
    const dRects = await rects(pageA, DESKTOP_SELECTORS);
    const dHits = overlaps(dRects);
    log.desktop = { rects: dRects, overlaps: dHits };
    if (!dRects.soundToggle) failures.push("desktop layout: 🔊 button missing");
    if (dHits.length) failures.push(`desktop layout: overlaps → ${dHits.map((h) => `${h.pair} (${h.w}×${h.h}px)`).join(", ")}`);
    await shot(pageA, "05-desktop-layout.png");

    // ── 6b. Mobile layout (390×844 + hasTouch): default stack, then FP D-pad ──
    const ctxM = await browser.newContext({ ...devices["iPhone 14"], viewport: { width: 390, height: 844 } });
    await ctxM.addInitScript(ttsSpy);
    const pageM = await ctxM.newPage();
    allErrors.push(watchErrors(pageM, "mobile"));
    await joinAs(pageM, { nickname: "모바일다", characterLabel: "마법사", tintIndex: 4 });
    await pageM.bringToFront();

    const mDefault = await rects(pageM, MOBILE_SELECTORS);
    const mDefaultHits = overlaps(mDefault);
    log.mobileDefault = { rects: mDefault, overlaps: mDefaultHits };
    if (!mDefault.soundToggle) failures.push("mobile layout: 🔊 button missing");
    else if (mDefault.soundToggle.w < 44 || mDefault.soundToggle.h < 44) {
      failures.push(`mobile layout: 🔊 tap target ${mDefault.soundToggle.w}×${mDefault.soundToggle.h}px, want ≥44px`);
    }
    if (mDefaultHits.length) failures.push(`mobile default: overlaps → ${mDefaultHits.map((h) => `${h.pair} (${h.w}×${h.h}px)`).join(", ")}`);
    await shot(pageM, "06-mobile-default.png");

    // First-person: the D-pad replaces the joystick — 🔊 must clear it too.
    await pageM.locator(".cv-view-btn").tap();
    await pageM.locator(".cv-dpad-zone").waitFor({ state: "visible", timeout: 5000 });
    const mFp = await rects(pageM, MOBILE_SELECTORS);
    const mFpHits = overlaps(mFp);
    log.mobileFp = { rects: mFp, overlaps: mFpHits };
    if (!mFp.dpadZone) failures.push("mobile FP: D-pad zone missing after 👁 toggle");
    if (mFpHits.length) failures.push(`mobile FP: overlaps → ${mFpHits.map((h) => `${h.pair} (${h.w}×${h.h}px)`).join(", ")}`);
    await shot(pageM, "07-mobile-fp-dpad.png");
    await pageM.locator(".cv-view-btn").tap(); // back to third person

    // Chat-focus dodge: 🔊 hides with the rest of the right column.
    await pageM.locator(".cv-chat-field").focus();
    await sleep(300);
    const mFocused = await rects(pageM, MOBILE_SELECTORS);
    if (mFocused.soundToggle) failures.push("mobile focused: 🔊 should hide under cv-chat-focus (keyboard dodge)");
    await pageM.keyboard.press("Escape");

    // ── 7. Zero console/page errors on all tabs ──
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

  console.log("prime calls:", log.primeCalls);
  console.log("near:", log.nearDistance?.toFixed(2), "m →", JSON.stringify(log.nearCall));
  console.log("self:", JSON.stringify(log.selfCall));
  console.log("far:", log.farDistance?.toFixed(2), "m (no speak expected)");
  console.log("persist:", log.storedMuted, JSON.stringify(log.persistedUi));
  console.log("desktop overlaps:", JSON.stringify(log.desktop?.overlaps));
  console.log("mobile default overlaps:", JSON.stringify(log.mobileDefault?.overlaps));
  console.log("mobile FP overlaps:", JSON.stringify(log.mobileFp?.overlaps));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — TTS 근접 낭독 / 자기 메시지 / 거리 게이트 / 음소거 토글·지속 / 슬롯 겹침 0 확인.");
}

main();
