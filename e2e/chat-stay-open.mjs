// 채팅창 계속 쓰기 (2026-11-10, owner's ask): once chatting, Enter sends and the caret STAYS in the field; a send
// button at the end of the bar does the same; Enter on an empty field / Escape leave; a press anywhere outside the
// bar takes the caret out, so WASD walks again at once. Hangul typed through an IME is never lost or sent twice.
// And the owner's second report — talking WITHOUT clicking the bar first opened the map (Hangul ㅡ is the M key):
// a typed key that is no game key now opens the chat with it (type to chat), in English and in 한글 mode — including
// Windows, where Chrome turns the IME off outside a field and ㅡ arrives as a plain "m": an M / B right after a consonant
// key is the vowel of a word (그 = R M), so it is typing; on its own M is still the map. Review fixes (2026-11-10):
// a held Enter never throws the player out of the chat, and a 4th quick line stays in the field instead of being lost.
// Review round 2: a line that STARTS with ㅡ / ㅠ (ㅡㅡ, ㅠㅠ — m m / b b on Windows) goes into the chat too (a lone M / B
// waits a moment for the next key; a slower second key takes back the map that opened), Safari's 229 Enter sends on one
// press, and a held 4th line shows a note right above the bar (phones: the log is folded) with ONE notice in the log.
// Review round 3: slower typists (0.3 – 1.2 s a key) never leave the map open — the slow-typing matrix records the map
// every 10 ms (part pc-matrix); the tap that leaves the chat on a phone never lands on the 💬 / emoji / action / jump
// button that comes back under the finger; Safari's 229 Escape only cancels the syllable; the phone send button is 48 px.
//
// Plain Playwright against a dev stack, in the style of the other e2e scripts:
//   server:  PORT=2681 TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json npx tsx src/index.ts   (in server/; the path is from the repo root)
//   client:  VITE_SERVER_URL=http://localhost:2681 npx vite --port 5281 --strictPort (in client/)
//   CV_CLIENT_URL=http://localhost:5281 node e2e/chat-stay-open.mjs
// CV_CHAT_EVIDENCE=<dir> puts the screenshots + assertions there (default: .superpowers/sdd/evidence/task-escape/chat-stay-open).
// CV_CHAT_ONLY=<parts> (comma list of pc, pc-matrix, iphone13, kakao-android, legacy, hall) runs only those parts.
//
// The IME is driven through CDP (Input.imeSetComposition / Input.insertText): Blink then holds a REAL composition
// (compositionstart/update/end, isComposing on the keydowns), which is what a Hangul IME does to the page.
//
// Exit code 0 only when every check passes and no unexpected console/page error was seen.

import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, createRun, entryReady, joinAsTeacher, openPlayer, pos, press, sleep, turnCameraTo, waitIdle, walkAndWait } from "./lib/escape.mjs";
import { joinVillage, standAtPlazaGuide } from "./lib/village.mjs";

const run = createRun("chat-stay-open");
if (process.env.CV_CHAT_EVIDENCE) run.evidence = process.env.CV_CHAT_EVIDENCE;
mkdirSync(run.evidence, { recursive: true });
const { check } = run;

/** KakaoTalk's in-app browser on an Android phone (the link most visitors open the village from). */
const KAKAO_ANDROID = {
  viewport: { width: 412, height: 860 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    "Mozilla/5.0 (Linux; Android 14; SM-S918N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 KAKAOTALK 10.9.0",
};
const { defaultBrowserType: _ignored, ...IPHONE_13 } = devices["iPhone 13"];

const FIELD = ".cv-chat-field";
const SEND = ".cv-chat-send";
const BAR = ".cv-chat-input";

/** hotkeys.ts TAKE_BACK_MS / WORD_GAP_MS (1.5 s): a second M sooner than this after the first reads as ㅡㅡ. */
const TAKE_BACK_MS = 1500;
/** A person looking at the map before closing it again: past the take-back, so the M is the map's close key. */
const LOOK_MS = TAKE_BACK_MS + 200;
/** game/settings.ts MIN_TOUCH_PX: the project's smallest touch target. */
const MIN_TOUCH_PX = 48;

/** What has the keyboard: the focused element's class (or tag) and the field's text. */
const state = (p) =>
  p.page.evaluate(async () => {
    const a = document.activeElement;
    const f = document.querySelector(".cv-chat-field");
    const cap = (await window.__imp("/src/game/uiCapture.ts")).isUiCaptured();
    return {
      focused: a === f,
      active: a ? (typeof a.className === "string" && a.className ? a.className : a.tagName) : null,
      value: f ? f.value : null,
      captured: cap,
      collapsed: !!document.querySelector(".cv-chat-input.is-collapsed"),
      focusClass: document.documentElement.classList.contains("cv-chat-focus"),
    };
  });

/** This player's own lines in the chat log (the server echoes every accepted line once). */
const myLines = (p) =>
  p.page.evaluate(async (nick) => {
    const { useChatStore } = await window.__imp("/src/stores/chatStore.ts");
    return useChatStore.getState().log.filter((e) => e.kind === "message" && e.name === nick).map((e) => e.text);
  }, p.nick);
const systemLines = (p) =>
  p.page.evaluate(async () => {
    const { useChatStore } = await window.__imp("/src/stores/chatStore.ts");
    return useChatStore.getState().log.filter((e) => e.kind === "system").map((e) => e.text);
  });

/** Poll `fn` until `ok(value)` or `ms` pass; returns the last value. */
async function until(fn, ok, ms = 3000, every = 80) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < ms) {
    await sleep(every);
    v = await fn();
  }
  return v;
}
const count = (list, text) => list.filter((t) => t === text).length;
/** Wait until `text` shows in my log (at least once), then a beat more so a double would have landed too. */
async function sentOnce(p, text) {
  await until(() => myLines(p), (l) => l.includes(text), 4000);
  await sleep(500);
  return count(await myLines(p), text);
}

/** The send button's look/state: accessible name, dimmed flag, box (and whether it sits inside the bar). */
const sendInfo = (p) =>
  p.page.evaluate(() => {
    const b = document.querySelector(".cv-chat-send");
    const bar = document.querySelector(".cv-chat-input");
    if (!b || !bar) return null;
    const r = b.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const f = document.querySelector(".cv-chat-field").getBoundingClientRect();
    return {
      name: b.getAttribute("aria-label"),
      dim: b.getAttribute("aria-disabled") === "true",
      opacity: Number(getComputedStyle(b).opacity),
      box: { x: r.x, y: r.y, w: r.width, h: r.height },
      inside: r.left >= br.left - 0.5 && r.right <= br.right + 0.5 && r.top >= br.top - 0.5 && r.bottom <= br.bottom + 0.5,
      atEnd: r.left >= f.right - 0.5 && br.right - r.right < 16,
    };
  });

/** The "too fast" note above the bar (null when there is none): its text, and where it sits against the bar and the screen. */
const noteInfo = (p) =>
  p.page.evaluate(() => {
    const n = document.querySelector(".cv-chat-note");
    const bar = document.querySelector(".cv-chat-input");
    if (!n || !bar) return null;
    const r = n.getBoundingClientRect();
    const br = bar.getBoundingClientRect();
    const vv = window.visualViewport;
    const vw = vv ? vv.width : innerWidth;
    const vh = vv ? vv.height : innerHeight;
    const cs = getComputedStyle(n);
    // what is drawn at the note's centre: the note itself (nothing covers it)
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return {
      text: n.textContent,
      role: n.getAttribute("role"),
      visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && Number(getComputedStyle(bar).opacity) > 0,
      aboveBar: r.bottom <= br.top + 0.5,
      onScreen: r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5,
      onTop: !!hit && n.contains(hit),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });

/** Screenshot of the bar only (padded), plus the full screen. */
async function shots(p, name) {
  let box = await p.page.locator(BAR).boundingBox();
  // the "too fast" note above the bar belongs in the picture too
  const note = (await p.page.locator(".cv-chat-note").count()) ? await p.page.locator(".cv-chat-note").boundingBox() : null;
  if (box && note) {
    const x = Math.min(box.x, note.x);
    const y = Math.min(box.y, note.y);
    box = { x, y, width: Math.max(box.x + box.width, note.x + note.width) - x, height: Math.max(box.y + box.height, note.y + note.height) - y };
  }
  if (box) {
    const vp = p.page.viewportSize();
    const pad = 24;
    const clip = { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: Math.min(vp.width, box.width + pad * 2), height: Math.min(vp.height - Math.max(0, box.y - pad), box.height + pad * 2) };
    await p.page.screenshot({ path: join(run.evidence, `${name}-bar.png`), clip }).catch(() => {});
  }
  await p.page.screenshot({ path: join(run.evidence, `${name}-full.png`) }).catch(() => {});
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ───────────────────────────────────────────────────────────── PC ─────────────────────────────────────────────────────────────

async function pc(browser) {
  const A = await openPlayer(browser, run, { tag: "pc", device: DESKTOP });
  await run.step("PC 1. 마을 입장", async () => {
    const { nick } = await joinVillage(A, "챗");
    check("joined the village", !!nick, { nick });
    // The spawn is jittered 3 m around (0, 14): start every run from the same open spot south of the fountain, facing it,
    // so the W walks below have room (one spawn landed beside the plaza guide, and W walked into a bench).
    await walkAndWait(A, 0, 16.8, 20000, 0.5);
    await turnCameraTo(A, 0, 0);
    await sleep(400);
    const at = await pos(A);
    check("standing south of the fountain, facing it", Math.hypot(at.x, at.z - 16.8) < 1, at);
  });

  await run.step("PC 2. Enter → 두 줄 연속으로 보내도 채팅창에 그대로", async () => {
    const s0 = await state(A);
    check("the bar shows, the field is not focused yet", !s0.focused && !s0.captured, s0);
    await A.page.keyboard.press("Enter");
    const s1 = await until(() => state(A), (s) => s.focused);
    check("Enter opens the chat (field focused, keyboard captured)", s1.focused && s1.captured, s1);
    const empty = await sendInfo(A);
    check('a send button "보내기" sits at the end, inside the bar', empty?.name === "보내기" && empty.inside && empty.atEnd, empty);
    check("…dimmed while the field is empty", empty?.dim === true && empty.opacity < 1, empty);
    await shots(A, "pc-empty");

    await A.page.keyboard.type("첫 번째 줄", { delay: 20 });
    const typed = await until(() => sendInfo(A), (i) => i?.dim === false && i.opacity === 1, 1000, 30); // past its 0.15 s fade
    check("…and lit once there is text", typed?.dim === false && typed.opacity === 1, typed);
    await shots(A, "pc-text");
    await A.page.keyboard.press("Enter");
    check('"첫 번째 줄" was sent exactly once', (await sentOnce(A, "첫 번째 줄")) === 1, await myLines(A));
    const s2 = await state(A);
    check("after Enter the caret is STILL in the field (empty, keyboard still captured)", s2.focused && s2.value === "" && s2.captured, s2);

    await A.page.keyboard.type("두 번째 줄", { delay: 20 });
    await A.page.keyboard.press("Enter");
    check('"두 번째 줄" was sent exactly once, right after', (await sentOnce(A, "두 번째 줄")) === 1, await myLines(A));
    const s3 = await state(A);
    check("still in the field after the second line", s3.focused && s3.value === "", s3);
  });

  await run.step("PC 3. 보내기 버튼 → 보내고 채팅창에 그대로", async () => {
    await A.page.keyboard.type("버튼으로 보냄", { delay: 20 });
    await A.page.locator(SEND).click();
    check('"버튼으로 보냄" was sent exactly once', (await sentOnce(A, "버튼으로 보냄")) === 1, await myLines(A));
    const s = await state(A);
    check("the click kept the caret in the field (empty, captured)", s.focused && s.value === "" && s.captured, s);
    const before = (await myLines(A)).length;
    // empty: does nothing, keeps the caret. (A real mouse press at its centre: Playwright's own click() waits for an
    // aria-disabled button to become "enabled" — a person can of course still press the dimmed button.)
    const dim = await sendInfo(A);
    await A.page.mouse.click(dim.box.x + dim.box.w / 2, dim.box.y + dim.box.h / 2);
    await sleep(600);
    const s2 = await state(A);
    check("a click on the dimmed button sends nothing and keeps the caret", (await myLines(A)).length === before && s2.focused, s2);
    const sys = await systemLines(A);
    check("no rate-limit notice so far (3 lines in 5 s is allowed)", sys.length === 0, sys);
  });

  await run.step("PC 4. 빈 채팅에서 Enter / Esc → 채팅에서 나옴", async () => {
    await A.page.keyboard.press("Enter");
    const s1 = await until(() => state(A), (s) => !s.focused);
    check("Enter on the empty field leaves the chat (not focused, keyboard free)", !s1.focused && !s1.captured, s1);
    await sleep(250);
    const s1b = await state(A);
    check("…and the same Enter did not re-open it", !s1b.focused, s1b);
    check("…nor open the menu", (await A.page.locator(".cv-menu").count()) === 0, {});
    await A.page.keyboard.press("Enter");
    const s2 = await until(() => state(A), (s) => s.focused);
    check("the next Enter opens the chat again", s2.focused, s2);
    await A.page.keyboard.type("쓰다 말고", { delay: 20 });
    await A.page.keyboard.press("Escape");
    const s3 = await until(() => state(A), (s) => !s.focused);
    check("Escape leaves the chat (the unsent text stays in the field)", !s3.focused && !s3.captured && s3.value === "쓰다 말고", s3);
    check("…and does not open the menu", (await A.page.locator(".cv-menu").count()) === 0, {});
  });

  await run.step("PC 5. 채팅 중 3D 화면 클릭 → 채팅에서 나오고 WASD로 바로 걸음", async () => {
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    const vp = A.page.viewportSize();
    // the ground a little ahead of the avatar: a normal click-move, as without the chat
    await A.page.mouse.click(vp.width / 2 + 60, vp.height * 0.62);
    const s1 = await until(() => state(A), (s) => !s.focused, 1500);
    check("a click on the 3D view takes the caret out of the field", !s1.focused && !s1.captured, s1);
    const moved = await until(() => A.page.evaluate(() => window.__cvClickTarget()), (t) => t !== null, 1500, 30);
    check("…and the click still works as a click-move", moved !== null, { target: moved });
    await waitIdle(A, 15000);
    await sleep(300);
    const p0 = await pos(A);
    await A.page.keyboard.down("KeyW");
    await sleep(900);
    await A.page.keyboard.up("KeyW");
    await sleep(300);
    const p1 = await pos(A);
    const s2 = await state(A);
    check("W walks the avatar right after (moved > 0.8 m)", dist(p0, p1) > 0.8, { moved: Math.round(dist(p0, p1) * 100) / 100 });
    check("…and no 'w' went into the field", s2.value === "쓰다 말고" && !s2.focused, s2);

    // A HUD control outside the bar (the chat log's toggle) leaves the chat too.
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    const toggle = A.page.locator(".cv-chat-toggle");
    await toggle.click();
    const s3 = await until(() => state(A), (s) => !s.focused, 1500);
    check("a click on a HUD button (chat log toggle) also leaves the chat", !s3.focused && !s3.captured, s3);
    await toggle.click(); // put the log back as it was
    await sleep(200);

    // A click inside the bar's own padding / on the field keeps it.
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    const bb = await A.page.locator(BAR).boundingBox();
    await A.page.mouse.click(bb.x + 6, bb.y + bb.height / 2);
    await sleep(250);
    const s4 = await state(A);
    check("a click on the bar itself keeps the caret in the field", s4.focused, s4);
    await A.page.locator(FIELD).fill("");
    await A.page.keyboard.press("Escape");
    await until(() => state(A), (s) => !s.focused);
  });

  await run.step("PC 6. 한글 IME 조합 중 Enter / 보내기 버튼 — 마지막 글자 안 빠지고, 두 번 안 감", async () => {
    await sleep(5800); // the chat window (3 lines / 5 s, + the bar's 0.5 s of slack): start fresh
    const cdp = await A.page.context().newCDPSession(A.page);
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);

    // Enter while the last syllable is still being composed belongs to the IME: nothing is sent.
    await cdp.send("Input.insertText", { text: "안녕하세" });
    await cdp.send("Input.imeSetComposition", { text: "요", selectionStart: 1, selectionEnd: 1 });
    const comp = await state(A);
    check("IME: the field shows the composing syllable", comp.value === "안녕하세요", comp);
    const n0 = (await myLines(A)).length;
    await A.page.keyboard.press("Enter");
    await sleep(500);
    check("IME: Enter during the composition sends nothing", (await myLines(A)).length === n0, await myLines(A));
    // The IME commits the syllable (what Enter does to a real Hangul IME), then the Enter that follows sends.
    await cdp.send("Input.insertText", { text: "요" });
    await A.page.keyboard.press("Enter");
    check('IME + Enter: "안녕하세요" sent exactly once, whole', (await sentOnce(A, "안녕하세요")) === 1, await myLines(A));
    check("IME + Enter: no cut-off line went out", count(await myLines(A), "안녕하세") === 0, await myLines(A));
    await sleep(500);
    const s1 = await state(A);
    check("IME + Enter: the caret stays, the field stays empty (no stray syllable)", s1.focused && s1.value === "", s1);

    // The button pressed while "요" is still being composed: the syllable is committed first, the line goes out once.
    await cdp.send("Input.insertText", { text: "반가워" });
    await cdp.send("Input.imeSetComposition", { text: "요", selectionStart: 1, selectionEnd: 1 });
    const comp2 = await state(A);
    check("IME: composing again", comp2.value === "반가워요", comp2);
    await A.page.locator(SEND).click();
    check('IME + 보내기: "반가워요" sent exactly once, whole', (await sentOnce(A, "반가워요")) === 1, await myLines(A));
    check("IME + 보내기: no cut-off line went out", count(await myLines(A), "반가워") === 0, await myLines(A));
    await sleep(600);
    const s2 = await state(A);
    check("IME + 보내기: the caret stays, the field stays empty (no stray '요')", s2.focused && s2.value === "", s2);
    // and the next syllables go into a clean field
    await cdp.send("Input.insertText", { text: "다음" });
    const s3 = await state(A);
    check("IME: the next word starts in a clean field", s3.value === "다음", s3);
    // Safari (WebKit) ends the composition BEFORE the Enter's keydown and reports that Enter as key "Enter", keyCode 229,
    // isComposing false. One press commits the last syllable AND sends (review: it used to need a second Enter there);
    // a plain Enter right behind it (some keyboards send both) neither sends again nor throws the player out.
    const ime229 = { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 };
    const enterUp = { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    const enter13 = { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
    await A.page.locator(FIELD).fill("");
    await cdp.send("Input.insertText", { text: "사파" });
    await cdp.send("Input.imeSetComposition", { text: "리", selectionStart: 1, selectionEnd: 1 });
    await cdp.send("Input.insertText", { text: "리" }); // compositionend("리") — before the keydown, as Safari does
    await cdp.send("Input.dispatchKeyEvent", ime229);
    await cdp.send("Input.dispatchKeyEvent", enterUp);
    await sleep(30);
    await cdp.send("Input.dispatchKeyEvent", enter13); // the plain Enter right behind it
    await cdp.send("Input.dispatchKeyEvent", enterUp);
    check('Safari-style Enter (keyCode 229 after the commit): "사파리" sent exactly once, on ONE press', (await sentOnce(A, "사파리")) === 1, await myLines(A));
    const s4 = await state(A);
    check("…the caret stays in the (empty) field — the Enter right behind it did not leave", s4.focused && s4.value === "" && s4.captured, s4);
    // A Japanese / Chinese IME's Enter only confirms the conversion (no Hangul committed): nothing is sent, as before.
    const n1 = (await myLines(A)).length;
    await cdp.send("Input.imeSetComposition", { text: "かんじ", selectionStart: 3, selectionEnd: 3 });
    await cdp.send("Input.insertText", { text: "漢字" });
    await cdp.send("Input.dispatchKeyEvent", ime229);
    await cdp.send("Input.dispatchKeyEvent", enterUp);
    await sleep(500);
    const s5 = await state(A);
    check("a 229 Enter after a non-Hangul commit (Japanese conversion) sends nothing, keeps the line and the caret", (await myLines(A)).length === n1 && s5.value === "漢字" && s5.focused, s5);
    // Review round 3: Safari cancels a syllable with an Escape it reports as keyCode 229, isComposing false. It only
    // drops the syllable: the chat stays (the window's hotkeys never take it for the menu key), no menu. A second,
    // plain Escape leaves as always.
    await A.page.locator(FIELD).fill("");
    await cdp.send("Input.insertText", { text: "그래" });
    // the IME has already dropped the syllable when the keydown comes (Safari): no composition open, keyCode 229
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
    await sleep(400);
    const sE1 = await state(A);
    const menuE1 = await A.page.locator(".cv-menu").count();
    check("a 229 Escape (Safari: the IME dropped the syllable) keeps the chat: caret, line and keyboard capture stay, no menu", sE1.focused && sE1.captured && sE1.value === "그래" && menuE1 === 0, { ...sE1, menu: menuE1 });
    await A.page.keyboard.press("Escape");
    const sE2 = await until(() => state(A), (s) => !s.focused);
    const menuE2 = await A.page.locator(".cv-menu").count();
    check("…and the next, plain Escape leaves the chat (no menu)", !sE2.focused && !sE2.captured && menuE2 === 0, { ...sE2, menu: menuE2 });
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    await A.page.locator(FIELD).fill("");
    await A.page.keyboard.press("Escape");
    await cdp.detach().catch(() => {});
    const sys = await systemLines(A);
    check("no rate-limit notice", sys.length === 0, sys);
  });

  await run.step("PC 7. 채팅창 클릭 없이 바로 말하기 → 채팅창으로 (지도·단축키 안 눌림)", async () => {
    await sleep(5800); // the chat window (3 lines / 5 s, + the bar's 0.5 s of slack): start fresh
    const cdp = await A.page.context().newCDPSession(A.page);
    const mode = () => A.page.evaluate(() => window.__cv.getView().mode);
    /** One key as the Korean IME in 한글 mode hands it to Chrome on Windows: key "Process", keyCode 229, the real code. */
    const imeDown = (code) =>
      cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    const keyUp = (code, key, vk) => cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    const compose = (text) => cdp.send("Input.imeSetComposition", { text, selectionStart: text.length, selectionEnd: text.length });
    const commit = (text) => cdp.send("Input.insertText", { text });

    const s0 = await state(A);
    const m0 = await mode();
    check("start: not chatting, the map is closed", !s0.focused && !s0.captured && m0 !== "ov", { ...s0, mode: m0 });

    // English: just start typing — the first key opens the chat and is typed into it.
    await A.page.keyboard.type("hi", { delay: 40 });
    const s1 = await until(() => state(A), (s) => s.value === "hi", 1500);
    check('English "hi" typed without clicking lands in the field (focused, keys captured)', s1.focused && s1.captured && s1.value === "hi", s1);
    await A.page.keyboard.press("Enter");
    check('"hi" sent once, the caret stays', (await sentOnce(A, "hi")) === 1 && (await state(A)).focused, await myLines(A));
    await A.page.keyboard.press("Enter"); // empty Enter: back to walking
    await until(() => state(A), (s) => !s.focused);

    // English-mode M is still the map (and the 🗺 button is untouched).
    await A.page.keyboard.press("KeyM");
    const ov = await until(mode, (m) => m === "ov", 2000);
    check("English-mode M still opens the map", ov === "ov", { mode: ov });
    await sleep(LOOK_MS); // a person sees the map before closing it (a second M sooner than TAKE_BACK_MS is the second ㅡ of a word)
    await A.page.keyboard.press("KeyM");
    const back = await until(mode, (m) => m !== "ov", 2000);
    check("…and closes it", back !== "ov" && !(await state(A)).focused, { mode: back });
    await sleep(600);

    // 한글 mode, "그래" (ㄱ ㅡ ㄹ ㅐ = R M F O) typed without clicking: R / M would be recenter / MAP, F interact.
    const p0 = await pos(A);
    await imeDown("KeyR");
    const sR = await state(A);
    check("한글 ㄱ (R) without clicking: the chat takes the caret during that keydown", sR.focused && sR.captured, sR);
    await compose("ㄱ");
    await keyUp("KeyR", "ㄱ", 82);
    await imeDown("KeyM");
    await compose("그");
    await keyUp("KeyM", "ㅡ", 77);
    await imeDown("KeyF");
    await compose("글");
    await keyUp("KeyF", "ㄹ", 70);
    await imeDown("KeyO");
    await commit("그");
    await compose("래");
    await keyUp("KeyO", "ㅐ", 79);
    const sK = await state(A);
    const mK = await mode();
    check('한글 "그래" (composing) is in the field — nothing lost', sK.value === "그래" && sK.focused, sK);
    check("…the map did NOT open (ㅡ is M)", mK !== "ov", { mode: mK });
    await commit("래");
    await A.page.keyboard.press("Enter");
    check('"그래" sent once, whole', (await sentOnce(A, "그래")) === 1 && count(await myLines(A), "그") === 0, await myLines(A));
    const p1 = await pos(A);
    check("…and the avatar never moved or turned to interact (ㄹ is F)", dist(p0, p1) < 0.05, { moved: Math.round(dist(p0, p1) * 1000) / 1000 });

    // The instant right after sending: the next syllable's first key is typing too (the caret never left).
    await imeDown("KeyM");
    await compose("ㅡ");
    const sN = await state(A);
    const mN = await mode();
    check("right after a send, the next 한글 key (ㅡ = M) goes into the field, not the map", sN.focused && sN.value === "ㅡ" && mN !== "ov", { ...sN, mode: mN });
    await commit("ㅡ");
    await keyUp("KeyM", "ㅡ", 77);
    await A.page.locator(FIELD).fill("");
    await A.page.keyboard.press("Escape");
    await until(() => state(A), (s) => !s.focused);

    // macOS hands the jamo itself as the key ("ㅡ" for M): same — typing, not the map.
    await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "ㅡ", code: "KeyM", text: "ㅡ", unmodifiedText: "ㅡ", windowsVirtualKeyCode: 77, nativeVirtualKeyCode: 77 });
    await keyUp("KeyM", "ㅡ", 77);
    const sM = await until(() => state(A), (s) => s.value === "ㅡ", 1500);
    const mM = await mode();
    check('jamo key "ㅡ" (macOS) without clicking lands in the field, the map stays closed', sM.focused && sM.value === "ㅡ" && mM !== "ov", { ...sM, mode: mM });
    await A.page.locator(FIELD).fill("");
    await A.page.keyboard.press("Escape");
    await until(() => state(A), (s) => !s.focused);

    // ...while WASD stays movement in 한글 mode (ㅈ = W): no chat, the avatar walks.
    const w0 = await pos(A);
    await imeDown("KeyW");
    await sleep(900);
    await keyUp("KeyW", "ㅈ", 87);
    await sleep(300);
    const w1 = await pos(A);
    const sW = await state(A);
    check("한글 ㅈ (W) still walks (moved > 0.8 m) and does not open the chat", dist(w0, w1) > 0.8 && !sW.focused && sW.value === "", { moved: Math.round(dist(w0, w1) * 100) / 100, ...sW });

    // Windows: Chrome turns the IME off outside a field, so in 한글 mode every key arrives as the plain latin letter
    // (key "m", keyCode 77 for ㅡ) — on a FRESH page too, nothing typed before. "그래" is r m f o: R (ㄱ) is a consonant
    // and recenters, but the M (ㅡ) right after it is the vowel of a word: typing — the chat opens, never the map.
    const leave = async () => {
      await A.page.locator(FIELD).fill("");
      await A.page.keyboard.press("Escape");
      await until(() => state(A), (s) => !s.focused);
      await sleep(700); // the Escape inside the chat already made the next key start afresh; a beat more
    };
    await sleep(700);
    const g0 = await pos(A);
    await A.page.keyboard.type("rmfo", { delay: 90 });
    const sG = await until(() => state(A), (s) => s.value === "mfo", 1500);
    const mG = await mode();
    check('Windows 한글 "그래" (plain r m f o, nothing typed before): the map stays closed, the chat took the keys from M on', mG !== "ov" && sG.focused && sG.value === "mfo", { ...sG, mode: mG });
    const g1 = await pos(A);
    check("…and F (ㄹ), typed into the field, never interacted or moved the avatar", dist(g0, g1) < 0.05, { moved: Math.round(dist(g0, g1) * 1000) / 1000 });
    await leave();
    // "응" is d m d: D (ㅇ) is a movement key (a short step), the M after it is typing.
    await A.page.keyboard.type("dmd", { delay: 90 });
    const sU = await until(() => state(A), (s) => s.value === "md", 1500);
    const mU = await mode();
    check('Windows 한글 "응" (plain d m d): the map stays closed, "md" is in the field', mU !== "ov" && sU.focused && sU.value === "md", { ...sU, mode: mU });
    await leave();
    // "뉴" is s b (ㅠ = B, the bag): the same.
    await A.page.keyboard.type("sb", { delay: 90 });
    const sD = await until(() => state(A), (s) => s.value === "b", 1500);
    check('Windows 한글 "뉴" (plain s b): B after a consonant is typing, not the bag', sD.focused && sD.value === "b", sD);
    await leave();

    // A line that STARTS with ㅡ / ㅠ (review round 2: ㅡㅡ, ㅠㅠ are among the commonest lines) — on Windows plain m m /
    // b b with no consonant before them. A lone M waits a moment (VOWEL_HOLD_MS) for the next key; a slower second key
    // (within the word gap) still takes back the map that opened meanwhile. A sampler in the page records every 10 ms
    // whether the view was in the overview (the map).
    const watchMap = () =>
      A.page.evaluate(() => {
        const w = { seen: false, ovMs: 0 };
        const t = setInterval(() => {
          if (window.__cv.getView().mode === "ov") {
            w.seen = true;
            w.ovMs += 10;
          }
        }, 10);
        window.__mapWatchStop = () => {
          clearInterval(t);
          return w;
        };
      });
    const mapWatched = () => A.page.evaluate(() => window.__mapWatchStop());
    /** Plain latin keys (Windows 한글 mode outside a field): `gap` ms from one keydown to the next, each held 50 ms. */
    const plain = async (keys, gap) => {
      for (const k of keys) {
        const t = Date.now();
        await A.page.keyboard.down(k);
        await sleep(50);
        await A.page.keyboard.up(k);
        await sleep(Math.max(0, gap - (Date.now() - t)));
      }
    };
    for (const [label, keys, gap, want, mapOk] of [
      ['"ㅡㅡ"', ["m", "m"], 150, "mm", "never"],
      ['"ㅡㅡ"', ["m", "m"], 350, "mm", "takenBack"],
      ['"ㅡㅡㅡ"', ["m", "m", "m"], 150, "mmm", "never"],
      ['"ㅠㅠ"', ["b", "b"], 150, "bb", "never"],
      ['"ㅠㅠ"', ["b", "b"], 450, "bb", "never"],
      ['"ㅡㅅㅡ"', ["m", "t", "m"], 200, "mtm", "never"],
    ]) {
      await watchMap();
      await plain(keys, gap);
      const s = await until(() => state(A), (v) => v.value === want, 1500);
      await sleep(450); // a map that went on opening would show by now
      const m = await mode();
      const w = await mapWatched();
      check(`Windows ${label} (plain ${keys.join(" ")}, ${gap} ms apart) without clicking: "${want}" in the chat, the map closed`, s.focused && s.value === want && m !== "ov", { ...s, mode: m, watch: w });
      if (mapOk === "never") check(`…${label} ${gap} ms: the map never opened at all`, !w.seen, w);
      else check(`…${label} ${gap} ms: the map only began to open and was taken back at once (≤ 200 ms)`, w.ovMs <= 200, w);
      await leave();
    }
    // English, typed straight away: "my turn" — the m no longer opens the map and stays in the line.
    await watchMap();
    await A.page.keyboard.type("my turn", { delay: 90 });
    const sMy = await until(() => state(A), (v) => v.value === "my turn", 1500);
    await sleep(450);
    const wMy = await mapWatched();
    check('English "my turn" typed without clicking: the whole line is in the chat, the map never opened', sMy.focused && sMy.value === "my turn" && !wMy.seen, { ...sMy, watch: wMy });
    await leave();

    // M on its own is the map — in English mode, and in 한글 mode on Windows — after its short wait.
    const tM = Date.now();
    await A.page.keyboard.press("KeyM");
    const ovL = await until(mode, (m) => m === "ov", 2000, 10);
    const waitedM = Date.now() - tM;
    const sL = await state(A);
    check("a lone M still opens the map (chat untouched)", ovL === "ov" && !sL.focused && sL.value === "", { mode: ovL, ...sL });
    check("…after its short wait only (≤ 500 ms from the key)", waitedM <= 500, { waitedMs: waitedM });
    await sleep(LOOK_MS); // a person sees the map before closing it (a second M sooner than TAKE_BACK_MS is the second ㅡ of a word)
    const tClose = Date.now();
    await A.page.keyboard.press("KeyM");
    const closedM = await until(mode, (m) => m !== "ov", 2000, 10);
    check("…and M on the open map closes it AT ONCE (no wait: the open map's own key)", closedM !== "ov" && Date.now() - tClose <= 200, { closeMs: Date.now() - tClose });
    await sleep(700);
    // M, then walking straight away (before the wait is over): the map opens AT ONCE with the W, and the avatar walks.
    const mw0 = await pos(A);
    await A.page.keyboard.press("KeyM");
    await sleep(100);
    await A.page.keyboard.down("KeyW");
    const ovMW = await mode();
    await sleep(800);
    await A.page.keyboard.up("KeyW");
    await sleep(300);
    const mw1 = await pos(A);
    const sMW = await state(A);
    check("M, then W 0.1 s later: the map is open as the W goes down, and the avatar walks (> 0.2 m; no chat)", ovMW === "ov" && dist(mw0, mw1) > 0.2 && !sMW.focused && sMW.value === "", { modeAtW: ovMW, moved: Math.round(dist(mw0, mw1) * 100) / 100, ...sMW });
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(700);
    // M, a look at the map, M again: the map just closes again (no chat).
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m === "ov", 2000);
    await sleep(LOOK_MS);
    await A.page.keyboard.press("KeyM");
    const backMM = await until(mode, (m) => m !== "ov", 2000);
    await sleep(300);
    const sMM2 = await state(A);
    check("M, a look at the map (past the take-back), M again: the map closes, no chat", backMM !== "ov" && !sMM2.focused && sMM2.value === "", { mode: backMM, ...sMM2 });
    await sleep(700);
    // Walking (W held down) and pressing M on the way: the map, not the chat.
    await A.page.keyboard.down("KeyW");
    await sleep(350);
    await A.page.keyboard.press("KeyM");
    const ovW = await until(mode, (m) => m === "ov", 2000);
    await A.page.keyboard.up("KeyW");
    const sWM = await state(A);
    check("walking with W held, then M: the map opens (no chat)", ovW === "ov" && !sWM.focused && sWM.value === "", { mode: ovW, ...sWM });
    await sleep(LOOK_MS); // a person sees the map before closing it (a second M sooner than TAKE_BACK_MS is the second ㅡ of a word)
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    // A consonant, then a pause longer than a slow typist's (WORD_GAP_MS, 1.5 s), then M: the map (a key on its own).
    await sleep(700);
    await A.page.keyboard.press("KeyR");
    await sleep(LOOK_MS);
    await A.page.keyboard.press("KeyM");
    const ovP = await until(mode, (m) => m === "ov", 2000);
    check("R, a pause past the word gap (1.7 s), then M: the map opens", ovP === "ov" && !(await state(A)).focused, { mode: ovP });
    await sleep(LOOK_MS); // a person sees the map before closing it (a second M sooner than TAKE_BACK_MS is the second ㅡ of a word)
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(700);
    // V (switch the view), the view settles (~0.3 s), then M: the map — V is left out of the rule on purpose.
    const v0 = await mode();
    await A.page.keyboard.press("KeyV");
    const v1 = await until(mode, (m) => m !== v0, 1500);
    await sleep(150);
    await A.page.keyboard.press("KeyM");
    const ovV = await until(mode, (m) => m === "ov", 2000);
    check("V, then M 0.3 s later: the view switches and the map opens (no chat)", v1 !== v0 && ovV === "ov" && !(await state(A)).focused, { before: v0, afterV: v1, mode: ovV });
    await sleep(LOOK_MS); // a person sees the map before closing it (a second M sooner than TAKE_BACK_MS is the second ㅡ of a word)
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(700);
    await A.page.keyboard.press("KeyV"); // back to the view it had
    await until(mode, (m) => m === v0, 1500);
    await sleep(600);

    // Walking on the open map (review round 3: WASD on the map must still walk): M, the map, then W held 0.7 s while the
    // take-back is still running — the avatar walks, the map stays open, no chat. Then a short step (a W tap — a
    // consonant key!) and M right after: the open map's close key, at once — never read as "즈".
    // The walks above went north toward the fountain: back to the open start spot first, so this W has room. The camera
    // turn ends with a short Z / C tap (a consonant), so wait past the word gap before the M.
    await walkAndWait(A, 0, 16.8, 20000, 0.5);
    await turnCameraTo(A, 0, 0);
    await sleep(LOOK_MS);
    const om0 = await pos(A);
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m === "ov", 2000);
    await sleep(150);
    await A.page.keyboard.down("KeyW");
    await sleep(700);
    await A.page.keyboard.up("KeyW");
    await sleep(300);
    const om1 = await pos(A);
    const sOM = await state(A);
    const mOM = await mode();
    check("the map open (inside the take-back): W walks the avatar (> 0.3 m), the map stays open, no chat", mOM === "ov" && dist(om0, om1) > 0.3 && !sOM.focused && sOM.value === "", { mode: mOM, moved: Math.round(dist(om0, om1) * 100) / 100, ...sOM });
    await A.page.keyboard.press("KeyW"); // a short step (a tap)
    await sleep(200);
    const tOM = Date.now();
    await A.page.keyboard.press("KeyM");
    const mOM2 = await until(mode, (m) => m !== "ov", 2000, 10);
    await sleep(400);
    const sOM2 = await state(A);
    check("…a short step, then M 0.2 s later: the map closes at once, and no chat opened (not \"즈\")", mOM2 !== "ov" && Date.now() - tOM < 1000 && !sOM2.focused && sOM2.value === "", { mode: mOM2, ...sOM2 });
    await sleep(700);
    await cdp.detach().catch(() => {});
    const sys = await systemLines(A);
    check("no rate-limit notice", sys.length === 0, sys);
  });

  await run.step("PC 7b. Enter를 길게 눌러도 채팅에서 안 나감 (자동 반복)", async () => {
    await sleep(5800); // the chat window: start fresh
    const cdp = await A.page.context().newCDPSession(A.page);
    /** Enter as a held key sends it: the press, then the OS's auto-repeat keydowns, then one keyup. */
    const holdEnter = async (repeats) => {
      await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
      await sleep(500); // the OS repeat delay
      for (let i = 0; i < repeats; i++) {
        await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, autoRepeat: true });
        await sleep(33);
      }
      await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    };
    const s0 = await state(A);
    check("start: not chatting", !s0.focused, s0);
    await holdEnter(6);
    await sleep(200);
    const s1 = await state(A);
    check("a long Enter press opens the chat and it STAYS open (the repeats do not close it)", s1.focused && s1.captured && s1.value === "", s1);
    await A.page.keyboard.type("길게 엔터", { delay: 20 });
    await holdEnter(6);
    check('Enter held after typing: "길게 엔터" sent exactly once', (await sentOnce(A, "길게 엔터")) === 1, await myLines(A));
    const s2 = await state(A);
    check("…and the caret is still in the (empty) field — the repeats on the emptied field did not leave", s2.focused && s2.value === "", s2);
    await A.page.keyboard.press("Enter"); // a single empty Enter still leaves
    const s3 = await until(() => state(A), (s) => !s.focused);
    check("a short Enter on the empty field still leaves the chat", !s3.focused && !s3.captured, s3);
    await cdp.detach().catch(() => {});
    const sys = await systemLines(A);
    check("no rate-limit notice", sys.length === 0, sys);
  });

  await run.step("PC 7c. 빠르게 네 줄 → 네 번째 줄은 지워지지 않고 남았다가 나감", async () => {
    await sleep(5800); // the chat window: start fresh
    const sys0 = (await systemLines(A)).length;
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    const t0 = Date.now();
    for (const line of ["빠른1", "빠른2", "빠른3", "빠른4"]) {
      await A.page.keyboard.type(line, { delay: 10 });
      await A.page.keyboard.press("Enter");
      await sleep(150);
    }
    await sleep(800);
    const lines = await myLines(A);
    const s1 = await state(A);
    const sys1 = (await systemLines(A)).slice(sys0);
    check("three quick lines go out", ["빠른1", "빠른2", "빠른3"].every((l) => count(lines, l) === 1), lines);
    check("the 4th is held back: NOT sent, still in the field, the caret stays", count(lines, "빠른4") === 0 && s1.value === "빠른4" && s1.focused, s1);
    check("…with the rate notice, once", sys1.length === 1 && sys1[0].includes("너무 빨라요"), sys1);
    const n1 = await noteInfo(A);
    check("…and a note right above the bar says why (on screen, on top, not covering the bar)", n1?.visible && n1.text.includes("너무 빨라요") && n1.aboveBar && n1.onScreen && n1.onTop && n1.role === "status", n1);
    const b1 = await sendInfo(A);
    check("…while the send button is dimmed", b1?.dim === true && b1.opacity < 1, b1);
    await shots(A, "pc-held");
    // pressing again (Enter twice, the button once) while it is held: still held, and NO further notice in the log
    await A.page.keyboard.press("Enter");
    await sleep(150);
    await A.page.keyboard.press("Enter");
    await sleep(150);
    await A.page.mouse.click(b1.box.x + b1.box.w / 2, b1.box.y + b1.box.h / 2);
    await sleep(300);
    const sys1b = (await systemLines(A)).slice(sys0);
    const s1b = await state(A);
    check("three more presses during the hold: still exactly ONE notice in the log, the line still waiting", sys1b.length === 1 && s1b.value === "빠른4" && s1b.focused && count(await myLines(A), "빠른4") === 0, { sys: sys1b, ...s1b });
    // the hold ends by itself (5 s + the slack, from the first line): the note goes, the button lights up again
    const n2 = await until(() => noteInfo(A), (n) => n === null, 7000, 100);
    const b2 = await sendInfo(A);
    check("when the line may go: the note is gone and the send button is lit again", n2 === null && b2?.dim === false, { note: n2, button: b2, afterMs: Date.now() - t0 });
    await A.page.keyboard.press("Enter");
    check('…and a moment later Enter sends "빠른4" exactly once', (await sentOnce(A, "빠른4")) === 1, await myLines(A));
    const s2 = await state(A);
    check("…the field is empty, the caret still there", s2.focused && s2.value === "", s2);
    const sys2 = (await systemLines(A)).slice(sys0);
    check("no notice from the server (it never dropped a line)", sys2.length === 1, sys2);
    await A.page.keyboard.press("Escape");
    await until(() => state(A), (s) => !s.focused);
  });

  await run.step("PC 8. 내 줄은 각각 한 번씩만 (전체 로그)", async () => {
    const lines = await myLines(A);
    const want = ["첫 번째 줄", "두 번째 줄", "버튼으로 보냄", "안녕하세요", "반가워요", "사파리", "hi", "그래", "길게 엔터", "빠른1", "빠른2", "빠른3", "빠른4"];
    check("my log is exactly these thirteen lines, in order", JSON.stringify(lines) === JSON.stringify(want), lines);
  });
  await A.ctx.close();
}

// ─────────────────────────────────────────────────────────── phones ───────────────────────────────────────────────────────────

async function phone(browser, label, device) {
  const P = await openPlayer(browser, run, { tag: label, device });
  await run.step(`${label} 1. 마을 입장`, async () => {
    const { nick } = await joinVillage(P, "폰");
    check("joined the village", !!nick, { nick });
    const s = await state(P);
    check("the bar is folded until 💬", s.collapsed && !s.focused, s);
  });

  await run.step(`${label} 2. 💬 → 입력 → 보내기 → 그대로 → 화면 탭 → 접힘`, async () => {
    await press(P, P.page.locator(".cv-chat-btn"));
    const s1 = await until(() => state(P), (s) => s.focused);
    check("💬 focuses the field and unfolds the bar", s1.focused && !s1.collapsed && s1.focusClass, s1);
    const info0 = await sendInfo(P);
    check('send button "보내기" at the end of the bar, dimmed while empty', info0?.name === "보내기" && info0.inside && info0.atEnd && info0.dim, info0);
    check(`…big enough to hit with a thumb (≥ ${MIN_TOUCH_PX} px, the project's touch minimum)`, info0 && info0.box.w >= MIN_TOUCH_PX - 0.5 && info0.box.h >= MIN_TOUCH_PX - 0.5, info0?.box);
    await shots(P, `${label}-empty`);

    await P.page.keyboard.type("폰에서 버튼", { delay: 25 });
    await shots(P, `${label}-text`);
    await press(P, P.page.locator(SEND));
    check('"폰에서 버튼" sent exactly once', (await sentOnce(P, "폰에서 버튼")) === 1, await myLines(P));
    const s2 = await state(P);
    check("after the button the field keeps focus (keyboard stays up), the bar stays open", s2.focused && !s2.collapsed && s2.focusClass && s2.value === "", s2);

    await P.page.keyboard.type("폰에서 엔터", { delay: 25 });
    await P.page.keyboard.press("Enter");
    check('"폰에서 엔터" sent exactly once', (await sentOnce(P, "폰에서 엔터")) === 1, await myLines(P));
    const s3 = await state(P);
    check("after Enter the field keeps focus too", s3.focused && !s3.collapsed, s3);

    // a tap on the scene (the look half, upper right) folds the chat away. The rest of the HUD keeps its chat layout
    // until that tap is over (its click, or 0.4 s after the finger lifts — ChatInput leaveTapStep), then comes back.
    const vp = P.page.viewportSize();
    const tTap = Date.now();
    await P.page.touchscreen.tap(Math.round(vp.width * 0.72), Math.round(vp.height * 0.33));
    const s4 = await until(() => state(P), (s) => !s.focused && !s.focusClass, 1500, 20);
    const hudBackMs = Date.now() - tTap;
    check("a tap on the scene leaves the chat: field blurred, bar folded, keyboard capture released", !s4.focused && s4.collapsed && !s4.captured && !s4.focusClass, s4);
    check("…and the HUD's chat layout ends with that tap (≤ 0.6 s)", hudBackMs <= 600, { hudBackMs });
    const btn = await until(() => P.page.locator(".cv-chat-btn").count(), (n) => n === 1, 1500);
    check("…and 💬 is back", btn === 1, { count: btn });
    await shots(P, `${label}-after-tap`);
  });

  // Review round 2: on a phone the log is folded away and the bar rides on the keyboard — a 4th quick line held back by
  // the pace must say so right where the thumb is, not only in the folded log.
  await run.step(`${label} 3. 빠르게 네 줄(버튼) → 네 번째는 남고, 바 바로 위에 안내`, async () => {
    await sleep(5800); // the chat window: start fresh
    await press(P, P.page.locator(".cv-chat-btn"));
    await until(() => state(P), (s) => s.focused);
    for (const line of ["폰1", "폰2", "폰3", "폰4"]) {
      await P.page.keyboard.type(line, { delay: 15 });
      await press(P, P.page.locator(SEND));
      await sleep(150);
    }
    await sleep(400);
    const s1 = await state(P);
    const lines = await myLines(P);
    check("three quick lines go, the 4th stays in the field (focused, bar open)", ["폰1", "폰2", "폰3"].every((l) => count(lines, l) === 1) && count(lines, "폰4") === 0 && s1.value === "폰4" && s1.focused && !s1.collapsed, { ...s1, lines });
    const n1 = await noteInfo(P);
    check("…a note right above the bar says why — visible on the phone screen, on top", n1?.visible && n1.text.includes("너무 빨라요") && n1.aboveBar && n1.onScreen && n1.onTop, n1);
    const b1 = await sendInfo(P);
    check("…and the send button is dimmed while it waits", b1?.dim === true && b1.opacity < 1, b1);
    await shots(P, `${label}-held`);
    // a second tap meanwhile: no second notice. (A real tap at its centre: Playwright's own tap() waits for an
    // aria-disabled button to become "enabled" — it would sit there until the hold is over and then send.)
    await P.page.touchscreen.tap(Math.round(b1.box.x + b1.box.w / 2), Math.round(b1.box.y + b1.box.h / 2));
    await sleep(300);
    const sys = await systemLines(P);
    check("…one notice in the log however often the button is tapped", count(sys, sys.find((t) => t.includes("너무 빨라요"))) === 1, sys);
    const n2 = await until(() => noteInfo(P), (n) => n === null, 7000, 100);
    const b2 = await sendInfo(P);
    check("when the line may go: the note is gone, the button lit", n2 === null && b2?.dim === false, { note: n2, button: b2 });
    await press(P, P.page.locator(SEND));
    check('then a tap sends "폰4" exactly once, the keyboard stays (focused)', (await sentOnce(P, "폰4")) === 1 && (await state(P)).focused, await myLines(P));
    const vp = P.page.viewportSize();
    await P.page.touchscreen.tap(Math.round(vp.width * 0.72), Math.round(vp.height * 0.33)); // leave the chat
    await until(() => state(P), (s) => !s.focused && !s.focusClass, 1500);
  });

  // Review round 3: the tap that leaves the chat blurred the field at its pointerdown and the HUD came back before the
  // finger lifted; the browser aims a tap's click when the finger LIFTS, so that same tap's click landed on a button that
  // had just come back. Tap exactly where 💬, the emoji fan button, the action button and the jump button come back:
  // nothing may fire, the chat must stay closed, the keyboard must not come back (no focus on the field again).
  //  - "keyboard up": the soft keyboard is mocked (visualViewport 300 px shorter), so the bar rides above the keyboard
  //    and every button's centre is free — the tap lands exactly on it.
  //  - "keyboard down" (Android's back key folds the keyboard, the field keeps the caret; a tablet with a keyboard): the
  //    bar sits at the bottom; the tap lands on the part of the button the bar does not cover (skipped when none).
  //  - "finger 0.3 s": the same exact spots with the finger down 0.3 s, as people often tap — long enough for the action
  //    button, which comes back with the next interaction poll, to be there before the finger lifts.
  await run.step(`${label} 4. 채팅에서 나오는 탭 — 새로 나타나는 💬·이모지·행동·점프 버튼이 눌리지 않음`, async () => {
    // the action button (말 걸기) shows next to the plaza guide — walk there (again when a tap on the scene walked the
    // avatar away: every tap below that lands on the 3D view is a click-move)
    const atGuide = async (first = false) => {
      let n = await P.page.locator(".cv-action-btn").count();
      for (let attempt = 0; attempt < 3 && n !== 1; attempt++) {
        if (first && attempt === 0) await standAtPlazaGuide(P);
        else {
          await walkAndWait(P, 5, 13.7, 15000, 0.3);
          await turnCameraTo(P, 5, 12);
        }
        n = await until(() => P.page.locator(".cv-action-btn").count(), (c) => c === 1, 4000, 150);
      }
      return n;
    };
    const nAct = await atGuide(true);
    check("next to the plaza guide the action button shows (so its place can be tapped)", nAct === 1, { count: nAct, at: await pos(P) });
    const rects = await P.page.evaluate(() => {
      const r = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return b.width > 0 ? { x: b.x, y: b.y, w: b.width, h: b.height } : null;
      };
      return { action: r(".cv-action-btn"), "💬": r(".cv-chat-btn"), emoji: r(".cv-emoji-toggle"), jump: r(".cv-jump-btn") };
    });
    check("all four buttons are on screen before chatting", Object.values(rects).every((v) => v !== null), rects);
    await P.page.evaluate(async () => {
      const { useNpcStore } = await window.__imp("/src/stores/npcStore.ts");
      const sid = window.__cv.getSessionId();
      const HUD = ".cv-chat-btn, .cv-emoji-toggle, .cv-emoji-fan-btn, .cv-action-btn, .cv-jump-btn";
      const pr = { focusins: 0, clicks: [], hudClicks: [], jumped: false, npc: false, fan: false, timer: 0 };
      window.__tapProbe = pr;
      document.addEventListener("focusin", (e) => {
        if (e.target === document.querySelector(".cv-chat-field")) pr.focusins++;
      }, true);
      document.addEventListener("click", (e) => {
        const t = e.target instanceof Element ? e.target : null;
        const hud = t?.closest(HUD);
        pr.clicks.push(hud ? hud.className : t ? (typeof t.className === "string" && t.className ? t.className : t.tagName) : null);
        if (hud) pr.hudClicks.push(hud.className);
      }, true);
      pr.reset = () => {
        pr.focusins = 0;
        pr.clicks = [];
        pr.hudClicks = [];
        pr.jumped = false;
        pr.npc = false;
        pr.fan = false;
        clearInterval(pr.timer);
        // what the tap may set off, sampled every 20 ms: an own jump in the air, the 조교 dialogue, the emoji fan
        pr.timer = setInterval(() => {
          if (window.__cv.getJumps().some((j) => j.sid === sid)) pr.jumped = true;
          if (useNpcStore.getState().activeNpc !== null) pr.npc = true;
          if (document.documentElement.classList.contains("cv-fan-open")) pr.fan = true;
        }, 20);
      };
      pr.read = () => {
        clearInterval(pr.timer);
        const { reset, read, timer, ...rest } = pr;
        return JSON.parse(JSON.stringify(rest));
      };
    });
    const kbdUp = () =>
      P.page.evaluate(() => {
        const proto = Object.getPrototypeOf(window.visualViewport);
        window.__vvOrig = window.__vvOrig ?? Object.getOwnPropertyDescriptor(proto, "height");
        Object.defineProperty(proto, "height", { configurable: true, get: () => window.innerHeight - 300 });
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
    const kbdDown = () =>
      P.page.evaluate(() => {
        if (!window.__vvOrig) return;
        Object.defineProperty(Object.getPrototypeOf(window.visualViewport), "height", window.__vvOrig);
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
    /** Where to tap: the button's centre — or, with the keyboard down, the highest-up point on its vertical centre line the bar does not cover. */
    const spot = (r, exact) =>
      P.page.evaluate(
        ([r, exact]) => {
          const bar = document.querySelector(".cv-chat-input");
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          const free = (x, y) => {
            const el = document.elementFromPoint(x, y);
            return !!el && !bar.contains(el);
          };
          if (exact) return { x: cx, y: cy, free: free(cx, cy) };
          for (let y = cy; y >= r.y + 6; y -= 3) if (free(cx, y)) return { x: cx, y, free: true };
          return null;
        },
        [r, exact],
      );
    const cdpT = await P.page.context().newCDPSession(P.page);
    /** A tap with the finger down `ms` (raw touch events: Playwright's own tap lifts at once). */
    const slowTap = async (x, y, ms) => {
      await cdpT.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await sleep(ms);
      await cdpT.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    };
    for (const [keyboard, fingerMs] of [["up", 0], ["down", 0], ["up, finger 0.3 s", 300]]) {
      for (const [name, r] of Object.entries(rects)) {
        if (!r) continue;
        if (name === "action") {
          const n = await atGuide();
          check(`[keyboard ${keyboard}] before the chat: the action button is there (next to the guide)`, n === 1, { count: n, at: await pos(P) });
        }
        await press(P, P.page.locator(".cv-chat-btn"));
        const s0 = await until(() => state(P), (s) => s.focused, 2000);
        check(`[keyboard ${keyboard}] a real tap ON 💬 (not chatting) opens the chat with the keyboard (focused)`, s0.focused && s0.focusClass, s0);
        if (keyboard !== "down") await kbdUp();
        await sleep(250);
        const at = await spot(r, keyboard !== "down");
        if (!at || !at.free) {
          check(`[keyboard ${keyboard}] ${name}: the bar covers the whole spot — nothing to tap there (skipped)`, true, { rect: r, at });
          await kbdDown();
          await P.page.touchscreen.tap(Math.round(P.page.viewportSize().width * 0.72), Math.round(P.page.viewportSize().height * 0.33));
          await until(() => state(P), (s) => !s.focused && !s.focusClass, 1500);
          await sleep(500);
          continue;
        }
        if (keyboard === "up" && name === "action") await shots(P, `${label}-tap-${name}-before`);
        await P.page.evaluate(() => window.__tapProbe.reset());
        if (fingerMs > 0) await slowTap(Math.round(at.x), Math.round(at.y), fingerMs);
        else await P.page.touchscreen.tap(Math.round(at.x), Math.round(at.y));
        await sleep(900);
        const s1 = await state(P);
        const pr = await P.page.evaluate(() => window.__tapProbe.read());
        const back = await P.page.locator(".cv-chat-btn").count();
        check(
          `[keyboard ${keyboard}] tap where ${name} comes back: the chat is left (blurred, folded, keys free) and the keyboard does NOT come back`,
          !s1.focused && s1.collapsed && !s1.captured && pr.focusins === 0,
          { at: { x: Math.round(at.x), y: Math.round(at.y) }, ...s1, focusins: pr.focusins },
        );
        check(
          `[keyboard ${keyboard}] …nothing fired: no click on a HUD button, no jump, no 조교 dialogue, no emoji fan`,
          pr.hudClicks.length === 0 && !pr.jumped && !pr.npc && !pr.fan,
          pr,
        );
        check(`[keyboard ${keyboard}] …and once the tap is over the HUD is back (💬 there, chat layout gone)`, back === 1 && !s1.focusClass, { chatBtn: back, focusClass: s1.focusClass });
        if (keyboard === "up" && name === "action") await shots(P, `${label}-tap-${name}-after`);
        await kbdDown();
        // whatever did fire is put back, so the next round starts the same
        await P.page.evaluate(async () => {
          const { useNpcStore } = await window.__imp("/src/stores/npcStore.ts");
          if (useNpcStore.getState().activeNpc !== null) useNpcStore.getState().closePanel();
          if (document.documentElement.classList.contains("cv-fan-open")) document.querySelector(".cv-emoji-toggle")?.click();
          if (document.activeElement === document.querySelector(".cv-chat-field")) document.activeElement.blur();
        });
        await sleep(600);
      }
    }
    await cdpT.detach().catch(() => {});
  });

  // The 48 px send button still fits a 320 px phone with the length counter showing.
  await run.step(`${label} 5. 320 px 폭: 48 px 보내기 버튼과 글자 수가 바 안에`, async () => {
    const vp0 = P.page.viewportSize();
    await P.page.setViewportSize({ width: 320, height: 640 });
    await sleep(600);
    await press(P, P.page.locator(".cv-chat-btn"));
    await until(() => state(P), (s) => s.focused);
    await P.page.locator(FIELD).fill("가".repeat(195));
    await sleep(300);
    const info = await sendInfo(P);
    const geo = await P.page.evaluate(() => {
      const box = (sel) => {
        const e = document.querySelector(sel);
        if (!e) return null;
        const r = e.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, h: r.height };
      };
      return { bar: box(".cv-chat-input"), field: box(".cv-chat-field"), counter: box(".cv-chat-counter"), text: document.querySelector(".cv-chat-counter")?.textContent, vw: innerWidth };
    });
    const inBar = (b) => !!b && b.left >= geo.bar.left - 0.5 && b.right <= geo.bar.right + 0.5;
    check(
      "320 px: the send button is 48 × 48, at the end, inside the bar — the counter (195/200) inside too, the field still usable (≥ 120 px)",
      info && info.box.w >= MIN_TOUCH_PX - 0.5 && info.box.h >= MIN_TOUCH_PX - 0.5 && info.inside && info.atEnd && inBar(geo.counter) && geo.text === "195/200" && geo.field.w >= 120 && geo.bar.left >= 0 && geo.bar.right <= geo.vw,
      { send: info?.box, ...geo },
    );
    await shots(P, `${label}-320`);
    await P.page.locator(FIELD).fill("");
    await P.page.touchscreen.tap(Math.round(320 * 0.72), Math.round(640 * 0.33));
    await until(() => state(P), (s) => !s.focused, 1500);
    await P.page.setViewportSize(vp0);
    await sleep(500);
  });
  await P.ctx.close();
}

// ─────────────────────────────────────────────── PC: the slow-typing matrix ───────────────────────────────────────────────
// Review round 3: a slower typist (about 0.6 s a key or slower) still got the map — "그래" (r m f o) left it open with
// only "o" in the chat on top, "음" (d m a) and "즈" (w m) opened it. Every line is typed as Windows Chrome hands it
// outside a field in 한글 mode (plain latin keys, each held 50 ms) at 0.3 / 0.6 / 0.9 / 1.2 s a key, with nothing clicked
// first; a sampler in the page records every 10 ms whether the map (the overview) is open. The map must never end open
// and never stand open longer than the take-back (1.5 s); the line from its first letter on is in the chat.

async function pcMatrix(browser) {
  const A = await openPlayer(browser, run, { tag: "pc-matrix", device: DESKTOP });
  await run.step("PC-M 1. 마을 입장", async () => {
    const { nick } = await joinVillage(A, "느림");
    check("joined the village", !!nick, { nick });
  });
  const mode = () => A.page.evaluate(() => window.__cv.getView().mode);
  const watchMap = () =>
    A.page.evaluate(() => {
      const w = { seen: false, ovMs: 0, longest: 0, run: 0 };
      const t = setInterval(() => {
        if (window.__cv.getView().mode === "ov") {
          w.seen = true;
          w.ovMs += 10;
          w.run += 10;
          w.longest = Math.max(w.longest, w.run);
        } else w.run = 0;
      }, 10);
      window.__mapWatchStop = () => {
        clearInterval(t);
        const { run: _r, ...rest } = w;
        return rest;
      };
    });
  const mapWatched = () => A.page.evaluate(() => window.__mapWatchStop());
  /** Plain latin keys: `gap` ms from one keydown to the next, each held `hold` ms. */
  const plain = async (keys, gap, hold = 50) => {
    for (const ch of keys) {
      const k = ch === " " ? "Space" : ch;
      const t = Date.now();
      await A.page.keyboard.down(k);
      await sleep(hold);
      await A.page.keyboard.up(k);
      await sleep(Math.max(0, gap - (Date.now() - t)));
    }
  };
  const leave = async () => {
    await A.page.locator(FIELD).fill("");
    await A.page.keyboard.press("Escape");
    await until(() => state(A), (s) => !s.focused);
    if ((await mode()) === "ov") {
      // a map left open by a failed case: close it, so the next case starts the same
      await sleep(LOOK_MS);
      await A.page.keyboard.press("KeyM");
      await until(mode, (m) => m !== "ov", 2000);
    }
    await sleep(700);
  };
  const LINES = [
    ["그래", [..."rmfo"], "mfo"],
    ["음", [..."dma"], "ma"],
    ["즈", [..."wm"], "m"],
    ["ㅡㅡ", [..."mm"], "mm"],
    ["안녕하세요", [..."dkssudgktpdy"], "kssudgktpdy"],
    ["그래 알겠어", [..."rmfo dkfrpTdj"], "mfo dkfrpTdj"], // ㅆ = T (Shift)
  ];
  const summary = [];
  for (const gap of [300, 600, 900, 1200]) {
    await run.step(`PC-M ${gap} ms/키 — 그래 · 음 · 즈 · ㅡㅡ · 안녕하세요 · 그래 알겠어 (채팅창 클릭 없이)`, async () => {
      for (const [label, keys, want] of LINES) {
        await watchMap();
        await plain(keys, gap);
        await sleep(TAKE_BACK_MS + 300); // every hold and take-back is over: a map that stayed would show now
        const s = await until(() => state(A), (v) => v.value === want, 1500);
        const m = await mode();
        const w = await mapWatched();
        summary.push({ gap, label, value: s.value, mapEnd: m, ...w });
        check(`${gap} ms/key "${label}" (${keys.join("")}): "${want}" in the chat (focused), the map closed at the end`, s.focused && s.value === want && m !== "ov", { ...s, mode: m, watch: w });
        check(`…${gap} ms/key "${label}": the map never stood open longer than the take-back (${TAKE_BACK_MS} ms)`, w.longest <= TAKE_BACK_MS && w.ovMs <= TAKE_BACK_MS, w);
        if (label !== "ㅡㅡ") check(`…${gap} ms/key "${label}": the map never opened at all (the M followed a consonant: typing at once)`, !w.seen, w);
        // the slowest pace: what the player sees once the line is typed (the chat holding it, the map closed)
        if (gap === 1200 && label === "ㅡㅡ") await shots(A, "pc-matrix-1200-mm");
        if (gap === 1200 && label === "그래 알겠어") await shots(A, "pc-matrix-1200-line");
        await leave();
      }
    });
  }

  await run.step("PC-M 그 밖 — me too, ㅡ 뒤 F·Z, ㄱ 누른 채 ㅡ (그), 오래 걷고 M", async () => {
    // English "me too", fast and slow: the E is a letter of the line, not the interact key (no map left behind)
    for (const gap of [90, 600]) {
      await watchMap();
      await plain([..."me too"], gap);
      await sleep(TAKE_BACK_MS + 300);
      const s = await until(() => state(A), (v) => v.value === "me too", 1500);
      const m = await mode();
      const w = await mapWatched();
      check(`"me too" at ${gap} ms/key: the whole line in the chat, the map closed (open ≤ take-back)`, s.focused && s.value === "me too" && m !== "ov" && w.longest <= TAKE_BACK_MS, { ...s, mode: m, watch: w });
      await leave();
    }
    // ㅡ then an interact / camera letter, slowly (0.9 s): the map that began to open is taken back, the chat has both
    for (const k of ["f", "z", "e", "r"]) {
      const o0 = await A.page.evaluate(() => window.__cv.getOrbit().yaw);
      await watchMap();
      await plain(["m", k], 900);
      await sleep(TAKE_BACK_MS + 300);
      const s = await until(() => state(A), (v) => v.value === "m" + k, 1500);
      const m = await mode();
      const w = await mapWatched();
      const o1 = await A.page.evaluate(() => window.__cv.getOrbit().yaw);
      check(`m, 0.9 s, ${k}: "m${k}" in the chat, the map taken back (open ≤ take-back), the camera did not turn`, s.focused && s.value === "m" + k && m !== "ov" && w.longest <= TAKE_BACK_MS && Math.abs(o1 - o0) < 0.05, { ...s, mode: m, watch: w, yaw: [o0, o1] });
      await leave();
    }
    // "그" typed with ㄱ still held 200 ms (a slow typist's roll-over): the chat, never the map
    await watchMap();
    await A.page.keyboard.down("r");
    await sleep(200);
    await A.page.keyboard.down("m");
    await sleep(40);
    await A.page.keyboard.up("r");
    await sleep(40);
    await A.page.keyboard.up("m");
    await sleep(TAKE_BACK_MS);
    const sG = await until(() => state(A), (v) => v.value === "m", 1500);
    const wG = await mapWatched();
    check('"그" with ㄱ (R) still held 200 ms when ㅡ (M) went down: "m" in the chat, the map never opened', sG.focused && sG.value === "m" && !wG.seen, { ...sG, watch: wG });
    await leave();
    // walking 0.9 s with W, letting go, M 0.3 s later: the map (a held W is no letter)
    await A.page.keyboard.down("KeyW");
    await sleep(900);
    await A.page.keyboard.up("KeyW");
    await sleep(300);
    await A.page.keyboard.press("KeyM");
    const ovW = await until(mode, (m) => m === "ov", 2000);
    const sW = await state(A);
    check("walking 0.9 s with W, then M 0.3 s after letting go: the map opens (no chat)", ovW === "ov" && !sW.focused && sW.value === "", { mode: ovW, ...sW });
    await sleep(LOOK_MS);
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    const sys = await systemLines(A);
    check("no rate-limit notice", sys.length === 0, sys);
    run.check("slow-typing matrix summary", true, summary);
  });
  await A.ctx.close();
}

// ─────────────────────────────────────────────────────── legacy world ───────────────────────────────────────────────────────

async function legacy(browser) {
  const L = await openPlayer(browser, run, { tag: "legacy", device: DESKTOP });
  const offShadow = run.allow("PCFSoftShadowMap deprecation (legacy world)", /PCFSoftShadowMap has been deprecated/);
  await run.step("Legacy world: same chat bar (Enter stays, click leaves)", async () => {
    await L.page.goto(new URL("/?world=legacy", CLIENT_URL).href, { waitUntil: "domcontentloaded" });
    await entryReady(L);
    L.nick = `옛${Math.floor(Math.random() * 900 + 100)}`;
    await L.page.locator("input.cv-input").first().fill(L.nick);
    await L.page.locator(".cv-submit").click();
    await L.page.waitForFunction(() => window.__cv?.getScreen?.() === "world" && !!window.__cv?.getPos, null, { timeout: 40000 });
    await sleep(2500);
    await L.page.keyboard.press("Enter");
    await until(() => state(L), (s) => s.focused);
    await L.page.keyboard.type("옛 월드 한 줄", { delay: 20 });
    await L.page.keyboard.press("Enter");
    check('legacy: "옛 월드 한 줄" sent once', (await sentOnce(L, "옛 월드 한 줄")) === 1, await myLines(L));
    const s1 = await state(L);
    check("legacy: the caret stays in the field", s1.focused && s1.value === "", s1);
    check("legacy: the send button is there", (await sendInfo(L))?.name === "보내기", await sendInfo(L));
    const vp = L.page.viewportSize();
    await L.page.mouse.click(vp.width / 2, vp.height * 0.3);
    const s2 = await until(() => state(L), (s) => !s.focused, 1500);
    check("legacy: a click on the 3D view leaves the chat", !s2.focused && !s2.captured, s2);
  });
  offShadow();
  await L.ctx.close();
}

// ─────────────────────────────────────────── AI 학교 탈출: the class hall ───────────────────────────────────────────
// Needs the server started with TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json (the TEST key of lib/escape.mjs).

async function hall(browser) {
  const T = await openPlayer(browser, run, { tag: "hall", device: DESKTOP });
  await run.step("AI 학교 탈출 반 복도: same chat bar (Enter stays, button, click leaves)", async () => {
    T.nick = `쌤${Math.floor(Math.random() * 900 + 100)}`;
    const code = await joinAsTeacher(T, T.nick);
    check("the class hall is up", !!code, { code });
    check("the hall has the same bar with the send button", (await sendInfo(T))?.name === "보내기", await sendInfo(T));
    await T.page.keyboard.press("Enter");
    await until(() => state(T), (s) => s.focused);
    await T.page.keyboard.type("복도 한 줄", { delay: 20 });
    await T.page.keyboard.press("Enter");
    check('hall: "복도 한 줄" sent once', (await sentOnce(T, "복도 한 줄")) === 1, await myLines(T));
    const s1 = await state(T);
    check("hall: the caret stays in the field", s1.focused && s1.value === "", s1);
    await T.page.keyboard.type("버튼", { delay: 20 });
    await T.page.locator(SEND).click();
    check('hall: "버튼" sent once by the button', (await sentOnce(T, "버튼")) === 1 && (await state(T)).focused, await myLines(T));
    const vp = T.page.viewportSize();
    await T.page.mouse.click(vp.width / 2, vp.height * 0.35);
    const s2 = await until(() => state(T), (s) => !s.focused, 1500);
    check("hall: a click on the 3D view leaves the chat", !s2.focused && !s2.captured, s2);
  });
  await T.ctx.close();
}

// Real Chrome with the GPU, as on the owner's PC (ANGLE / D3D11 on Windows).
const GPU_ARGS = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, channel: "chrome", args: GPU_ARGS });
// CV_CHAT_ONLY=pc,pc-matrix,iphone13,kakao-android,legacy,hall runs only those parts (default: all of them).
const ONLY = process.env.CV_CHAT_ONLY ? new Set(process.env.CV_CHAT_ONLY.split(",").map((t) => t.trim())) : null;
const want = (part) => !ONLY || ONLY.has(part);
try {
  if (want("pc")) await pc(browser);
  if (want("pc-matrix")) await pcMatrix(browser);
  if (want("iphone13")) await phone(browser, "iphone13", IPHONE_13);
  if (want("kakao-android")) await phone(browser, "kakao-android", KAKAO_ANDROID);
  if (want("legacy")) await legacy(browser);
  if (want("hall")) await hall(browser);
} finally {
  await browser.close();
}
process.exit(run.finish());
