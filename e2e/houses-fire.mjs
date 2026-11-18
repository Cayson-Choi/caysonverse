/** Fireplace look: in each house by the keypad, then the camera at its fireplace (window.__cvShot). Usage: --houses=1,2,7,10 --out=<dir> [--night] */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, targets, pos, visibleButtons, layoutReport } from "./lib/common.mjs";

const arg = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(`--${k}=`));
  return a ? a.slice(k.length + 3) : d;
};
const phone = process.argv.includes("--phone");
const night = process.argv.includes("--night");
const noCamera = process.argv.includes("--no-camera");
/** realism pass 2026-11-17: also shoot each spot in first person (two looks), for the game | real sheets */
const fpShots = process.argv.includes("--fp");
const houses = arg("houses", "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
const seatsArg = arg("seats", "all");
const name = `village-houses${phone ? "-phone" : ""}${night ? "-night" : ""}`;
const run = createRun(name);
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

const device = phone ? PHONE : DESKTOP;
const VIEW = device.viewport;
const browser = await launchBrowser();
const time = night ? "2026-11-03T22:30" : "2026-11-03T12:30";
const URL = `${CLIENT_URL}/?time=${encodeURIComponent(time)}`;
const p = await openPlayer(browser, run, { tag: "houses", device });
const page = p.page;
const report = { houses: {} };

const areaOf = () => page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const act = async () => {
  if (phone) await press(p, page.locator(".cv-action-btn").first());
  else await page.keyboard.press("KeyE");
};
async function waitArea(a, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf()) === a) return true;
    await sleep(120);
  }
  return false;
}
async function coverGone() {
  await page
    .waitForFunction(() => {
      const c = document.querySelector(".cv-house-cover");
      const f = document.querySelector(".cv-door-fade");
      return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
    }, null, { timeout: 15000 })
    .catch(() => {});
  await sleep(450);
}
const idle = async (ms = 25000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await page.evaluate(() => window.__cvClickTarget())) === null) return true;
    await sleep(120);
  }
  return false;
};
/**
 * Walk the way the game plans a tap on the floor (findDetour round the colliders of the map one is in), then wait. A long way across the
 * village the search gives up on is walked in halves.
 */
async function goto(x, z, tol = 0.35, depth = 0) {
  const r = await gotoOnce(x, z, tol);
  if (Math.hypot(r.x - x, r.z - z) <= tol || depth >= 3 || Math.hypot(r.x - x, r.z - z) < 4) return r;
  await gotoOnce((r.x + x) / 2, (r.z + z) / 2, 1.5);
  return goto(x, z, tol, depth + 1);
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
    if (Math.hypot(at.x - x, at.z - z) <= tol) return { ...at, planned };
    if (!planned) return { ...at, planned };
  }
  return { ...(await pos(p)), planned: true };
}
await page.goto(URL, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("불멍");
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await sleep(1500);
const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntries());
const places = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES);
const FIRE = JSON.parse(arg("fire", "{}"));
for (const n of houses) {
  const kp = keypads.find((k) => k.buildingId === `house_${n}`);
  if ((await areaOf()) !== "village") await goto(places[n - 1]?.exitPad.x ?? 0, places[n - 1]?.exitPad.z ?? 0, 0.5);
  await goto(kp.pad.x, kp.pad.z, 0.9);
  await act();
  await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
  for (const c of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${c}"]`));
  await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
  const inside = await waitArea(`house:house_${n}:1`, 20000);
  console.log("house", n, "inside", inside);
  await coverGone();
  if (process.argv.includes("--probe")) {
    const B = JSON.parse(arg("box", "[0,0,0,0,0,0]"));
    const out = await page.evaluate((B) => {
      const sc = window.__cvThree().scene;
      const res = {};
      sc.traverse((o) => {
        if (!o.isMesh || !o.geometry?.attributes?.position) return;
        o.updateWorldMatrix(true, false);
        const p = o.geometry.attributes.position, v = new o.position.constructor();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        const groups = o.geometry.groups.length ? o.geometry.groups : [{ start: 0, count: o.geometry.index ? o.geometry.index.count : p.count, materialIndex: 0 }];
        for (const g of groups) {
          let c = 0;
          for (let i = g.start; i < g.start + g.count; i++) {
            const k = o.geometry.index ? o.geometry.index.getX(i) : i;
            v.fromBufferAttribute(p, k).applyMatrix4(o.matrixWorld);
            if (v.x >= B[0] && v.x <= B[3] && v.y >= B[1] && v.y <= B[4] && v.z >= B[2] && v.z <= B[5]) c++;
          }
          if (c) res[o.name + "|" + (mats[g.materialIndex]?.name ?? "?") + "|" + (mats[g.materialIndex]?.type ?? "")] = c;
        }
      });
      return res;
    }, B);
    console.log("PROBE", JSON.stringify(out));
  }
  const f = FIRE[n];
  if (f) {
    await page.evaluate((f) => { window.__cvShot = { x: f[0], y: f[1], z: f[2], tx: f[3], ty: f[4], tz: f[5], fov: 55 }; }, f);
    await sleep(2500);
    await run.shot(p, `fire_h${n}${night ? "_night" : ""}.png`);
    await page.evaluate(() => { window.__cvShot = null; });
  }
  break; // one house per run: leaving by the exit pad hung when the camera was a photo shot
}
await browser.close();
process.exit(0);
