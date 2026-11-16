/**
 * e2e/village-guides.mjs — 케이슨 마을 안내원 (1단계 Task 9A): 광장의 마을 안내원과 추모관 안내 데스크에 다가가 E로 문의하기,
 * 질문을 고르면 답이 안내원의 말풍선으로 나오는지(질문 버튼과 다른 모양, 위에 작은 "나: 질문", 아래 "다른 질문" 구분선), 안내원이
 * 글로만 답하는지(2026-11-17 음성을 뺐음: 음성 파일 요청 없음, 배경음악이 작아지지 않음), 안내원을 뚫고 지나갈 수 없는지 본다.
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-guides.mjs [--out=<폴더>]
 *
 * 남기는 것(폴더): guide-plaza.png, guide-plaza-q1.png … guide-plaza-q6.png, guide-hall-none.png, assertions-village-guides.json.
 */
import { mkdirSync } from "node:fs";
import { guideAnswer, standAtPlazaGuide } from "./lib/village.mjs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo, walkAndWait, walkTo, waitIdle } from "./lib/common.mjs";

const run = createRun("village-guides");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

const r3 = (n) => Math.round(n * 1000) / 1000;
/** The music and the shared AudioContext as the page sees them. */
const audio = (p) =>
  p.page.evaluate(async () => {
    const ctx = await window.__imp("/src/village/villageAudio.ts");
    const bgm = window.__cvBgm;
    const r = (n) => Math.round(n * 1000) / 1000;
    return {
      context: ctx.villageAudioState(),
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
    await p.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 20000 });
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

  await run.step("near the plaza guide: 문의하기 opens the questions (no AI 음성 label any more)", async () => {
    await standAtPlazaGuide(A); // round the guide from the south (the walk-into check above leaves the player on its north side)
    const ts = await targetsAt(A);
    run.check("문의하기 is offered", ts.some((t) => t.id === "guide:plaza_guide" && t.label === "문의하기"), ts);
    await A.page.keyboard.press("KeyE");
    await A.page.locator(".cv-guide").waitFor({ state: "visible", timeout: 5000 });
    await sleep(500);
    const text = await dialogText(A);
    run.check("the dialog is the 마을 안내원's", (await A.page.locator(".cv-guide").getAttribute("data-guide")) === "plaza_guide" && text.includes("마을 안내원"), text);
    run.check("no AI 음성 label (the voice was taken out, 2026-11-17)", !text.includes("AI 음성"), text);
    run.check("6 questions (the 5th: the fishing lake, the 6th: the houses)", (await A.page.locator(".cv-guide-questions button").count()) === 6, null);
    run.check("no '!' in the dialog", !text.includes("!"), text);
    await run.shot(A, "guide-plaza.png");
  });

  await run.step("each question: the answer shows as the guide's speech bubble, words only (no clip, the music stays)", async () => {
    const qas = await A.page.evaluate(async () => (await window.__imp("/shared/src/village/guides.ts")).guideById("plaza_guide").qas.map((q) => ({ question: q.question, answer: q.answer })));
    summary.plaza = [];
    for (let i = 0; i < qas.length; i++) {
      await question(A, i).click();
      await sleep(400);
      const g = await guideAnswer(A);
      const s = await audio(A);
      summary.plaza.push({ ...g, duck: s.music.duck });
      run.check(`q${i + 1}: the bubble says the answer, '나: ${qas[i].question}' above it, '다른 질문' below`, g.answer === qas[i].answer && g.me === `나 ${qas[i].question}` && g.speaker === "안내원" && g.divider === "다른 질문", g);
      run.check(`q${i + 1}: the bubble does not look like a button (its own tint)`, g.bubbleBg !== g.buttonBg, { bubble: g.bubbleBg, button: g.buttonBg });
      run.check(`q${i + 1}: the asked question is marked`, (await question(A, i).getAttribute("aria-pressed")) === "true", null);
      run.check(`q${i + 1}: no voice: no clip requested, no audio element, the music not ducked`, g.voiceRequests.length === 0 && g.audioElements === 0 && Math.abs(s.music.duck - 1) < 0.001, { req: g.voiceRequests, audio: g.audioElements, music: s.music });
      await run.shot(A, `guide-plaza-q${i + 1}.png`);
    }
    const sb = await guideAnswer(B);
    run.check("the other player sees no dialog", (await B.page.locator(".cv-guide").count()) === 0 && sb.voiceRequests.length === 0, sb);
  });

  await run.step("닫기 closes it; chat is never spoken", async () => {
    await A.page.locator(".cv-guide-close").click();
    await sleep(300);
    run.check("closed", (await A.page.locator(".cv-guide").count()) === 0, null);
    // (the chat-voice flag lived in game/tts.ts, which the village-only cleanup removed: nothing speaks chat any more)
  });

  await run.step("into the hall: nobody to ask there any more (the desk guide was removed, owner 2026-11-17)", async () => {
    for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await walkAndWait(A, x, z, 40000, 1.2);
    await A.page.keyboard.press("KeyE");
    await A.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
    await A.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
    await sleep(2500);
    const arrive = await targetsAt(A);
    run.check("no guide is offered at the arrival point", !arrive.some((t) => t.id.startsWith("guide:")), arrive);
    await walkAndWait(A, 303.0, 3.9, 15000, 0.3);
    const ts = await targetsAt(A);
    run.check("no 문의하기 by the desk", !ts.some((t) => t.id.startsWith("guide:")), ts);
    await run.shot(A, "guide-hall-none.png");
  });

  await A.ctx.close();
  await B.ctx.close();
} finally {
  await browser.close();
}
process.exit(run.finish(summary));
