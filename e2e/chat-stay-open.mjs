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
// Review round 4: the take-back never re-opens a map the 🗺 button closed (pc-matrix), W held + M is the map (not "mwww"),
// a press that leaves the chat and becomes a joystick drag gets the HUD back at once (phones, step 6), and in a classroom
// the bag is never toggled back and the "too fast" note clears the team-chat line (part classroom: teacher + 2 students).
// Review round 5: a quick look at the map (M, a look, M) no longer leaves the player typing — the W after it walks
// (pc-matrix 5차); the village has no bag, so B is a letter there (a slow ㅠㅠ / "bye" keeps every b); on a phone a press
// that leaves the chat far from every button (the joystick) gets the HUD back at once (step 6), Android's back key that
// folds the keyboard lets go of the field (step 7), and the "too fast" words reach a screen reader (a live region).
//
// Plain Playwright against a dev stack, in the style of the other e2e scripts:
//   server:  PORT=2681 TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json npx tsx src/index.ts   (in server/; the path is from the repo root)
//   client:  VITE_SERVER_URL=http://localhost:2681 npx vite --port 5281 --strictPort (in client/)
//   CV_CLIENT_URL=http://localhost:5281 node e2e/chat-stay-open.mjs
// CV_CHAT_EVIDENCE=<dir> puts the screenshots + assertions there (default: .superpowers/sdd/evidence/task-escape/chat-stay-open).
// CV_CHAT_ONLY=<parts> (comma list of pc, pc-matrix, iphone13, kakao-android, legacy, hall, classroom) runs only those parts.
//
// The IME is driven through CDP (Input.imeSetComposition / Input.insertText): Blink then holds a REAL composition
// (compositionstart/update/end, isComposing on the keydowns), which is what a Hangul IME does to the page.
//
// Exit code 0 only when every check passes and no unexpected console/page error was seen.

import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  CLIENT_URL,
  DESKTOP,
  PAD_A,
  PAD_B,
  createRun,
  entryReady,
  inPlay,
  joinAsStudent,
  joinAsTeacher,
  joinTeam,
  makeTeam,
  openPlayer,
  pos,
  press,
  sleep,
  teacherStart,
  topOverlay,
  turnCameraTo,
  waitIdle,
  walkAndWait,
} from "./lib/escape.mjs";
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
    const lv = document.querySelector(".cv-chat-live");
    return {
      text: n.textContent,
      role: n.getAttribute("role"),
      ariaHidden: n.getAttribute("aria-hidden"),
      live: lv ? { role: lv.getAttribute("role"), text: lv.textContent, inBar: bar.contains(lv) } : null,
      visible: r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && Number(cs.opacity) > 0 && Number(getComputedStyle(bar).opacity) > 0,
      aboveBar: r.bottom <= br.top + 0.5,
      onScreen: r.left >= -0.5 && r.right <= vw + 0.5 && r.top >= -0.5 && r.bottom <= vh + 0.5,
      onTop: !!hit && n.contains(hit),
      box: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  });

/**
 * The "too fast" note, the classroom's team-chat line and the bar (null: not shown): their boxes, how much the note and
 * the line overlap (px²), and their order from the bar up. (The line has pointer-events none, so elementFromPoint cannot
 * tell what covers what: the boxes must simply not meet.)
 */
const stackInfo = (p) =>
  p.page.evaluate(() => {
    const box = (sel) => {
      const e = document.querySelector(sel);
      if (!e || getComputedStyle(e).display === "none") return null;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 ? { l: r.left, r: r.right, t: r.top, b: r.bottom } : null;
    };
    const n = box(".cv-chat-note");
    const l = box(".cv-esc-chatnote");
    const bar = box(".cv-chat-input");
    const overlap = n && l ? Math.max(0, Math.min(n.r, l.r) - Math.max(n.l, l.l)) * Math.max(0, Math.min(n.b, l.b) - Math.max(n.t, l.t)) : null;
    const strip = (b) => b && { x: Math.round(b.l), y: Math.round(b.t), w: Math.round(b.r - b.l), h: Math.round(b.b - b.t), bottom: Math.round(b.b) };
    return {
      note: strip(n),
      line: strip(l),
      bar: strip(bar),
      overlap: overlap === null ? null : Math.round(overlap),
      noteAboveLine: !!n && !!l && n.b <= l.t + 0.5,
      lineAboveBar: !!l && !!bar && l.b <= bar.t + 0.5 && bar.t - l.b <= 12,
      noteAboveBar: !!n && !!bar && n.b <= bar.t + 0.5,
    };
  });

/** The screen reader's live region in the bar (always there, review round 5): its role and words (null: none). */
const liveInfo = (p) =>
  p.page.evaluate(() => {
    const lv = document.querySelector(".cv-chat-live");
    return lv ? { role: lv.getAttribute("role"), live: lv.getAttribute("aria-live"), text: lv.textContent } : null;
  });

/** Whether the Esc menu is open. */
const menuOpen = (p) => p.page.evaluate(async () => (await window.__imp("/src/stores/uiStore.ts")).useUiStore.getState().menuOpen);

/** Screenshot of the bar only (padded), plus the full screen. */
async function shots(p, name) {
  let box = await p.page.locator(BAR).boundingBox();
  // the "too fast" note above the bar belongs in the picture too, and so does a classroom's team-chat line
  for (const sel of [".cv-chat-note", ".cv-esc-chatnote"]) {
    const extra = (await p.page.locator(sel).count()) ? await p.page.locator(sel).first().boundingBox() : null;
    if (!box || !extra || extra.width === 0) continue;
    const x = Math.min(box.x, extra.x);
    const y = Math.min(box.y, extra.y);
    box = { x, y, width: Math.max(box.x + box.width, extra.x + extra.width) - x, height: Math.max(box.y + box.height, extra.y + extra.height) - y };
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
const vp0 = (p) => p.page.viewportSize();

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
    const live0 = await liveInfo(A);
    check("a screen reader's live region (role status) is in the bar before any line is held — empty", live0?.role === "status" && live0.live === "polite" && live0.text === "", live0);
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
    check("…and a note right above the bar says why (on screen, on top, not covering the bar)", n1?.visible && n1.text.includes("너무 빨라요") && n1.aboveBar && n1.onScreen && n1.onTop, n1);
    check("…the same words in the live region that was already there (the note itself is aria-hidden: read once)", n1?.live?.role === "status" && n1.live.inBar && n1.live.text.includes("너무 빨라요") && n1.role === null && n1.ariaHidden === "true", n1);
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
    const live2 = await liveInfo(A);
    check("…and the live region is empty again (still there for the next hold)", live2?.role === "status" && live2.text === "", live2);
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
      // The taps on the scene up high (steps 2, 3) click-move the avatar into the fountain, and it may slide round to its
      // side or its north face; the walks below go in straight lines and stick on the basin (its collider is x, z −6…6).
      // So: stop any click-move, and come round the fountain on the near side first (x ±8: between it and the benches).
      const roundFountain = async () => {
        await P.page.evaluate(async () => (await window.__imp("/src/game/clickMove.ts")).clearClickTarget());
        await sleep(300);
        const h = await pos(P);
        console.log(`   [${label}] to the guide from (${h.x.toFixed(1)}, ${h.z.toFixed(1)})`);
        if (h.z > 6.2) return; // south of the basin (its south face is z 6, the avatar 0.4 m round): a straight walk is clear
        const side = h.x >= 0 ? 8 : -8;
        await walkAndWait(P, side, h.z < -5.5 ? Math.min(h.z, -7) : h.z, 20000, 0.8);
        await walkAndWait(P, side, 12, 20000, 0.8);
      };
      for (let attempt = 0; attempt < 3 && n !== 1; attempt++) {
        await roundFountain();
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

  // Review round 4: a press that left the chat and turned into a DRAG (the joystick walking) kept the HUD in its chat
  // layout until the thumb lifted (up to 5 s). Review round 5: at a normal walking pace (the thumb 8–50 px out) it still
  // did. Only a press that went down NEAR a control that comes back (within 48 px of where 💬 / emoji / action / jump sit)
  // can have its click land on one — the HUD keeps its chat layout for such a tap only. The stick (the other half) and the
  // view up high get the HUD back at once, while the finger is still down.
  await run.step(`${label} 6. 채팅 중 조이스틱·먼 곳 누름으로 나옴 — 버튼이 바로 돌아오고 다른 손가락으로 점프, 버튼 근처 탭만 그 탭 동안 유지`, async () => {
    // an open spot facing north (the fountain is a few metres ahead): the stick walk below has room
    await walkAndWait(P, 0, 16.8, 20000, 0.5);
    await turnCameraTo(P, 0, 0);
    await sleep(600);
    const cdpD = await P.page.context().newCDPSession(P.page);
    const touch = (type, touchPoints) => cdpD.send("Input.dispatchTouchEvent", { type, touchPoints });
    const vp = P.page.viewportSize();
    const hud = () =>
      P.page.evaluate(() => {
        const j = document.querySelector(".cv-jump-btn");
        const r = j ? j.getBoundingClientRect() : null;
        return {
          focusClass: document.documentElement.classList.contains("cv-chat-focus"),
          chatBtn: document.querySelectorAll(".cv-chat-btn").length,
          jump: r && getComputedStyle(j).display !== "none" && r.width > 0 ? { x: r.x + r.width / 2, y: r.y + r.height / 2 } : null,
        };
      });
    const emojiBox = await P.page.evaluate(() => {
      const e = document.querySelector(".cv-emoji-toggle");
      const r = e ? e.getBoundingClientRect() : null;
      return r && r.width > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
    });
    await press(P, P.page.locator(".cv-chat-btn"));
    const s0 = await until(() => state(P), (s) => s.focused, 2000);
    check("a tap on 💬 opens the chat (the keyboard down: the stick zone is free, as on a tablet with a keyboard)", s0.focused && s0.focusClass, s0);
    await sleep(300);
    await P.page.evaluate(() => window.__tapProbe?.reset());
    const p0 = await pos(P);
    const sx = Math.round(vp.width * 0.25);
    const sy = Math.round(vp.height * 0.72);
    await touch("touchStart", [{ x: sx, y: sy, id: 1 }]);
    await sleep(80);
    const hDown = await hud();
    const sDown = await state(P);
    // a normal walking pace: the thumb 10 – 30 px out (force 0.2 – 0.55 of the 56 px stick)
    for (let d = 10; d <= 30; d += 10) {
      await touch("touchMove", [{ x: sx, y: sy - d, id: 1 }]);
      await sleep(30);
    }
    await sleep(150);
    const hWalk = await hud();
    check("the thumb on the stick (far from every button): the chat is left and the HUD is back at once — the thumb down, not moved yet (💬, jump)", !sDown.focused && !hDown.focusClass && hDown.chatBtn === 1 && !!hDown.jump, { hDown, sDown });
    check("…walking at a normal pace (the thumb 30 px out): the HUD stays back", !hWalk.focusClass && hWalk.chatBtn === 1 && !!hWalk.jump, hWalk);
    // the other thumb on jump, while still walking
    if (hWalk.jump) {
      const jx = Math.round(hWalk.jump.x);
      const jy = Math.round(hWalk.jump.y);
      await touch("touchStart", [{ x: sx, y: sy - 30, id: 1 }, { x: jx, y: jy, id: 2 }]);
      await sleep(80);
      await touch("touchEnd", [{ x: sx, y: sy - 30, id: 1 }]);
    }
    await sleep(600);
    await touch("touchEnd", []);
    await sleep(700);
    const p1 = await pos(P);
    const pr = await P.page.evaluate(() => window.__tapProbe?.read());
    const s1 = await state(P);
    check(
      "…the other thumb's tap on jump jumps while the stick walks; the avatar walked; the chat stays shut (no focus again), no 조교 dialogue, no emoji fan",
      !!pr && pr.jumped && dist(p0, p1) > 0.3 && !s1.focused && pr.focusins === 0 && !pr.npc && !pr.fan,
      { probe: pr, moved: Math.round(dist(p0, p1) * 100) / 100, ...s1 },
    );
    await shots(P, `${label}-drag-left`);

    // a tap far from every control (the look half, up high), finger down 0.3 s: back while the finger is still down, and
    // its click lands on the view (no button)
    await press(P, P.page.locator(".cv-chat-btn"));
    await until(() => state(P), (s) => s.focused, 2000);
    await sleep(300);
    await P.page.evaluate(() => window.__tapProbe?.reset());
    const fx = Math.round(vp.width * 0.72);
    const fy = Math.round(vp.height * 0.33);
    await touch("touchStart", [{ x: fx, y: fy, id: 1 }]);
    await sleep(150);
    const hFar = await hud();
    await sleep(150);
    await touch("touchEnd", []);
    await sleep(800);
    const prFar = await P.page.evaluate(() => window.__tapProbe?.read());
    const sFar = await state(P);
    check(
      "a tap up high, far from every button, finger down 0.3 s: the HUD is back while the finger is down; nothing fired (no HUD click, no jump, no focus again)",
      !hFar.focusClass && hFar.chatBtn === 1 && !sFar.focused && !!prFar && prFar.hudClicks.length === 0 && !prFar.jumped && prFar.focusins === 0 && !prFar.npc && !prFar.fan,
      { hFar, probe: prFar, ...sFar },
    );

    // a tap NEAR a control (24 px above the emoji button) that wobbles 12 px, finger down 0.3 s: its click may still come
    // there, so the chat layout holds while it is down — and the HUD is back after it, nothing fired
    if (emojiBox) {
      await press(P, P.page.locator(".cv-chat-btn"));
      await until(() => state(P), (s) => s.focused, 2000);
      await sleep(300);
      await P.page.evaluate(() => window.__tapProbe?.reset());
      const wx = Math.round(emojiBox.x + emojiBox.w / 2);
      const wy = Math.round(emojiBox.y - 24);
      await touch("touchStart", [{ x: wx, y: wy, id: 1 }]);
      await sleep(100);
      await touch("touchMove", [{ x: wx - 7, y: wy + 9, id: 1 }]);
      await sleep(200);
      const hHold = await hud();
      await touch("touchEnd", []);
      await sleep(900);
      const hAfter = await hud();
      const prNear = await P.page.evaluate(() => window.__tapProbe?.read());
      const s2 = await state(P);
      check(
        "a tap 24 px above the emoji button that wobbles 12 px, finger down 0.3 s: the chat layout holds while it is down, the HUD is back after it, nothing fired",
        hHold.focusClass && hHold.chatBtn === 0 && !hAfter.focusClass && hAfter.chatBtn === 1 && !s2.focused && !!prNear && prNear.hudClicks.length === 0 && prNear.focusins === 0 && !prNear.fan,
        { at: { x: wx, y: wy }, hHold, hAfter, probe: prNear, ...s2 },
      );
    } else check("the emoji button is there before chatting (so a spot near it can be tapped)", false, { emojiBox });
    await cdpD.detach().catch(() => {});
    await sleep(500);
  });

  // Review round 5 (Android): the back key (or the keyboard's own fold key) hides the soft keyboard WITHOUT a blur; the
  // field kept the caret and the HUD stayed in its chat layout (jump / action / emoji hidden, no 💬) until a tap — after
  // every line, now that Enter keeps the caret. The soft keyboard is mocked as in step 4 (visualViewport 300 px shorter).
  await run.step(`${label} 7. 키보드만 내리면(안드로이드 뒤로 키) 채팅에서 나오고 HUD가 돌아옴 — 키보드 바꾸기·하드웨어 키보드는 그대로`, async () => {
    const kbdTo = (px) =>
      P.page.evaluate((px) => {
        const proto = Object.getPrototypeOf(window.visualViewport);
        window.__vvOrig = window.__vvOrig ?? Object.getOwnPropertyDescriptor(proto, "height");
        Object.defineProperty(proto, "height", { configurable: true, get: () => window.innerHeight - px });
        window.visualViewport.dispatchEvent(new Event("resize"));
      }, px);
    const kbdDown = () =>
      P.page.evaluate(() => {
        if (!window.__vvOrig) return;
        Object.defineProperty(Object.getPrototypeOf(window.visualViewport), "height", window.__vvOrig);
        window.visualViewport.dispatchEvent(new Event("resize"));
      });
    const hudBack = () =>
      P.page.evaluate(() => {
        const j = document.querySelector(".cv-jump-btn");
        return {
          focusClass: document.documentElement.classList.contains("cv-chat-focus"),
          chatBtn: document.querySelectorAll(".cv-chat-btn").length,
          jump: !!j && getComputedStyle(j).display !== "none",
        };
      });
    await sleep(5800); // the chat window: start fresh
    await press(P, P.page.locator(".cv-chat-btn"));
    await until(() => state(P), (s) => s.focused, 2000);
    await kbdTo(300);
    await sleep(300);
    await P.page.keyboard.type("뒤로 키", { delay: 25 });
    await P.page.keyboard.press("Enter");
    const sent = await sentOnce(P, "뒤로 키");
    const s0 = await state(P);
    check('"뒤로 키" sent once, the caret (and the keyboard) stays', sent === 1 && s0.focused && s0.value === "", { sent, ...s0 });
    // another keyboard / the emoji pad: its height changes, it is still up — the chat stays
    await kbdTo(340);
    await sleep(500);
    await kbdTo(260);
    await sleep(500);
    const s1 = await state(P);
    check("the keyboard changing height (300 → 340 → 260 px): still chatting", s1.focused && s1.focusClass, s1);
    // the back key: the keyboard folds, no blur from the browser
    const tDown = Date.now();
    await kbdDown();
    const s2 = await until(() => state(P), (s) => !s.focused, 1500, 20);
    const foldMs = Date.now() - tDown;
    const h2 = await hudBack();
    check("the keyboard folded away (the back key): the field lets go within 0.6 s — bar folded, keys free", !s2.focused && s2.collapsed && !s2.captured && foldMs <= 600, { ...s2, foldMs });
    check("…and the HUD is back (💬, jump; no chat layout)", !h2.focusClass && h2.chatBtn === 1 && h2.jump, h2);
    await shots(P, `${label}-kbd-folded`);
    // never up (a hardware keyboard, a floating keyboard): the field keeps the caret
    await press(P, P.page.locator(".cv-chat-btn"));
    await until(() => state(P), (s) => s.focused, 2000);
    await kbdTo(40);
    await sleep(300);
    await kbdDown();
    await sleep(800);
    const s3 = await state(P);
    check("with no soft keyboard (only a 40 px strip, then none): the chat stays open", s3.focused && s3.focusClass, s3);
    await P.page.touchscreen.tap(Math.round(vp0(P).width * 0.72), Math.round(vp0(P).height * 0.33));
    await until(() => state(P), (s) => !s.focused, 1500);
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
  // The keys' own timeStamps in the page (what hotkeys.ts measures the gaps with since review round 4). A typist's rhythm
  // does not wait for the page; the harness's does (each key waits for the page to take the last), so a case whose keys
  // did not come at its pace is played again (logged) instead of being counted as that pace.
  await A.page.evaluate(() => {
    window.__keyTs = [];
    addEventListener("keydown", (e) => {
      if (!e.repeat) window.__keyTs.push(e.timeStamp);
    }, true);
  });
  const keyGaps = () =>
    A.page.evaluate(() => {
      const t = window.__keyTs;
      window.__keyTs = [];
      let max = 0;
      for (let i = 1; i < t.length; i++) max = Math.max(max, t[i] - t[i - 1]);
      return { keys: t.length, maxGap: Math.round(max) };
    });
  /** Plain latin keys on the wall clock: key i goes down at i × `gap` ms (as a typist's rhythm), each held `hold` ms. */
  const plain = async (keys, gap, hold = 50) => {
    const t0 = Date.now();
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i] === " " ? "Space" : keys[i];
      const wait = t0 + i * gap - Date.now();
      if (wait > 0) await sleep(wait);
      await A.page.keyboard.down(k);
      await sleep(hold);
      await A.page.keyboard.up(k);
    }
  };
  /** Off pace: a gap in the page more than this past the nominal one (the take-back is 300 ms past the slowest pace). */
  const PACE_SLACK_MS = 250;
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
    // review round 5: the village has no bag — B is a letter there, at any pace
    ["ㅠㅠ", [..."bb"], "bb"],
    ["bye", [..."bye"], "bye"],
  ];
  const summary = [];
  for (const gap of [300, 600, 900, 1200]) {
    await run.step(`PC-M ${gap} ms/키 — 그래 · 음 · 즈 · ㅡㅡ · 안녕하세요 · 그래 알겠어 · ㅠㅠ · bye (채팅창 클릭 없이)`, async () => {
      for (const [label, keys, want] of LINES) {
        let s, m, w, kg;
        for (let attempt = 1; ; attempt++) {
          await A.page.evaluate(() => (window.__keyTs = []));
          await watchMap();
          await plain(keys, gap);
          kg = await keyGaps();
          await sleep(TAKE_BACK_MS + 300); // every hold and take-back is over: a map that stayed would show now
          s = await until(() => state(A), (v) => v.value === want, 1500);
          m = await mode();
          w = await mapWatched();
          if (kg.maxGap <= gap + PACE_SLACK_MS || attempt === 3) break;
          console.log(`   [retry] ${gap} ms/key "${label}": the page got a key ${kg.maxGap} ms after the last (off pace) — played again`);
          await leave();
        }
        check(`…${gap} ms/key "${label}": the keys came at the pace (page timeStamps: largest gap ≤ ${gap + PACE_SLACK_MS} ms)`, kg.maxGap <= gap + PACE_SLACK_MS, kg);
        summary.push({ gap, label, value: s.value, mapEnd: m, ...w, maxKeyGap: kg.maxGap });
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

  // Review round 4.
  //  - (major) the take-back toggled the map once more without looking at it: M, the map, the 🗺 button closed it, "hi"
  //    typed at once without clicking the bar — the map opened AGAIN under the chat ("mhi").
  //  - W held to walk, M 200 ms into the walk: the old 250 ms roll-over read it as "즈" — the chat opened with "m" and
  //    the W's auto-repeat typed "wwww" into it while the avatar stopped. Now the W's keyup tells (a held W is no letter).
  //  - "그" with ㄱ held 350 ms (ㅡ 200 ms into it): a slower roll-over than the old window — the chat.
  await run.step("PC-M 4차 — 🗺로 닫은 지도는 다시 안 열림, W 누른 채 M은 지도(채팅에 wwww 없음), ㄱ 350 ms 겹침은 채팅", async () => {
    await sleep(LOOK_MS);
    const tM = Date.now();
    await A.page.keyboard.down("m");
    await sleep(50);
    await A.page.keyboard.up("m");
    const ov1 = await until(mode, (m) => m === "ov", 1500, 20);
    await A.page.getByRole("button", { name: "지도 보기" }).click();
    const tp1 = await until(mode, (m) => m !== "ov", 1500, 20);
    await watchMap();
    const sinceM = Date.now() - tM;
    await A.page.keyboard.press("h");
    await sleep(250);
    await A.page.keyboard.press("i");
    await sleep(TAKE_BACK_MS + 300);
    const s1 = await until(() => state(A), (v) => v.value === "hi", 1000);
    const m1 = await mode();
    const w1 = await mapWatched();
    check(
      'M → the map → the 🗺 button closes it → "hi" typed at once (within the take-back, no click on the bar): "hi" in the chat, the map never opens again',
      ov1 === "ov" && tp1 !== "ov" && sinceM < TAKE_BACK_MS && s1.focused && s1.value === "hi" && m1 !== "ov" && !w1.seen,
      { ...s1, mode: m1, watch: w1, typedAfterMs: sinceM },
    );
    await shots(A, "pc-r4-mapbutton-then-type");
    await leave();

    // W held, M 200 ms into the walk, the W's auto-repeat (Playwright sends repeat: true for a key already down)
    await walkAndWait(A, 0, 16.8, 20000, 0.5);
    await turnCameraTo(A, 0, 0);
    await sleep(LOOK_MS);
    const p0 = await pos(A);
    await watchMap();
    await A.page.keyboard.down("w");
    await sleep(200);
    await A.page.keyboard.down("m");
    await sleep(50);
    await A.page.keyboard.up("m");
    await sleep(250);
    for (let i = 0; i < 30; i++) {
      await A.page.keyboard.down("w");
      await sleep(33);
    }
    await A.page.keyboard.up("w");
    await sleep(200);
    const s2 = await state(A);
    const m2 = await mode();
    const w2 = await mapWatched();
    const p1 = await pos(A);
    check(
      "W held, M 200 ms into the walk, W's auto-repeat on: the map opens, the chat stays shut (nothing typed), the avatar walks on",
      m2 === "ov" && !s2.focused && s2.value === "" && dist(p0, p1) > 0.5,
      { ...s2, mode: m2, watch: w2, moved: Math.round(dist(p0, p1) * 100) / 100 },
    );
    await shots(A, "pc-r4-heldw-m200");
    await sleep(LOOK_MS);
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(LOOK_MS);

    // "그" with ㄱ (R) still down when ㅡ (M) goes down 300 ms in — past the old 250 ms roll-over — and ㄱ up right after.
    // The page's own timestamps say how long ㄱ really was down: past a typed press (0.4 s) it is a held key by design
    // (the map), so a run the harness stretched that far is played again rather than counted.
    let s3;
    let w3;
    let roll;
    for (let attempt = 1; ; attempt++) {
      await A.page.evaluate(() => {
        window.__roll = {};
        window.__rollOff?.();
        const on = (e) => {
          if ((e.code === "KeyR" || e.code === "KeyM") && !e.repeat) window.__roll[e.code + "-" + e.type] = e.timeStamp;
        };
        addEventListener("keydown", on, true);
        addEventListener("keyup", on, true);
        window.__rollOff = () => {
          removeEventListener("keydown", on, true);
          removeEventListener("keyup", on, true);
        };
      });
      await watchMap();
      await A.page.keyboard.down("r");
      await sleep(300);
      await A.page.keyboard.down("m");
      await A.page.keyboard.up("r");
      await sleep(40);
      await A.page.keyboard.up("m");
      await sleep(TAKE_BACK_MS);
      s3 = await until(() => state(A), (v) => v.value === "m", 1500);
      w3 = await mapWatched();
      roll = await A.page.evaluate(() => {
        const t = window.__roll;
        window.__rollOff?.();
        return { mAfterR: Math.round(t["KeyM-keydown"] - t["KeyR-keydown"]), rDown: Math.round(t["KeyR-keyup"] - t["KeyR-keydown"]) };
      });
      if (roll.rDown <= 390 || attempt === 3) break;
      console.log(`   [retry] "그" roll-over: ㄱ was down ${roll.rDown} ms in the page (longer than a typed press) — played again`);
      await leave();
    }
    check(
      '"그" with ㄱ (R) still down when ㅡ (M) went down ~300 ms in (past the old 250 ms window), ㄱ up right after: "m" in the chat, the map never opened',
      roll.mAfterR > 250 && roll.rDown <= 400 && s3.focused && s3.value === "m" && !w3.seen,
      { ...s3, watch: w3, page: roll },
    );
    await leave();
    const sys = await systemLines(A);
    check("no rate-limit notice (round 4 step)", sys.length === 0, sys);
  });

  // Review round 5.
  //  - (major) a quick look at the map — M, look 0.8 s (or 1.3 s), M — read as a slow ㅡㅡ: the map closed, but the chat
  //    opened with "mm" and the W after it typed "mmw" while the avatar stood still. That chat is a guess now: a walk key
  //    (in 한글 mode too, where W reaches the field as Process / 229), Escape or a click on the view puts the field back
  //    and leaves; the walk key walks. Typing on (Space, Enter) keeps the line as it was.
  //  - (major) the village has no bag: a slow "ㅠㅠ" (0.9 / 1.2 s a key) was lost and Enter sent nothing; "bye" lost its b.
  await run.step("PC-M 5차 — 지도 잠깐 보기(M · 0.8/1.3초 · M) 뒤 W는 걷기·Esc·클릭은 깨끗이, 계속 치면 그대로, 마을의 느린 ㅠㅠ·bye", async () => {
    const cdp = await A.page.context().newCDPSession(A.page);
    await walkAndWait(A, 0, 16.8, 20000, 0.5);
    await turnCameraTo(A, 0, 0);
    await sleep(LOOK_MS);
    /** M, the map opens, a look of `look` ms from the first press, M again: what the chat holds right after. */
    const peek = async (look) => {
      const t0 = Date.now();
      await A.page.keyboard.down("m");
      await sleep(50);
      await A.page.keyboard.up("m");
      const ov = await until(mode, (m) => m === "ov", 1500, 20);
      const wait = t0 + look - Date.now();
      if (wait > 0) await sleep(wait);
      await A.page.keyboard.down("m");
      await sleep(50);
      await A.page.keyboard.up("m");
      const closed = await until(mode, (m) => m !== "ov", 1500, 20);
      const s = await until(() => state(A), (v) => v.focused && v.value.endsWith("mm"), 800, 20);
      return { opened: ov === "ov", closed: closed !== "ov", s, secondMAfter: Date.now() - t0 };
    };
    /** Hold a walk key `ms` ms — `ime`: as the Korean IME hands it to a focused field (key Process, keyCode 229). */
    const walkKey = async (code, ms, ime = false) => {
      if (ime) {
        await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code, windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
        await sleep(ms);
        const vk = { KeyW: 87, KeyS: 83 }[code];
        await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: code.slice(3).toLowerCase(), code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
      } else {
        await A.page.keyboard.down(code);
        await sleep(ms);
        await A.page.keyboard.up(code);
      }
    };
    for (const [look, code, ime, name] of [
      [800, "KeyW", false, "W"],
      [1300, "KeyS", false, "S"],
      [800, "KeyW", true, "한글 mode W (Process / 229)"],
    ]) {
      await watchMap();
      const p0 = await pos(A);
      const pk = await peek(look);
      await walkKey(code, 700, ime);
      await sleep(300);
      const p1 = await pos(A);
      const s1 = await state(A);
      const m1 = await mode();
      const w1 = await mapWatched();
      check(
        `M, a look of ${look} ms, M: the map closes; the chat that opens holds the guess "mm" (a slow ㅡㅡ would be in it)`,
        pk.opened && pk.closed && pk.s.focused && pk.s.value === "mm",
        pk,
      );
      check(
        `…then ${name} held 0.7 s: the guess is undone (chat left, field empty, nothing typed), the avatar walks, the map stays closed`,
        !s1.focused && !s1.captured && s1.value === "" && dist(p0, p1) > 0.3 && m1 !== "ov" && w1.longest <= TAKE_BACK_MS,
        { ...s1, mode: m1, watch: w1, moved: Math.round(dist(p0, p1) * 100) / 100 },
      );
      if (name === "W") await shots(A, "pc-r5-peek-then-w");
      await sleep(LOOK_MS);
    }
    // Escape, and a click on the view: the guess goes the same way — no menu, no "mm" left behind in the field
    {
      const pk = await peek(800);
      await A.page.keyboard.press("Escape");
      await sleep(300);
      const s1 = await state(A);
      const menu = await menuOpen(A);
      check("M, 0.8 s, M, then Escape: the chat is left with the field empty, and the menu does NOT open", pk.s.value === "mm" && !s1.focused && s1.value === "" && !menu, { peek: pk, ...s1, menu });
      if (menu) await A.page.keyboard.press("Escape");
      await sleep(LOOK_MS);
      const pk2 = await peek(800);
      const vp = A.page.viewportSize();
      await A.page.mouse.click(Math.round(vp.width / 2), Math.round(vp.height * 0.3));
      await sleep(300);
      const s2 = await state(A);
      check("M, 0.8 s, M, then a click on the 3D view: the chat is left with the field empty", pk2.s.value === "mm" && !s2.focused && s2.value === "", { peek: pk2, ...s2 });
      await sleep(LOOK_MS);
    }
    // an unsent line already in the field (left with Escape): the guess goes, the line stays
    {
      // From a standing avatar, like the cases above. The click on the view just before also click-moved the avatar
      // toward the point it hit (~20 m off, by design): that walk pauses while the chat has the keyboard and goes on
      // after the Escape and under the map, and S then walked back over it — p0 → p1 read 0.04–0.29 m although S walked
      // its full 1.2 m (traced 2026-11-10: 1.64 m forward under the peek, 1.20 m back on S). Walking to the start ends it.
      await walkAndWait(A, 0, 16.8, 20000, 0.5);
      await turnCameraTo(A, 0, 0);
      await A.page.keyboard.press("Enter");
      await until(() => state(A), (v) => v.focused);
      await A.page.locator(FIELD).fill("안녕");
      await A.page.keyboard.press("Escape");
      await until(() => state(A), (v) => !v.focused);
      await sleep(LOOK_MS);
      const p0 = await pos(A);
      const pk = await peek(800);
      const pS = await pos(A);
      await walkKey("KeyS", 600);
      await sleep(300);
      const p1 = await pos(A);
      const s1 = await state(A);
      const r2 = (n) => Math.round(n * 100) / 100;
      // still through the peek (nothing else walks it), then S's own walk
      check(
        'an unsent "안녕" in the field, M, 0.8 s, M ("안녕mm"), then S: back to "안녕", the chat left, the avatar walks',
        pk.s.value === "안녕mm" && !s1.focused && s1.value === "안녕" && dist(p0, pS) < 0.05 && dist(pS, p1) > 0.3,
        { peek: pk, ...s1, stillBefore: r2(dist(p0, pS)), moved: r2(dist(pS, p1)) },
      );
      await A.page.locator(FIELD).fill("");
      await sleep(LOOK_MS);
    }
    // a slow ㅡㅡ that goes on (Space, then W) is a line: W types into it; and a slow ㅡㅡ then Enter sends "mm" once
    {
      await watchMap();
      await plain([..."mm "], 1200);
      await sleep(200);
      const p0 = await pos(A);
      await A.page.keyboard.press("KeyW");
      await sleep(300);
      const p1 = await pos(A);
      const s1 = await until(() => state(A), (v) => v.value === "mm w", 1000);
      const w1 = await mapWatched();
      check('a slow ㅡㅡ (1.2 s a key), a space, then W: "mm w" — the line goes on, W types (no walk), the map closed', s1.focused && s1.value === "mm w" && dist(p0, p1) < 0.05 && (await mode()) !== "ov" && w1.longest <= TAKE_BACK_MS, { ...s1, watch: w1 });
      await leave();
      await sleep(5000); // the chat window: start fresh
      await plain([..."mm"], 1200);
      await sleep(300);
      await A.page.keyboard.press("Enter");
      const sent = await sentOnce(A, "mm");
      const s2 = await state(A);
      check('a slow ㅡㅡ (1.2 s a key) then Enter: "mm" sent once, the caret stays', sent === 1 && s2.focused && s2.value === "", { sent, ...s2 });
      await A.page.keyboard.press("Escape");
      await until(() => state(A), (v) => !v.focused);
      await sleep(LOOK_MS);
    }
    // the village has no bag: B is a letter — a slow ㅠㅠ is in the chat and Enter sends it; "bye" keeps its b
    for (const gap of [900, 1200]) {
      await sleep(5000); // the chat window: start fresh
      await watchMap();
      await plain([..."bb"], gap);
      await sleep(400);
      const s1 = await until(() => state(A), (v) => v.value === "bb", 1500);
      if (gap === 1200) await shots(A, "pc-r5-slow-bb");
      const before = count(await myLines(A), "bb"); // the 900 ms round sent one already
      await A.page.keyboard.press("Enter");
      const sent = (await sentOnce(A, "bb")) - before;
      const w1 = await mapWatched();
      check(`village: "ㅠㅠ" at ${gap} ms a key (b b, no click) is in the chat ("bb"), and Enter sends it once`, s1.focused && s1.value === "bb" && sent === 1 && !w1.seen, { ...s1, sent, watch: w1 });
      await A.page.keyboard.press("Escape");
      await until(() => state(A), (v) => !v.focused);
      await sleep(700);
    }
    await plain([..."bye"], 900);
    await sleep(300);
    const sBye = await until(() => state(A), (v) => v.value === "bye", 1500);
    check('village: "bye" at 900 ms a key: "bye" in the chat (the b is not lost to a bag that is not there)', sBye.focused && sBye.value === "bye", sBye);
    await leave();
    // the declared cost (review round 5, minor — kept): a short W step and M 0.7 s later reads as "즈" (W M), as a slow
    // typist's 즈 at 1.2 s a key must — the chat opens with "m" instead of the map. Recorded, not counted.
    {
      await sleep(LOOK_MS);
      await A.page.keyboard.down("KeyW");
      await sleep(250);
      await A.page.keyboard.up("KeyW");
      await sleep(700);
      await A.page.keyboard.press("KeyM");
      await sleep(TAKE_BACK_MS);
      const s1 = await state(A);
      run.check("[cost, documented — not counted] a 250 ms W step, then M 0.7 s later: read as 즈 (the chat \"m\"), not the map", true, { ...s1, mode: await mode() });
      await leave();
    }
    await cdp.detach().catch(() => {});
    const sys = await systemLines(A);
    check("no rate-limit notice (round 5 step)", sys.length === 0, sys);
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
    // review round 5: no bag in the legacy world either — B (ㅠ) is a letter, at once
    await sleep(1700);
    await L.page.keyboard.down("b");
    await sleep(50);
    await L.page.keyboard.up("b");
    const s3 = await until(() => state(L), (s) => s.value === "b", 1200);
    check('legacy: a lone B (no bag here) opens the chat with "b" at once', s3.focused && s3.value === "b", s3);
    await L.page.locator(FIELD).fill("");
    await L.page.keyboard.press("Escape");
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

// ─────────────────────────────────────────── AI 학교 탈출: a classroom ───────────────────────────────────────────
// Review round 4: (major) the take-back reached the bag (B acts after 0.6 s, the take-back was 1.5 s): the tray opened by
// 🎒, B closed it, E right after toggled it OPEN again by key (the keyboard, the first chip) and opened the chat with "b".
// (minor) the "too fast" note above the bar sat right under the team-chat line ("팀 채팅 · 선생님이 볼 수 있어요"), which
// covered most of it; on a phone the line also floated over the folded bar during the tap that left the chat.
// A teacher, a PC student and a phone student (iPhone 13) — one team of two, in the counselling room.
// Needs the server started with TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json (as the hall).

async function classroom(browser) {
  const T = await openPlayer(browser, run, { tag: "room-teacher", device: DESKTOP });
  const A = await openPlayer(browser, run, { tag: "room-pc", device: DESKTOP });
  const B = await openPlayer(browser, run, { tag: "room-phone", device: IPHONE_13 });
  const r3 = () => Math.floor(Math.random() * 900 + 100);
  await run.step("교실 1. 선생님 · PC 학생 · 폰 학생 — 한 팀으로 교실 입장", async () => {
    T.nick = `쌤${r3()}`;
    const code = await joinAsTeacher(T, T.nick);
    check("the class is open", !!code, { code });
    B.nick = `폰${r3()}`;
    await joinAsStudent(B, B.nick, code);
    const team = await makeTeam(B);
    A.nick = `피씨${r3()}`;
    await joinAsStudent(A, A.nick, code);
    await joinTeam(A, team);
    await teacherStart(T);
    await B.page.waitForFunction(() => /복도 문이 열렸어요/.test(document.querySelector(".cv-hub-phase")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
    await walkAndWait(B, PAD_A[0], PAD_A[1], 40000, 1.0);
    await walkAndWait(A, PAD_B[0], PAD_B[1], 40000, 1.0);
    await B.page.waitForFunction(() => document.querySelector(".cv-action-btn .cv-action-text")?.textContent === "입장", null, { timeout: 10000 }).catch(() => {});
    await B.page.locator(".cv-action-btn").tap();
    const both = await Promise.all([A, B].map((p) => p.page.waitForFunction(() => window.__cv?.getScreen?.() === "escape", null, { timeout: 10000 }).then(() => true, () => false)));
    check("both students are in the classroom", both.every(Boolean), both);
    await Promise.all([inPlay(A), inPlay(B)]);
    await sleep(1500);
    check("the team-chat line is up on the PC", (await stackInfo(A)).line !== null, await stackInfo(A));
  });

  await run.step("교실 2. PC — 빠른 네 번째 줄: 안내가 '팀 채팅' 줄 위에, 서로 안 겹침", async () => {
    await sleep(5800); // a fresh chat window
    await A.page.keyboard.press("Enter");
    await until(() => state(A), (s) => s.focused);
    for (const line of ["교실1", "교실2", "교실3", "교실4"]) {
      await A.page.keyboard.type(line, { delay: 15 });
      await A.page.keyboard.press("Enter");
      await sleep(120);
    }
    await sleep(400);
    const s1 = await state(A);
    const g = await stackInfo(A);
    const n = await noteInfo(A);
    check("PC classroom: the 4th quick line stays in the field, and the note says why", s1.focused && s1.value === "교실4" && !!n && n.text.includes("너무 빨라요") && n.onTop, { ...s1, note: n });
    check("…the note sits above the team-chat line, which sits right above the bar — the two do not overlap at all", g.overlap === 0 && g.noteAboveLine && g.lineAboveBar, g);
    await shots(A, "room-pc-held");
    await until(() => noteInfo(A), (x) => x === null, 7000, 100);
    await A.page.keyboard.press("Enter");
    check('"교실4" then goes, once', (await sentOnce(A, "교실4")) === 1, await myLines(A));
    await A.page.keyboard.press("Escape"); // the empty field: out of the chat
    await until(() => state(A), (s) => !s.focused);
  });

  await run.step("교실 3. PC — 🎒로 연 가방을 B로 닫고 곧바로 E: 가방이 다시 열리지 않고 채팅도 안 열림", async () => {
    await sleep(TAKE_BACK_MS + 200);
    const tray = () => A.page.locator(".cv-esc-bag-tray").count();
    await A.page.locator(".cv-esc-bag-btn").click();
    const open1 = await until(tray, (n) => n === 1, 2000);
    const capOpen = (await state(A)).captured;
    const tB = Date.now();
    await A.page.keyboard.press("b");
    const closed = await until(tray, (n) => n === 0, 2000, 20);
    await sleep(300);
    const sinceB = Date.now() - tB;
    await A.page.keyboard.press("e");
    await sleep(TAKE_BACK_MS + 300);
    const after = await tray();
    const s = await state(A);
    const top = await topOverlay(A);
    check(
      "classroom: the tray opened by 🎒 (no keyboard capture), B closes it after its wait, E within the take-back: the tray stays closed, no chat, nothing typed",
      open1 === 1 && !capOpen && closed === 0 && sinceB < TAKE_BACK_MS && after === 0 && !s.focused && s.value === "" && top !== "bag",
      { open1, capOpen, closed, eAfterMs: sinceB, trayAfter: after, overlay: top, ...s },
    );
    await shots(A, "room-pc-bag-b-then-e");
    if (top) await A.page.keyboard.press("Escape"); // E may have opened a close-up next to the door
    await sleep(500);
  });

  await run.step("교실 4. 폰 — '팀 채팅' 줄은 열린 바 바로 위, 빠른 네 번째 줄 안내와 안 겹침, 나오는 탭 동안 접힌 바 위에 떠 있지 않음", async () => {
    await sleep(5800);
    const emojiNear = await B.page.evaluate(() => {
      const e = document.querySelector(".cv-emoji-toggle");
      const r = e ? e.getBoundingClientRect() : null;
      return r && r.width > 0 ? { x: Math.round(r.x + r.width / 2), y: Math.round(r.y - 24) } : null;
    });
    check("phone classroom: the emoji button is there before chatting (a spot near it is where the leave tap goes)", !!emojiNear, { emojiNear });
    await press(B, B.page.locator(".cv-chat-btn"));
    await until(() => state(B), (s) => s.focused, 2000);
    await sleep(300);
    const g0 = await stackInfo(B);
    check("phone classroom: the team-chat line shows with the open bar, right above it", !!g0.line && g0.lineAboveBar, g0);
    for (const line of ["폰교실1", "폰교실2", "폰교실3", "폰교실4"]) {
      await B.page.keyboard.type(line, { delay: 15 });
      await press(B, B.page.locator(SEND));
      await sleep(150);
    }
    await sleep(400);
    const s1 = await state(B);
    const g = await stackInfo(B);
    const n = await noteInfo(B);
    check("phone classroom: the 4th line stays (focused), the note says why on screen", s1.focused && s1.value === "폰교실4" && !!n && n.visible && n.onScreen && n.onTop, { ...s1, note: n });
    check("…the note sits above the team-chat line, which sits right above the bar — no overlap", g.overlap === 0 && g.noteAboveLine && g.lineAboveBar, g);
    await shots(B, "room-phone-held");
    await until(() => noteInfo(B), (x) => x === null, 7000, 100);
    await press(B, B.page.locator(SEND));
    check('"폰교실4" then goes, once', (await sentOnce(B, "폰교실4")) === 1, await myLines(B));
    // the tap that leaves, finger down 0.3 s, near a control (24 px above where the emoji button comes back — a tap
    // there may click it, review round 5): the HUD holds its chat layout meanwhile, but the line goes with the bar
    const cdpR = await B.page.context().newCDPSession(B.page);
    const near = emojiNear ?? { x: Math.round(B.page.viewportSize().width * 0.72), y: Math.round(B.page.viewportSize().height * 0.33) };
    await cdpR.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [near] });
    await sleep(200);
    const mid = await B.page.evaluate(() => ({
      focusClass: document.documentElement.classList.contains("cv-chat-focus"),
      openClass: document.documentElement.classList.contains("cv-chat-open"),
      line: getComputedStyle(document.querySelector(".cv-esc-chatnote")).display,
      collapsed: !!document.querySelector(".cv-chat-input.is-collapsed"),
    }));
    await B.page.screenshot({ path: join(run.evidence, "room-phone-leave-held-full.png") }).catch(() => {});
    await cdpR.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await sleep(900);
    const s2 = await state(B);
    check("phone classroom: during the tap that leaves near a button (finger still down) the HUD keeps its chat layout, but the bar is folded and the team-chat line went with it", mid.focusClass && !mid.openClass && mid.collapsed && mid.line === "none", { ...mid, at: near });
    check("…and after the tap the chat is left", !s2.focused && s2.collapsed && !s2.focusClass, s2);
    await cdpR.detach().catch(() => {});
  });
  await B.ctx.close();
  await A.ctx.close();
  await T.ctx.close();
}

// Real Chrome with the GPU, as on the owner's PC (ANGLE / D3D11 on Windows).
const GPU_ARGS = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
const browser = await chromium.launch({ headless: true, channel: "chrome", args: GPU_ARGS });
// CV_CHAT_ONLY=pc,pc-matrix,iphone13,kakao-android,legacy,hall,classroom runs only those parts (default: all of them).
const ONLY = process.env.CV_CHAT_ONLY ? new Set(process.env.CV_CHAT_ONLY.split(",").map((t) => t.trim())) : null;
const want = (part) => !ONLY || ONLY.has(part);
try {
  if (want("pc")) await pc(browser);
  if (want("pc-matrix")) await pcMatrix(browser);
  if (want("iphone13")) await phone(browser, "iphone13", IPHONE_13);
  if (want("kakao-android")) await phone(browser, "kakao-android", KAKAO_ANDROID);
  if (want("legacy")) await legacy(browser);
  if (want("hall")) await hall(browser);
  if (want("classroom")) await classroom(browser);
} finally {
  await browser.close();
}
process.exit(run.finish());
