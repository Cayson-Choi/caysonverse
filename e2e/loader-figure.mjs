/**
 * e2e/loader-figure.mjs — "케이슨 마을로 가는 중" 화면에 내 캐릭터가 보이고(주인님 11-27), 그동안 분수 물소리가 나지 않는지.
 *   node e2e/loader-figure.mjs [--phone] [--out=<폴더>]
 */
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const phone = process.argv.includes("--phone");
const out = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6);
const run = createRun("loader-figure");
const browser = await launchBrowser();
let fail = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info ?? ""}`);
  if (!ok) fail++;
};
try {
  const p = await openPlayer(browser, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "low" } });
  await p.page.goto(`${CLIENT_URL}/?time=12:00`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  await p.page.waitForFunction(() => !document.querySelector(".cv-builder-hint.is-loading"), null, { timeout: 60000 });
  await sleep(800);
  await p.page.locator("input.cv-input").first().fill(`그림${Math.floor(Math.random() * 900 + 100)}`);
  await press(p, p.page.locator(".cv-submit"));
  // sample the loader while it is up: figure present + fountain target 0
  let sawFigure = null;
  let maxFountain = 0;
  let shot = false;
  for (let i = 0; i < 400; i++) {
    const s = await p.page.evaluate(() => {
      const img = document.querySelector('[data-testid="loader-figure"]');
      const open = !!document.querySelector('[data-testid="village-loader"]:not(.is-closing)');
      return {
        open,
        fig: img ? { w: img.naturalWidth, h: img.naturalHeight, len: img.src.length } : null,
        f: window.__cvSfx?.fountainTarget?.() ?? 0,
      };
    });
    if (!s.open && i > 3) break;
    if (s.open) {
      maxFountain = Math.max(maxFountain, s.f);
      if (s.fig) sawFigure = s.fig;
      if (!shot && s.fig && out) {
        await sleep(400);
        await p.page.screenshot({ path: `${out}/loader-${phone ? "phone" : "pc"}.png` });
        shot = true;
      }
    }
    await sleep(100);
  }
  check("가는 중 화면에 캐릭터", !!sawFigure && sawFigure.len > 5000, JSON.stringify(sawFigure));
  check("가는 중 화면에 분수 소리 없음", maxFountain === 0, `max=${maxFountain}`);
} catch (e) {
  console.log("ERROR", e);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `FAILED ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
