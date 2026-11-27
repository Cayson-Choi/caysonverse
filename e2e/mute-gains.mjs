/** e2e/mute-gains.mjs — 소리를 끈 뒤 0보다 큰 GainNode를 누가 만들었는지(만든 곳) 모아요. 소리 끄기 점검용. */
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const run = createRun("mute-gains");
const browser = await launchBrowser();
let fail = 0;
try {
  const p = await openPlayer(browser, run, { tag: "M", device: DESKTOP });
  await p.ctx.addInitScript(() => {
    const gains = (window.__gains = []);
    const orig = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () {
      const g = orig.call(this);
      gains.push({ g, at: (new Error().stack || "").split("\n").slice(2, 6).map((l) => l.trim().replace(/\?[^:)]*/g, "")).join(" < ") });
      return g;
    };
  });
  await joinVillage(p, "음소거");
  await p.page.waitForFunction(() => !document.querySelector('[data-testid="village-loader"]'), null, { timeout: 60000 });
  await walkAndWait(p, 0, 9.5, 30000, 0.6); // the plaza fountain's rim
  await p.page.mouse.click(640, 400);
  await sleep(4000);
  console.log("fountain running before mute", await p.page.evaluate(() => window.__cvSfx?.fountainRunning?.()));
  await p.page.evaluate(async () => {
    const s = (await window.__imp("/src/stores/soundStore.ts")).useSoundStore.getState();
    if (!s.muted) s.toggleMuted();
  });
  await sleep(6000);
  const left = await p.page.evaluate(() => window.__gains.filter((x) => x.g.gain.value > 0.0005).map((x) => `${x.g.gain.value.toFixed(3)} ${x.at}`));
  console.log("fountain running after mute", await p.page.evaluate(() => window.__cvSfx?.fountainRunning?.()));
  console.log("total gains", await p.page.evaluate(() => window.__gains.length), "left above 0:", left.length);
  const by = {};
  for (const l of left) { const k = l.replace(/^[0-9.]+ /, ""); by[k] = (by[k] || 0) + 1; }
  for (const [k, n] of Object.entries(by)) console.log(n, k.slice(0, 330));
  if (left.length) fail++;
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
