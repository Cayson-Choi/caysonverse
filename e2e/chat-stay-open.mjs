// 채팅창 계속 쓰기 (2026-11-10, owner's ask): once chatting, Enter sends and the caret STAYS in the field; a send
// button at the end of the bar does the same; Enter on an empty field / Escape leave; a press anywhere outside the
// bar takes the caret out, so WASD walks again at once. Hangul typed through an IME is never lost or sent twice.
// And the owner's second report — talking WITHOUT clicking the bar first opened the map (Hangul ㅡ is the M key):
// a typed key that is no game key now opens the chat with it (type to chat), in English and in 한글 mode — including
// Windows, where Chrome turns the IME off outside a field and ㅡ arrives as a plain "m": an M / B right after a consonant
// key is the vowel of a word (그 = R M), so it is typing; on its own M is still the map. Review fixes (2026-11-10):
// a held Enter never throws the player out of the chat, and a 4th quick line stays in the field instead of being lost.
//
// Plain Playwright against a dev stack, in the style of the other e2e scripts:
//   server:  PORT=2681 TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json npx tsx src/index.ts   (in server/; the path is from the repo root)
//   client:  VITE_SERVER_URL=http://localhost:2681 npx vite --port 5281 --strictPort (in client/)
//   CV_CLIENT_URL=http://localhost:5281 node e2e/chat-stay-open.mjs
// CV_CHAT_EVIDENCE=<dir> puts the screenshots + assertions there (default: .superpowers/sdd/evidence/task-escape/chat-stay-open).
// CV_CHAT_ONLY=<parts> (comma list of pc, iphone13, kakao-android, legacy, hall) runs only those parts.
//
// The IME is driven through CDP (Input.imeSetComposition / Input.insertText): Blink then holds a REAL composition
// (compositionstart/update/end, isComposing on the keydowns), which is what a Hangul IME does to the page.
//
// Exit code 0 only when every check passes and no unexpected console/page error was seen.

import { chromium, devices } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, createRun, entryReady, joinAsTeacher, openPlayer, pos, press, sleep, waitIdle } from "./lib/escape.mjs";
import { joinVillage } from "./lib/village.mjs";

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

/** Screenshot of the bar only (padded), plus the full screen. */
async function shots(p, name) {
  const box = await p.page.locator(BAR).boundingBox();
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
    const typed = await sendInfo(A);
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
    // Safari's Enter that only COMMITS the syllable: key "Enter", keyCode 229, isComposing false — must not send.
    const n1 = (await myLines(A)).length;
    await cdp.send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Enter", code: "Enter", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
    await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
    await sleep(500);
    const s4 = await state(A);
    check("IME: an Enter with keyCode 229 (the IME's commit) sends nothing and keeps the line and the caret", (await myLines(A)).length === n1 && s4.value === "다음" && s4.focused, s4);
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
      await sleep(700); // past WORD_GAP_MS: the next key starts afresh
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

    // M on its own is the map — in English mode, and in 한글 mode on Windows (a Korean line never starts with ㅡ).
    await A.page.keyboard.press("KeyM");
    const ovL = await until(mode, (m) => m === "ov", 2000);
    const sL = await state(A);
    check("a lone M still opens the map (chat untouched)", ovL === "ov" && !sL.focused && sL.value === "", { mode: ovL, ...sL });
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(700);
    // Walking (W held down) and pressing M on the way: the map, not the chat.
    await A.page.keyboard.down("KeyW");
    await sleep(350);
    await A.page.keyboard.press("KeyM");
    const ovW = await until(mode, (m) => m === "ov", 2000);
    await A.page.keyboard.up("KeyW");
    const sWM = await state(A);
    check("walking with W held, then M: the map opens (no chat)", ovW === "ov" && !sWM.focused && sWM.value === "", { mode: ovW, ...sWM });
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    // A consonant, then a pause, then M: the map (the M is a key on its own).
    await sleep(700);
    await A.page.keyboard.press("KeyR");
    await sleep(900);
    await A.page.keyboard.press("KeyM");
    const ovP = await until(mode, (m) => m === "ov", 2000);
    check("R, a pause, then M: the map opens", ovP === "ov" && !(await state(A)).focused, { mode: ovP });
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
    await A.page.keyboard.press("KeyM");
    await until(mode, (m) => m !== "ov", 2000);
    await sleep(700);
    await A.page.keyboard.press("KeyV"); // back to the view it had
    await until(mode, (m) => m === v0, 1500);
    await sleep(600);
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
    // after the window (5 s + the slack, from the first line), Enter sends it
    await sleep(Math.max(0, 5700 - (Date.now() - t0)));
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
    const want = ["첫 번째 줄", "두 번째 줄", "버튼으로 보냄", "안녕하세요", "반가워요", "hi", "그래", "길게 엔터", "빠른1", "빠른2", "빠른3", "빠른4"];
    check("my log is exactly these twelve lines, in order", JSON.stringify(lines) === JSON.stringify(want), lines);
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
    check("…big enough to hit with a thumb (≥ 36 px)", info0 && info0.box.w >= 36 && info0.box.h >= 36, info0?.box);
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

    // a tap on the scene (the look half, upper right) folds the chat away
    const vp = P.page.viewportSize();
    await P.page.touchscreen.tap(Math.round(vp.width * 0.72), Math.round(vp.height * 0.33));
    const s4 = await until(() => state(P), (s) => !s.focused, 1500);
    check("a tap on the scene leaves the chat: field blurred, bar folded, keyboard capture released", !s4.focused && s4.collapsed && !s4.captured && !s4.focusClass, s4);
    const btn = await until(() => P.page.locator(".cv-chat-btn").count(), (n) => n === 1, 1500);
    check("…and 💬 is back", btn === 1, { count: btn });
    await shots(P, `${label}-after-tap`);
  });
  await P.ctx.close();
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
// CV_CHAT_ONLY=pc,iphone13,kakao-android,legacy,hall runs only those parts (default: all of them).
const ONLY = process.env.CV_CHAT_ONLY ? new Set(process.env.CV_CHAT_ONLY.split(",").map((t) => t.trim())) : null;
const want = (part) => !ONLY || ONLY.has(part);
try {
  if (want("pc")) await pc(browser);
  if (want("iphone13")) await phone(browser, "iphone13", IPHONE_13);
  if (want("kakao-android")) await phone(browser, "kakao-android", KAKAO_ANDROID);
  if (want("legacy")) await legacy(browser);
  if (want("hall")) await hall(browser);
} finally {
  await browser.close();
}
process.exit(run.finish());
