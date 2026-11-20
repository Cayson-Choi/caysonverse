/**
 * (review shots) Entering a house must NOT take you upstairs (owner 2026-11-20: "집안에 들어갔을때 2층올라가기 버튼을 누르지도 않았는데 2층으로 올라가버린다").
 * For each house: walk to the door's keypad, open it (E / the action button), type 1004, confirm; after the cover is gone wait several
 * seconds and check the player is still on floor 1; then stand on the stair pad without pressing anything (still floor 1), and finally
 * use the stair on purpose (E / the button: floor 2).
 *
 *   server:  PORT=2953 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2953 npx vite --port 5953 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5953 node e2e/house-review-shots.mjs [--phone] [--houses=1,2] [--out=<folder>] [--tapfirst]
 *
 * --tapfirst: after the first house, tap the stair in house 1 before leaving (arms a use), leave, enter another house: still floor 1.
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, targets, pos } from "./lib/common.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const phone = process.argv.includes("--phone");
const houses = arg("houses", "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
const run = createRun(phone ? "house-review-shots-phone" : "house-review-shots");
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const device = phone ? PHONE : DESKTOP;
const browser = await launchBrowser();
const URL = `${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`;
const p = await openPlayer(browser, run, { tag: "stay", device });
const page = p.page;

const areaOf = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const act = async () => {
  if (phone) await press(p, page.locator(".cv-action-btn").first());
  else await page.keyboard.press("KeyE");
};
const key = (k) => press(p, page.locator(`.cv-keypad button[data-key="${k}"]`));
async function idle(ms = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__cvClickTarget())) === null) return true;
    await sleep(120);
  }
  return false;
}
async function gotoOnce(x, z, tol) {
  for (let i = 0; i < 3; i++) {
    const planned = await page.evaluate(async ([x, z]) => {
      const am = await window.__imp("/src/game/activeMap.ts");
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const cm = await window.__imp("/src/game/clickMove.ts");
      const map = am.getActiveMap();
      const me = window.__cv.getPos();
      const b = map.bounds ?? map.geometry.bounds;
      const via = cp.findDetour(me.x, me.z, x, z, map.geometry.obstacles, b, undefined, { ratio: 4, slack: 30, margin: 40 });
      cm.setClickTarget(x, z, 0, via ?? undefined);
      return via !== null;
    }, [x, z]);
    await sleep(300);
    await idle();
    await sleep(250);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) <= tol || !planned) return at;
  }
  return pos(p);
}
async function goto(x, z, tol = 0.35, depth = 0) {
  const r = await gotoOnce(x, z, tol);
  if (Math.hypot(r.x - x, r.z - z) <= tol || depth >= 3 || Math.hypot(r.x - x, r.z - z) < 4) return r;
  await gotoOnce((r.x + x) / 2, (r.z + z) / 2, 1.5);
  return goto(x, z, tol, depth + 1);
}
async function waitArea(a, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf()) === a) return true;
    await sleep(100);
  }
  return false;
}
async function coverGone() {
  await page
    .waitForFunction(() => {
      const c = document.querySelector(".cv-house-cover");
      const f = document.querySelector(".cv-door-fade");
      return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
    }, null, { timeout: 20000 })
    .catch(() => {});
  await sleep(450);
}

await page.goto(URL, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("계단");
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await sleep(1500);
const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntries());
const places = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES);


const shotsDir = run.evidence;
const hole = process.argv.includes("--hole");
const pitchArg = Number(arg("pitch", "0"));
const floorsArg = arg("floors", "1,2").split(",").map(Number);
const spotsArg = arg("spots", "");
const stairs = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).STAIR_PLANS);
const hType = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_STAIR_TYPE);
const spotsFor = (n, floor) => {
  if (spotsArg) return spotsArg.split(";").map((q) => q.split(",").map(Number));
  if (hole) {
    const f = stairs[hType[n]].footprint;
    const cx = (f.minX + f.maxX) / 2, cz = (f.minZ + f.maxZ) / 2;
    // four spots round the stair: both ends along its long side and both sides
    const along = f.maxX - f.minX > f.maxZ - f.minZ;
    return along
      ? [[f.minX - 0.6, cz], [f.maxX + 0.5, cz], [cx, f.minZ - 0.7], [cx - 1.2, f.minZ - 0.7]]
      : [[cx, f.minZ - 0.8], [cx, f.maxZ + 0.5], [f.minX - 0.7, cz], [f.maxX + 0.5, cz]];
  }
  return [[2.5, 2.2], [8.1, 2.2], [2.5, 5.6], [8.1, 5.6], [5.3, 3.9]];
};
async function fpLook(yaw, pitch) {
  await page.evaluate(async ([yaw, pitch]) => {
    const vs = await window.__imp("/src/game/viewState.ts");
    vs.enterFp(yaw);
    vs.viewState.fpPitch = pitch;
  }, [yaw, pitch]);
  await sleep(900);
}
async function tpBack() {
  await page.evaluate(async () => {
    const vs = await window.__imp("/src/game/viewState.ts");
    vs.viewState.mode = "tp";
  });
  await sleep(500);
}
let prevExit = null;
for (const n of houses) {
  await run.step(`house ${n}: shots`, async () => {
    if ((await areaOf()) !== "village" && prevExit) {
      await goto(prevExit.x, prevExit.z, 0.5);
      await act();
      await waitArea("village", 15000);
      await coverGone();
    }
    const kp = keypads.find((k) => k.buildingId === `house_${n}`);
    await goto(kp.pad.x, kp.pad.z, 0.9);
    await act();
    await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
    for (const c of "1004") await key(c);
    await key("ok");
    await waitArea(`house:house_${n}:1`, 20000);
    await coverGone();
    const P = places[n];
    run.check(`h${n}: still floor 1 after entering`, (await areaOf()) === `house:house_${n}:1`);
    await page.screenshot({ path: `${shotsDir}/h${n}-f1-enter.png` });
    for (const floor of floorsArg) {
      const ox = P.exitPad.x - 5.3;
      const oz = floor === 1 ? 0 : 30;
      let k = 0;
      for (const [lx, lz] of spotsFor(n, floor)) {
        await goto(ox + lx, oz - lz, 0.9);
        k++;
        for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
          await fpLook(yaw, pitchArg);
          await page.screenshot({ path: `${shotsDir}/h${n}-f${floor}-s${k}-y${Math.round((yaw * 180) / Math.PI)}.png` });
        }
        await tpBack();
      }
      if (floor === 1 && floorsArg.includes(2)) {
        await goto(P.upPad.x, P.upPad.z, 0.4);
        await act();
        await waitArea(`house:house_${n}:2`, 15000);
        await coverGone();
      }
    }
    if (floorsArg.includes(2)) {
      const dn = P.downPad;
      await goto(dn.x, dn.z, 0.4);
      await act();
      await waitArea(`house:house_${n}:1`, 15000);
      await coverGone();
    }
    await goto(P.exitPad.x, P.exitPad.z, 0.5);
    prevExit = P.exitPad;
  });
}
await browser.close();
process.exit(run.finish());
