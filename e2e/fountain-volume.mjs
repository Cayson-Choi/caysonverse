/** e2e/fountain-volume.mjs — 분수 소리가 메뉴의 소리 크기를 따르는지 (주인님 11-27). 분수 옆에서 목표 크기를 100% / 50% / 0%로 재요. */
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const run = createRun("fountain-volume");
const browser = await launchBrowser();
let fail = 0;
try {
  const p = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "low" } });
  await joinVillage(p, "분수");
  await p.page.waitForFunction(() => !document.querySelector('[data-testid="village-loader"]'), null, { timeout: 60000 });
  await walkAndWait(p, 0, 9.5, 30000, 0.6); // at the plaza fountain's rim
  await sleep(4000); // the camera settles
  await p.page.mouse.click(5, 300); // a gesture: the audio context may run
  await sleep(1500);
  const at = async (v) => {
    await p.page.evaluate(async (v) => (await window.__imp("/src/stores/musicStore.ts")).useMusicStore.getState().setVolume(v), v);
    await sleep(500);
    return p.page.evaluate(() => window.__cvSfx?.fountainTarget?.() ?? -1);
  };
  const full = await at(1);
  const half = await at(0.5);
  const zero = await at(0);
  const full2 = await at(1);
  await at(1);
  console.log(JSON.stringify({ full, half, zero, full2 }));
  const ok = full > 0 && full <= 0.12 + 1e-9 && Math.abs(half / full - 0.5) < 0.05 && zero === 0;
  console.log(`${ok ? "PASS" : "FAIL"} 분수 소리가 소리 크기를 따름`);
  if (!ok) fail++;
} catch (e) {
  console.log("ERROR", e);
  fail++;
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
