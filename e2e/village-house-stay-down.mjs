/**
 * Entering a house must NOT take you upstairs (owner 2026-11-20: "집안에 들어갔을때 2층올라가기 버튼을 누르지도 않았는데 2층으로 올라가버린다").
 * For each house: walk to the door's keypad, open it (E / the action button), type 1004, confirm; after the cover is gone wait several
 * seconds and check the player is still on floor 1; then stand on the stair pad without pressing anything (still floor 1), and finally
 * use the stair on purpose (E / the button: floor 2).
 *
 *   server:  PORT=2953 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2953 npx vite --port 5953 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5953 node e2e/village-house-stay-down.mjs [--phone] [--houses=1,2] [--out=<folder>] [--tapfirst]
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
const run = createRun(phone ? "village-house-stay-down-phone" : "village-house-stay-down");
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

let prevExit = null;
for (const n of houses) {
  await run.step(`house ${n}: in by the keypad, stays on floor 1`, async () => {
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
    const got = await waitArea(`house:house_${n}:1`, 20000);
    run.check(`h${n}: arrived on floor 1`, got, await areaOf());
    await coverGone();
    const a0 = await pos(p);
    await sleep(5000);
    const a1 = await areaOf();
    run.check(`h${n}: 5 s after entering still on floor 1`, a1 === `house:house_${n}:1`, { area: a1, at: a0 });
    const t = await targets(p);
    const up = places[n].upPad;
    run.check(`h${n}: arrival spot clear of the stair pad`, Math.hypot(a0.x - up.x, a0.z - up.z) > up.radius + 0.3, { at: a0, up });

    if (process.argv.includes("--taps")) {
      // ordinary taps on the floor of the room must walk, never climb: a grid over the screen, a few seconds after each
      const vw = device.viewport;
      const climbed = [];
      const deliberate = [];
      for (let gy = 0; gy < 5; gy++) {
        for (let gx = 0; gx < 6; gx++) {
          const sx = Math.round(vw.width * (0.1 + 0.16 * gx));
          const sy = Math.round(vw.height * (0.35 + 0.12 * gy));
          if (phone ? sy > vw.height * 0.8 && sx > vw.width * 0.6 : false) continue; // the action button's corner
          if (phone) await page.touchscreen.tap(sx, sy);
          else await page.mouse.click(sx, sy);
          await sleep(1800);
          const ar = await areaOf();
          if (ar !== `house:house_${n}:1`) {
            // a tap that really landed on the stair's own steps / rail is a tap on the stair (deliberate); anything else is the bug
            const info = await page.evaluate(async (nn) => {
              const k = window.__cvClickPick?.();
              const pk = k && k.pick;
              if (!pk) return { onStair: false, pick: null };
              const ht = await window.__imp("/src/village/houseTap.ts");
              return { onStair: ht.onStairSurface(nn, 1, pk.x, pk.y, pk.z), pick: { x: +pk.x.toFixed(2), y: +pk.y.toFixed(2), z: +pk.z.toFixed(2), name: pk.name } };
            }, n);
            if (info.onStair) deliberate.push({ sx, sy, pick: info.pick });
            else climbed.push({ sx, sy, ar, pick: info.pick });
            await coverGone();
            const dn = places[n].downPad;
            await goto(dn.x, dn.z, 0.4);
            await act();
            await waitArea(`house:house_${n}:1`, 15000);
            await coverGone();
          }
        }
      }
      run.check(`h${n}: no tap on the room (wall, ceiling, floor) climbed the stair; only taps on its own steps do`, climbed.length === 0, { climbed, deliberate });
    }
    await page.screenshot({ path: `${run.evidence}/h${n}-entered.png` });
    // walk to the stair pad: only offered, never taken
    await goto(up.x, up.z, 0.4);
    await sleep(2500);
    const a2 = await areaOf();
    run.check(`h${n}: standing on the stair pad does not climb`, a2 === `house:house_${n}:1`, { area: a2, targets: (await targets(p)).map((x) => x.id) });
    // on purpose: up
    await act();
    const up2 = await waitArea(`house:house_${n}:2`, 15000);
    run.check(`h${n}: E / the button at the stair climbs`, up2, await areaOf());
    await coverGone();
    if (up2) {
      const dn = places[n].downPad;
      await goto(dn.x, dn.z, 0.4);
      await act();
      await waitArea(`house:house_${n}:1`, 15000);
      await coverGone();
    }
    await goto(places[n].exitPad.x, places[n].exitPad.z, 0.5);
    prevExit = places[n].exitPad;
  });
}
await browser.close();
process.exit(run.finish());
