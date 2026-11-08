/**
 * e2e/village-bgm.mjs — 케이슨 마을 배경음악 확인 (BGM task).
 *
 *   npm run dev   (다른 창에서)
 *   node e2e/village-bgm.mjs
 *
 * 마을에 들어가 소리 요소(window.__cvBgm.element())의 상태를 읽는다: 클릭 전 정지, 첫 클릭 뒤 재생(볼륨 0.35),
 * 추모관 안 0.15, 밖 0.35, 끄기 버튼 뒤 정지·저장, 다시 켜기. 헤드리스 크롬은 소리를 내지 않으므로 상태만 본다.
 */
import { CLIENT_URL, DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/escape.mjs";

const run = createRun("village-bgm");
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "bgm", device: DESKTOP });
const state = () =>
  p.page.evaluate(() => {
    const a = window.__cvBgm?.element();
    // Task 9A: the level is on a Web Audio GainNode (iOS ignores element.volume); level() reads it (or the volume, unrouted).
    return a ? { paused: a.paused, volume: Math.round(window.__cvBgm.level() * 1000) / 1000, routed: window.__cvBgm.isRouted(), src: a.src, loop: a.loop, preload: a.preload } : null;
  });
const fails = [];
const check = (name, ok, got) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${JSON.stringify(got)}`);
  if (!ok) fails.push(name);
};
try {
  await p.page.goto(`${CLIENT_URL}/`, { waitUntil: "domcontentloaded" });
  await p.page.locator("input.cv-input").first().fill("음악손님");
  await p.page.getByRole("button", { name: /입장하기/ }).first().click();
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await p.page.waitForFunction(() => !!window.__cvBgm, null, { timeout: 15000 });
  await sleep(1500);
  let s = await state();
  check("before a click: paused, preload none, loop", s && s.paused && s.preload === "none" && s.loop && /village_bgm1\.mp3$/.test(s.src), s);
  await p.page.mouse.click(640, 400);
  await sleep(2500);
  s = await state();
  check("after a click: playing at 0.35", s && !s.paused && Math.abs(s.volume - 0.35) < 0.02, s);
  check("one toggle button", (await p.page.getByRole("button", { name: "배경음악 켜기/끄기" }).count()) === 1, null);
  await p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).setLocalArea("hall"));
  await sleep(1600);
  s = await state();
  check("in the hall: 0.15", s && !s.paused && Math.abs(s.volume - 0.15) < 0.02, s);
  await p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).setLocalArea("village"));
  await sleep(1600);
  s = await state();
  check("back outside: 0.35", s && Math.abs(s.volume - 0.35) < 0.02, s);
  await p.page.getByRole("button", { name: "배경음악 켜기/끄기" }).click();
  await sleep(300);
  s = await state();
  const stored = await p.page.evaluate(() => localStorage.getItem("cv-village-bgm"));
  check("muted: paused, stored 0", s && s.paused && stored === "0", { s, stored });
  await p.page.getByRole("button", { name: "배경음악 켜기/끄기" }).click();
  await sleep(2200);
  s = await state();
  check("unmuted: playing again at 0.35", s && !s.paused && Math.abs(s.volume - 0.35) < 0.02, s);
  await p.page.screenshot({ path: `${run.evidence}/bgm-button.png` });
  const errs = run.errors?.length ?? 0;
  check("no console errors", errs === 0, run.errors);
} catch (e) {
  console.log("ERROR", e.message);
  fails.push("exception");
}
await browser.close();
process.exit(fails.length ? 1 : 0);
