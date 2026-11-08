/**
 * e2e/village-guides.mjs — 케이슨 마을 안내원 (1단계 Task 9A): 광장의 마을 안내원과 추모관 안내 데스크에 다가가 E로 문의하기,
 * 질문을 고르면 그 사람에게만 음성 클립이 재생되고 배경음악이 작아지는지, 같은 질문을 다시 누르면 건너뛰는지, 다른 질문은
 * 앞의 것을 멈추는지, 🔊 끄기가 음성을 끄는지, 안내원을 뚫고 지나갈 수 없는지 본다. 헤드리스 크롬은 소리를 내지 않으므로
 * 소리 요소와 GainNode의 상태만 읽는다.
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-guides.mjs [--out=<폴더>]
 *
 * 남기는 것(폴더): guide-plaza.png, guide-plaza-answer.png, guide-hall.png, guide-hall-answer.png, assertions-village-guides.json.
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait, walkTo, waitIdle } from "./lib/escape.mjs";

const run = createRun("village-guides");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

const r3 = (n) => Math.round(n * 1000) / 1000;
/** The voice, the music and the shared AudioContext as the page sees them. */
const audio = (p) =>
  p.page.evaluate(async () => {
    const ctx = await window.__imp("/src/village/villageAudio.ts");
    const v = window.__cvGuideVoice;
    const el = v?.element();
    const bgm = window.__cvBgm;
    const r = (n) => Math.round(n * 1000) / 1000;
    return {
      context: ctx.villageAudioState(),
      voice: v
        ? { ...v.state(), routed: v.isRouted(), level: r(v.level()), src: el ? el.src.replace(/^https?:\/\/[^/]+/, "") : null, paused: el ? el.paused : null, elVolume: el ? el.volume : null }
        : null,
      music: bgm ? { routed: bgm.isRouted(), level: r(bgm.level()), duck: r(bgm.duckLevel()), paused: bgm.element()?.paused ?? null, elVolume: bgm.element()?.volume ?? null } : null,
    };
  });
const targetsAt = (p) =>
  p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label })));
const question = (p, i) => p.page.locator(".cv-guide-questions button").nth(i);
const dialogText = (p) => p.page.evaluate(() => document.querySelector(".cv-guide")?.textContent ?? "");

const browser = await launchBrowser();
const summary = {};
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "high" } });
  const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP, settings: { graphics: "high" } });

  const join = async (p, nick) => {
    await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded" });
    await entryReady(p);
    await p.page.locator("input.cv-input").first().fill(nick);
    await press(p, p.page.locator(".cv-submit"));
    await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
    await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm && !!window.__cvGuideVoice, null, { timeout: 20000 });
    await sleep(1500);
  };

  await run.step("join, and a click starts the music through the GainNode", async () => {
    await join(A, "안내1");
    await join(B, "안내2");
    await A.page.mouse.click(640, 300);
    await B.page.mouse.click(640, 300);
    await sleep(2200);
    const s = await audio(A);
    summary.start = s;
    run.check("the AudioContext is running", s.context === "running", s.context);
    run.check("the music goes through a GainNode (iOS ignores element.volume), at 0.35, element volume 1", s.music.routed && Math.abs(s.music.level - 0.35) < 0.02 && s.music.elVolume === 1 && !s.music.paused, s.music);
  });

  await run.step("the plaza guide stands at (5, 12) with its 안내원 tag; walking into it is blocked", async () => {
    const probe = await A.page.evaluate(() => {
      const t = window.__cv.getNametags?.() ?? null;
      return t ? Object.keys(t).filter((k) => k.startsWith("guide:")) : null;
    });
    summary.tags = probe;
    // walk at the guide from the south: a click-move onto its centre must stop outside its collider
    await walkAndWait(A, 5, 15.5, 30000, 0.8);
    await walkTo(A, 5, 12);
    await sleep(500);
    await waitIdle(A, 8000);
    const at = await A.page.evaluate(() => window.__cv.getPos());
    summary.blockedAt = at;
    run.check("the guide's collider keeps the player out (>= 0.5 m from its centre)", Math.hypot(at.x - 5, at.z - 12) >= 0.5, at);
  });

  await run.step("near the plaza guide: 문의하기 opens the questions with the AI 음성 label", async () => {
    await walkAndWait(A, 5, 13.7, 15000, 0.4);
    await turnCameraTo(A, 5, 12);
    await sleep(600);
    const ts = await targetsAt(A);
    run.check("문의하기 is offered", ts.some((t) => t.id === "guide:plaza_guide" && t.label === "문의하기"), ts);
    await A.page.keyboard.press("KeyE");
    await A.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 5000 });
    await sleep(500);
    const text = await dialogText(A);
    run.check("the dialog is the 마을 안내원's", (await A.page.locator(".cv-guide").getAttribute("data-guide")) === "plaza_guide" && text.includes("마을 안내원"), text);
    run.check("a small AI 음성 label", (await A.page.locator(".cv-guide-ai").textContent()) === "AI 음성", null);
    run.check("4 questions", (await A.page.locator(".cv-guide-questions button").count()) === 4, null);
    run.check("no '!' in the dialog", !text.includes("!"), text);
    await run.shot(A, "guide-plaza.png");
  });

  await run.step("a question: the answer shows, its clip plays for the asker only, the music ducks", async () => {
    await question(A, 0).click();
    await sleep(700);
    const s = await audio(A);
    const sb = await audio(B);
    summary.plazaPlay = s;
    run.check("the clip plays (plaza_guide_1.m4a), routed at level 1", s.voice.playing === "plaza_guide_1" && s.voice.src === "/village/voice/plaza_guide_1.m4a" && s.voice.paused === false && s.voice.routed && s.voice.level === 1, s.voice);
    run.check("the music is ducked to 0.3 of its level (0.35 x 0.3 = 0.105)", Math.abs(s.music.duck - 0.3) < 0.01 && Math.abs(s.music.level - 0.105) < 0.01, s.music);
    run.check("the other player hears nothing (no clip, music not ducked)", sb.voice.playing === null && sb.voice.src === null && Math.abs(sb.music.duck - 1) < 0.001, sb);
    const answer = await A.page.locator(".cv-guide-answer p").textContent();
    run.check("the answer text shows", answer?.startsWith("여기는 케이슨 마을이에요."), answer);
    await run.shot(A, "guide-plaza-answer.png");
  });

  await run.step("pressing the same question again skips it, and the music comes back", async () => {
    await question(A, 0).click();
    await sleep(900);
    const s = await audio(A);
    summary.plazaSkip = s;
    run.check("skipped: paused, nothing playing, the answer stays", s.voice.playing === null && s.voice.paused === true && s.voice.asked === "plaza_guide_1", s.voice);
    run.check("the music is back at 0.35", Math.abs(s.music.duck - 1) < 0.01 && Math.abs(s.music.level - 0.35) < 0.02, s.music);
  });

  await run.step("one clip at a time: a second question stops the first", async () => {
    await question(A, 1).click();
    await sleep(300);
    await question(A, 2).click();
    await sleep(500);
    const s = await audio(A);
    summary.plazaSwitch = s;
    run.check("the third question's clip is the one playing", s.voice.playing === "plaza_guide_3" && s.voice.src === "/village/voice/plaza_guide_3.m4a" && !s.voice.paused, s.voice);
    // let it finish by itself: ended gives the music back
    await A.page.waitForFunction(() => window.__cvGuideVoice.state().playing === null, null, { timeout: 15000 });
    await sleep(900);
    const e = await audio(A);
    run.check("when the clip ends the music is back", Math.abs(e.music.duck - 1) < 0.01, e.music);
  });

  await run.step("the 🔊 toggle mutes the voice", async () => {
    await question(A, 3).click();
    await sleep(400);
    await A.page.evaluate(async () => (await window.__imp("/src/stores/soundStore.ts")).useSoundStore.getState().toggleMuted());
    await sleep(900); // the music glides back over 0.7 s
    let s = await audio(A);
    run.check("muting stops the clip and gives the music back", s.voice.playing === null && s.voice.paused === true && Math.abs(s.music.duck - 1) < 0.01, s);
    await question(A, 0).click();
    await sleep(400);
    s = await audio(A);
    const muted = await A.page.locator(".cv-guide-muted").textContent().catch(() => null);
    run.check("muted: a question shows its answer but plays nothing", s.voice.playing === null && s.voice.asked === "plaza_guide_1" && muted === "소리가 꺼져 있어요", { voice: s.voice, muted });
    await A.page.evaluate(async () => (await window.__imp("/src/stores/soundStore.ts")).useSoundStore.getState().toggleMuted());
    await sleep(200);
  });

  await run.step("닫기 closes it; chat is never spoken", async () => {
    await A.page.locator(".cv-guide-close").click();
    await sleep(300);
    run.check("closed", (await A.page.locator(".cv-guide").count()) === 0, null);
    const chat = await A.page.evaluate(async () => (await window.__imp("/src/game/tts.ts")).CHAT_VOICE_ENABLED);
    run.check("CHAT_VOICE_ENABLED is false", chat === false, chat);
  });

  await run.step("into the hall: the desk guide at (302.8, 3.0), 문의하기, a gentle answer, the hall music ducked", async () => {
    for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await walkAndWait(A, x, z, 40000, 1.2);
    await A.page.keyboard.press("KeyE");
    await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
    await A.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
    await sleep(2500);
    const arrive = await targetsAt(A);
    run.check("at the arrival point the desk is not offered yet", !arrive.some((t) => t.id === "guide:hall_desk"), arrive);
    await walkAndWait(A, 301.6, 3.0, 15000, 0.3); // 1.2 m from the desk, out of the way out's reach (2.1 m from the pad)
    summary.deskStand = await A.page.evaluate(() => window.__cv.getPos());
    await turnCameraTo(A, 302.8, 3.0);
    await sleep(800);
    const ts = await targetsAt(A);
    run.check("문의하기 is offered at the desk", ts.some((t) => t.id === "guide:hall_desk" && t.label === "문의하기"), ts);
    await A.page.keyboard.press("KeyE");
    await A.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 5000 });
    await sleep(500);
    run.check("the dialog is the 추모관 안내 데스크's", (await A.page.locator(".cv-guide").getAttribute("data-guide")) === "hall_desk", null);
    await run.shot(A, "guide-hall.png");
    await question(A, 0).click();
    await sleep(1500);
    const s = await audio(A);
    summary.hallPlay = s;
    run.check("hall_desk_1.m4a plays", s.voice.playing === "hall_desk_1" && !s.voice.paused, s.voice);
    run.check("the hall's music (0.15) is ducked to 0.045", Math.abs(s.music.level - 0.045) < 0.01, s.music);
    await run.shot(A, "guide-hall-answer.png");
    await A.page.locator(".cv-guide-skip").click();
    await sleep(900);
    const k = await audio(A);
    run.check("건너뛰기 stops it, the hall music is back at 0.15", k.voice.playing === null && Math.abs(k.music.level - 0.15) < 0.02, k);
    await A.page.keyboard.press("Escape");
    await sleep(300);
    run.check("Esc closes it", (await A.page.locator(".cv-guide").count()) === 0, null);
  });

  await A.ctx.close();
  await B.ctx.close();
} finally {
  await browser.close();
}
process.exit(run.finish(summary));
