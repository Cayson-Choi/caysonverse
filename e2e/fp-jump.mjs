/**
 * e2e/fp-jump.mjs — 1인칭에서 점프하면 보이는 것도 함께 뛰어오르는지 (주인님 11-27). 카메라 높이를 매 프레임 재요.
 *   node e2e/fp-jump.mjs [--phone]
 */
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const run = createRun("fp-jump");
const browser = await launchBrowser();
let fail = 0;
try {
  const p = await openPlayer(browser, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "low" } });
  await joinVillage(p, "점프");
  await p.page.evaluate(async () => {
    const vs = await window.__imp("/src/game/viewState.ts");
    if (vs.viewState.mode !== "fp") vs.enterFp(0);
  });
  await sleep(2500);
  if (phone) {
    // the phone's jump button, tapped while the probe below samples
    setTimeout(() => p.page.locator(".cv-jump-btn").first().tap().catch((e) => console.log("tap", e.message)), 150);
  }
  const res = await p.page.evaluate(async (phone) => {
    const j = await window.__imp("/src/game/jump.ts");
    const { camera } = window.__cvThree();
    const ys = [];
    const lifts = [];
    const y0 = camera.position.y;
    const t0 = performance.now();
    if (!phone) {
      try { window.dispatchEvent(new KeyboardEvent("keydown", { code: "Space", key: " ", bubbles: true })); } catch {}
    }
    await new Promise((r) => {
      const tick = () => {
        ys.push(camera.position.y - y0);
        lifts.push(j.getLocalLift());
        if (performance.now() - t0 < 2000) requestAnimationFrame(tick);
        else r();
      };
      requestAnimationFrame(tick);
    });
    window.dispatchEvent(new KeyboardEvent("keyup", { code: "Space", key: " ", bubbles: true }));
    return { maxCam: Math.max(...ys), maxLift: Math.max(...lifts), mode: (await window.__imp("/src/game/viewState.ts")).viewState.mode, trace: ys.filter((_, i) => i % 6 === 0).map((y) => Math.round(y * 100) / 100) };
  }, phone);
  console.log(JSON.stringify(res));
  const ok = res.mode === "fp" && res.maxLift > 0.5 && res.maxCam > res.maxLift * 0.8;
  console.log(`${ok ? "PASS" : "FAIL"} 1인칭 카메라가 점프와 함께 오름`);
  if (!ok) fail++;
} catch (e) {
  console.log("ERROR", e);
  fail++;
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
