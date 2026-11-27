/**
 * e2e/stick-only.mjs — 폰 조이스틱은 왼쪽 아래 제자리에서만 (주인님 11-27): 조이스틱 밖에서 끌어도 조이스틱이 생기지 않고 걷지 않음,
 * 조이스틱을 밀면 걸음, 조이스틱 탭은 걷지 않음. 바닥의 한 곳을 톡 누르면 그곳으로 걸어감.
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
  // the session's first CDP tap gets no click from Chrome (village.mjs): one warm-up tap on the stick (which walks nowhere)
  await tapAt(96, vp.height - 100);
  await sleep(800);
  for (const [name, x, y] of [
    ["왼쪽 아래 조이스틱 밖 탭", vp.width * 0.42, vp.height * 0.6],
    ["오른쪽 바닥 탭", vp.width * 0.62, vp.height * 0.72],
    ["오른쪽 바닥 탭 2", vp.width * 0.7, vp.height * 0.62],
  ]) {
    const a = await pos(p);
    await tapAt(x, y);
    await sleep(2600);
    const b = await pos(p);
    check(name + ": 그곳으로 걸어감", dist(a, b) > 0.5, `moved=${dist(a, b).toFixed(2)}`);
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
