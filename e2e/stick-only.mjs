/**
 * e2e/stick-only.mjs — 폰에서 이동은 조이스틱으로만 (주인님 11-27). 바닥 탭(오른쪽 반, 왼쪽 아래 조이스틱 밖)은 걷지 않고 링도 없음,
 * 조이스틱을 밀면 걸음, 조이스틱 탭은 걷지 않음.
 *   node e2e/stick-only.mjs [--out=<폴더>]
 */
import { joinVillage } from "./lib/village.mjs";
import { PHONE, createRun, launchBrowser, openPlayer, pos, sleep, touchDown, touchMoveTo, touchUp } from "./lib/common.mjs";

const out = (process.argv.find((a) => a.startsWith("--out=")) || "").slice(6);
const run = createRun("stick-only");
const browser = await launchBrowser();
let fail = 0;
const check = (name, ok, info) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name} ${info ?? ""}`);
  if (!ok) fail++;
};
try {
  const p = await openPlayer(browser, run, { tag: "A", device: PHONE, settings: { graphics: "low" } });
  await joinVillage(p, "막대");
  await sleep(1500);
  const vp = p.page.viewportSize();
  const ring = () => p.page.evaluate(async () => (await window.__imp("/src/game/clickMove.ts")).peekPendingClick?.() ?? null).catch(() => null);
  const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
  const tapAt = async (x, y) => {
    await touchDown(p, x, y);
    await sleep(60);
    await touchUp(p);
  };
  for (const [name, x, y] of [
    ["오른쪽 바닥 탭", vp.width * 0.7, vp.height * 0.62],
    ["왼쪽 아래 조이스틱 밖 탭", vp.width * 0.42, vp.height * 0.6],
    ["화면 가운데 탭", vp.width * 0.5, vp.height * 0.45],
  ]) {
    const a = await pos(p);
    await tapAt(x, y);
    await sleep(1600);
    const b = await pos(p);
    const r = await ring();
    check(name + ": 안 걸음", dist(a, b) < 0.05, `moved=${dist(a, b).toFixed(2)} ring=${JSON.stringify(r)}`);
  }
  const stick = await p.page.evaluate(() => {
    const r = document.querySelector(".cv-stick-zone").getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, op: getComputedStyle(document.querySelector(".cv-stick-base")).opacity };
  });
  check("조이스틱 자리 왼쪽 아래", stick.x < vp.width / 3 && stick.y > vp.height * 0.7, JSON.stringify(stick));
  // 조이스틱 탭: 걷지 않음
  {
    const a = await pos(p);
    await tapAt(stick.x, stick.y);
    await sleep(1600);
    const b = await pos(p);
    check("조이스틱 탭: 안 걸음", dist(a, b) < 0.05, `moved=${dist(a, b).toFixed(2)}`);
  }
  // 조이스틱 밀기: 걸음
  {
    const a = await pos(p);
    await touchDown(p, stick.x, stick.y);
    for (let s = 1; s <= 6; s++) await touchMoveTo(p, stick.x, stick.y - 8 * s);
    if (out) await p.page.screenshot({ path: `${out}/stick-push.png` });
    await sleep(1500);
    await touchUp(p);
    await sleep(500);
    const b = await pos(p);
    check("조이스틱 밀기: 걸음", dist(a, b) > 1, `moved=${dist(a, b).toFixed(2)}`);
  }
  // 조이스틱 옆(가장자리)을 눌러 밀기: 걸음
  {
    const a = await pos(p);
    await touchDown(p, stick.x + 40, stick.y);
    await touchMoveTo(p, stick.x + 50, stick.y);
    await sleep(1200);
    await touchUp(p);
    await sleep(400);
    const b = await pos(p);
    check("조이스틱 가장자리 누르기: 걸음", dist(a, b) > 0.5, `moved=${dist(a, b).toFixed(2)}`);
  }
  // 조이스틱 밖 왼쪽 아래에서 끌기: 걷지 않음
  {
    const a = await pos(p);
    const x0 = vp.width * 0.42, y0 = vp.height * 0.62;
    await touchDown(p, x0, y0);
    for (let s = 1; s <= 6; s++) await touchMoveTo(p, x0, y0 - 10 * s);
    await sleep(1000);
    await touchUp(p);
    await sleep(500);
    const b = await pos(p);
    check("조이스틱 밖 끌기: 안 걸음", dist(a, b) < 0.05, `moved=${dist(a, b).toFixed(2)}`);
  }
  if (out) await p.page.screenshot({ path: `${out}/rest.png` });
} catch (e) {
  console.log("ERROR", e);
  fail++;
} finally {
  await browser.close();
}
console.log(fail ? `FAILED ${fail}` : "ALL PASS");
process.exit(fail ? 1 : 0);
