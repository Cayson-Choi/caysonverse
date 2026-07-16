// v2 Task 9 E2E: 모바일 하단 UI 슬롯 정돈 (겹침 0) + 닉네임표 축소.
//
// Standalone Playwright, against THIS task's isolated dev stack (client :5174 →
// server :2568 — the default ports belong to a parallel lane):
//   PORT=2568 npm run dev -w server
//   cd client && VITE_SERVER_URL=http://localhost:2568 npx vite --port 5174
//
// Proves design 22 end to end on a hasTouch mobile viewport:
//   1. Join → default bottom UI: ZERO pairwise bounding-box overlap among
//      chat input / emoji palette / 👁 / 🗺 / joystick zone (+ screenshot).
//   2. Walk to a chair → 앉기 button shows → ZERO overlap including the sit
//      button, swept across 390 / 360 / 320 px widths (review B1: the old
//      left-anchored slot overlapped the right-anchored palette on every phone
//      under 384px — the sweep makes the guarantee width-independent), AND in
//      FIRST-PERSON where the joystick swaps for the wider D-pad zone (review
//      B2: x ≤ 172 vs the old sit left edge 164) — same three widths; then tap
//      to sit → 일어서기 button → ZERO overlap again (+ shots).
//   3. Focus the chat input → the palette/toggles/sit button hide (cv-chat-focus
//      dodge) and nothing overlaps the input. Playwright cannot emulate the soft
//      keyboard, so the visualViewport shrink is MOCKED (height getter override +
//      a real `resize` event): the input bar must lift above the mocked keyboard
//      top. Real-device iOS/Android behaviour is documented in ChatInput.tsx.
//   4. Nametag (shrunk to 2/3): desktop tab B observes mobile A's 닉네임표 +
//      말풍선 together at ~3m and ~10m (screenshots — the human guard).
//   5. B doubles as the desktop-regression check: no 👁/🗺 buttons on desktop,
//      chat input in its original bottom-centre slot. Zero console/page errors.
//
// Exit 0 = pass. Evidence → .superpowers/sdd/evidence/task-v2-09/.

import { chromium, devices } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5174";
const HERE = dirname(fileURLToPath(import.meta.url));
const EVIDENCE = join(HERE, "..", ".superpowers", "sdd", "evidence", "task-v2-09");
mkdirSync(EVIDENCE, { recursive: true });
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;

const shot = (page, name) => page.screenshot({ path: join(EVIDENCE, name) });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const getPos = (page) => page.evaluate(() => window.__cv.getPos());
const getOrbit = (page) => page.evaluate(() => window.__cv.getOrbit());

/** The mobile bottom-UI slot elements under the zero-overlap contract.
 *  joystickZone (TP) and dpadZone (FP) are the two movement-zone variants —
 *  WorldScene mounts exactly one of them at a time. */
const SELECTORS = {
  chatInput: ".cv-chat-input",
  emojiPalette: ".cv-emoji-palette",
  viewToggle: ".cv-view-btn",
  overviewToggle: ".cv-overview-btn",
  joystickZone: ".cv-joystick-zone",
  dpadZone: ".cv-dpad-zone",
  sitButton: ".cv-sit-btn",
  // Parallel-lane 🔊 TTS toggle (right-edge stack) — tracked so the merged-tree
  // zero-overlap contract covers it too; absent (null) if that lane changes it.
  soundToggle: ".cv-sound-btn",
};

/** Widths under the zero-overlap contract (390 = iPhone 14, 360 = Galaxy S /
 *  iPhone mini, 320 = smallest supported). Height stays 844 — every slot is
 *  bottom-anchored, so width is the only overlap-relevant dimension. */
const WIDTHS = [390, 360, 320];

/** Visible-element bounding rects (display:none / absent → null). */
async function rects(page) {
  return page.evaluate((sel) => {
    const out = {};
    for (const [name, s] of Object.entries(sel)) {
      const el = document.querySelector(s);
      if (!el) { out[name] = null; continue; }
      const r = el.getBoundingClientRect();
      out[name] = r.width > 0 && r.height > 0
        ? { x: r.x, y: r.y, right: r.right, bottom: r.bottom }
        : null;
    }
    return out;
  }, SELECTORS);
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

/** Yaw-aware WASD steer to (tx,tz) — keyboard stays active on touch devices. */
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

/** A sends `text` through the chat input (submit blurs the field itself). */
async function sendChatVia(page, text) {
  await page.locator(".cv-chat-field").fill(text);
  await page.keyboard.press("Enter");
  await sleep(600); // bubble sync to the observer
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist"],
  });
  const failures = [];
  const log = {};
  const allErrors = [];

  const assertNoOverlap = (state, rs) => {
    const hits = overlaps(rs);
    log[state] = { rects: rs, overlaps: hits };
    if (hits.length) {
      failures.push(`${state}: overlapping pairs → ${hits.map((h) => `${h.pair} (${h.w}×${h.h}px)`).join(", ")}`);
    }
  };

  try {
    // ── 1. Mobile A (390×844, hasTouch) — default bottom UI ──
    const mCtx = await browser.newContext({ ...devices["iPhone 14"], viewport: { width: 390, height: 844 } });
    const mPage = await mCtx.newPage();
    allErrors.push(watchErrors(mPage, "mobile"));
    await joinAs(mPage, { nickname: "모바일가", characterLabel: "기사", tintIndex: 0 });
    await mPage.bringToFront();

    assertNoOverlap("default", await rects(mPage));
    await shot(mPage, "after-01-default.png");

    // ── 2. Near a chair (door gap is z∈[-2,2] at x=0) → 앉기 → seated ──
    await walkTo(mPage, -2, 0, { timeout: 30000 });
    await walkTo(mPage, 1.5, 0, { timeout: 15000 });
    await walkTo(mPage, 1.9, 2.6, { timeout: 15000, tol: 0.4 });
    await mPage.locator(".cv-sit-btn").waitFor({ state: "visible", timeout: 5000 });

    // ── 2a. TP width sweep (review B1): sit button + palette + joystick must
    //        all be VISIBLE (non-vacuous) and pairwise disjoint at every width. ──
    for (const w of WIDTHS) {
      await mPage.setViewportSize({ width: w, height: 844 });
      await sleep(250);
      const rs = await rects(mPage);
      for (const must of ["sitButton", "emojiPalette", "joystickZone", "chatInput", "viewToggle"]) {
        if (!rs[must]) failures.push(`sitPrompt@${w}: ${must} not visible (check is vacuous)`);
      }
      assertNoOverlap(`sitPrompt@${w}`, rs);
      await shot(mPage, `after-02-sit-prompt-${w}.png`);
    }

    // ── 2b. FP width sweep (review B2): 👁 → first-person swaps the joystick
    //        for the wider D-pad zone (x ≤ 172); the sit button must clear it
    //        at every width too. ──
    await mPage.locator(".cv-view-btn").click();
    await mPage.waitForFunction(() => window.__cv.getView().mode === "fp", null, { timeout: 5000 });
    await sleep(300);
    for (const w of WIDTHS) {
      await mPage.setViewportSize({ width: w, height: 844 });
      await sleep(250);
      const rs = await rects(mPage);
      for (const must of ["sitButton", "dpadZone", "emojiPalette", "chatInput"]) {
        if (!rs[must]) failures.push(`fpSitPrompt@${w}: ${must} not visible (check is vacuous)`);
      }
      assertNoOverlap(`fpSitPrompt@${w}`, rs);
    }
    await shot(mPage, "after-02-fp-sit-320.png"); // hardest width, D-pad visible
    await mPage.locator(".cv-view-btn").click(); // back to TP
    await mPage.waitForFunction(() => window.__cv.getView().mode === "tp", null, { timeout: 5000 });
    await mPage.setViewportSize({ width: 390, height: 844 });
    await sleep(250);

    await mPage.locator(".cv-sit-btn").click();
    await mPage.waitForFunction(() => window.__cv.getPos().seatIndex >= 0, null, { timeout: 5000 });
    await sleep(300);
    assertNoOverlap("seated", await rects(mPage));
    await shot(mPage, "after-03-seated.png");

    // ── 3. Chat input focused: dodge + keyboard lift ──
    await mPage.locator(".cv-chat-field").focus();
    await sleep(300);
    const rsFocused = await rects(mPage);
    assertNoOverlap("focused", rsFocused);
    for (const hidden of ["emojiPalette", "viewToggle", "overviewToggle", "sitButton"]) {
      if (rsFocused[hidden]) failures.push(`focused: ${hidden} should be hidden (cv-chat-focus dodge) but is visible`);
    }
    if (!rsFocused.chatInput) failures.push("focused: chat input not visible");
    await shot(mPage, "after-04-chat-focused.png");

    // Mock the soft keyboard: shrink visualViewport.height by 300px and fire a
    // REAL resize event on it (Playwright can't raise the actual keyboard).
    const KBD = 300;
    const kbd = await mPage.evaluate((kbdPx) => {
      const proto = Object.getPrototypeOf(window.visualViewport);
      const orig = Object.getOwnPropertyDescriptor(proto, "height");
      Object.defineProperty(proto, "height", {
        configurable: true,
        get: () => window.innerHeight - kbdPx,
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
      const r = document.querySelector(".cv-chat-input").getBoundingClientRect();
      // Restore the native getter, keyboard "closes".
      Object.defineProperty(proto, "height", orig);
      window.visualViewport.dispatchEvent(new Event("resize"));
      const after = document.querySelector(".cv-chat-input").getBoundingClientRect();
      return {
        inset: getComputedStyle(document.documentElement).getPropertyValue("--cv-kbd-inset"),
        liftedBottom: r.bottom,
        keyboardTop: window.innerHeight - kbdPx,
        restoredBottom: after.bottom,
      };
    }, KBD);
    log.kbdMock = kbd;
    if (!(kbd.liftedBottom <= kbd.keyboardTop)) {
      failures.push(`kbd mock: input bottom ${kbd.liftedBottom} not above keyboard top ${kbd.keyboardTop}`);
    }
    if (!(kbd.restoredBottom > kbd.keyboardTop)) {
      failures.push(`kbd mock: input did not return to its slot after the keyboard closed (bottom ${kbd.restoredBottom})`);
    }
    await mPage.keyboard.press("Escape"); // blur → overlays return
    await sleep(200);
    const rsBlurred = await rects(mPage);
    if (!rsBlurred.emojiPalette) failures.push("blur: emoji palette did not come back");

    // ── 4. Nametag (2/3) + bubble, observed by desktop B at ~3m and ~10m ──
    const dCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const dPage = await dCtx.newPage();
    allErrors.push(watchErrors(dPage, "desktop"));
    await joinAs(dPage, { nickname: "관찰나", characterLabel: "도적", tintIndex: 2 });
    await dPage.bringToFront();
    // Desktop-regression screenshot HERE (at spawn, before any walking) so the
    // evidence differs from the 10m nametag shot (review M2: they were dups).
    await shot(dPage, "after-08-desktop.png");

    const a = await getPos(mPage); // A seated at (2.7, 3)
    // Route: door gap at z=0, north along the clear x=1.2 lane, approach from
    // the west at z=6 (a straight x=2.7 run would jam on the (2.7,3) chair).
    await walkTo(dPage, -2, 0, { timeout: 40000 });
    await walkTo(dPage, 1.2, 0, { timeout: 15000 });
    await walkTo(dPage, 1.2, 6.0, { timeout: 15000 });
    await walkTo(dPage, 2.7, 6.0, { timeout: 15000, tol: 0.3 });
    await sendChatVia(mPage, "말풍선이 주인공!");
    await dPage.bringToFront();
    await shot(dPage, "after-06-nametag-3m.png");
    const b3 = await getPos(dPage);
    log.dist3 = Math.hypot(b3.x - a.x, b3.z - a.z);
    if (Math.abs(log.dist3 - 3) > 1.2) failures.push(`nametag 3m shot taken at ${log.dist3.toFixed(2)}m`);

    await walkTo(dPage, 1.2, 7, { timeout: 15000 });
    await walkTo(dPage, 1.2, 11.5, { timeout: 15000 });
    await walkTo(dPage, 2.7, 13, { timeout: 15000, tol: 0.3 });
    await sendChatVia(mPage, "10미터 말풍선!");
    await dPage.bringToFront();
    await shot(dPage, "after-07-nametag-10m.png");
    const b10 = await getPos(dPage);
    log.dist10 = Math.hypot(b10.x - a.x, b10.z - a.z);
    if (Math.abs(log.dist10 - 10) > 1.5) failures.push(`nametag 10m shot taken at ${log.dist10.toFixed(2)}m`);

    // ── 5. Desktop regression: B's layout untouched by the mobile slot work ──
    const desktop = await dPage.evaluate(() => ({
      viewBtns: document.querySelectorAll(".cv-view-btn, .cv-overview-btn").length,
      joystick: document.querySelectorAll(".cv-joystick-zone").length,
      sitBtn: document.querySelectorAll(".cv-sit-btn").length,
      inputBottomGap: innerHeight - document.querySelector(".cv-chat-input").getBoundingClientRect().bottom,
    }));
    log.desktop = desktop;
    if (desktop.viewBtns !== 0) failures.push("desktop: 👁/🗺 touch toggles rendered on a non-touch device");
    if (desktop.joystick !== 0) failures.push("desktop: joystick zone rendered on a non-touch device");
    if (desktop.sitBtn !== 0) failures.push("desktop: touch sit button rendered on a non-touch device");
    if (Math.abs(desktop.inputBottomGap - 24) > 2) {
      failures.push(`desktop: chat input not in its original slot (gap ${desktop.inputBottomGap}px, want 24)`);
    }

    // ── 6. Zero console/page errors on both tabs ──
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

  const states = [
    "default",
    ...WIDTHS.map((w) => `sitPrompt@${w}`),
    ...WIDTHS.map((w) => `fpSitPrompt@${w}`),
    "seated",
    "focused",
  ];
  for (const state of states) {
    console.log(`${state}: overlaps=${JSON.stringify(log[state]?.overlaps)}`);
  }
  console.log("kbd mock:", JSON.stringify(log.kbdMock));
  console.log("nametag distances:", log.dist3?.toFixed(2), "/", log.dist10?.toFixed(2));
  console.log("desktop regression:", JSON.stringify(log.desktop));
  if (failures.length) {
    console.error("\nE2E FAILED:\n- " + failures.join("\n- "));
    process.exit(1);
  }
  console.log("\nE2E PASSED — 모바일 하단 UI 겹침 0 (기본/앉기/착석/입력 포커스/키보드 모사) + 닉네임표 축소 확인.");
}

main();
