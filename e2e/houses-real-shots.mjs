/** Houses-real pass shots: enter house N by the keypad, then photo cameras (window.__cvShot). Usage: --house=2 --views=<json file> --out=<dir> [--night] [--phone] [--tag=before]
 *  views file: [{ "name": "sofa", "cam": [x, y, z, tx, ty, tz], "fov": 55, "frames": 0, "floor": 1 }] (frames > 0: a frame sequence 120 ms apart) */
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
const houses = [Number(arg("house", "2"))];
const VIEWS = JSON.parse((await import("node:fs")).readFileSync(arg("views"), "utf-8"));
const TAG = arg("tag", "shot");
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
async function hideSelf(hide) {
  await page.evaluate((hide) => {
    const t = window.__cvThree?.();
    if (!t) return;
    if (!hide) {
      for (const o of window.__cvHidden ?? []) o.visible = true;
      window.__cvHidden = [];
      return;
    }
    const me = window.__cv.getPos();
    const hidden = [];
    t.scene.traverse((o) => {
      if (!o.isSkinnedMesh || !o.visible) return;
      const w = o.getWorldPosition(new o.position.constructor());
      if (Math.hypot(w.x - me.x, w.z - me.z) < 1.5) {
        o.visible = false;
        hidden.push(o);
      }
    });
    window.__cvHidden = hidden;
  }, hide);
  await sleep(150);
}
await page.goto(URL, { waitUntil: "domcontentloaded" });
await entryReady(p);
await page.locator("input.cv-input").first().fill("불멍");
await press(p, page.locator(".cv-submit"));
await page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
await sleep(1500);
const keypads = await page.evaluate(async () => (await window.__imp("/shared/src/village/buildingAccess.ts")).keypadEntries());
const places = await page.evaluate(async () => (await window.__imp("/shared/src/village/houseAreas.ts")).HOUSE_PLACES);
for (const n of houses) {
  const kp = keypads.find((k) => k.buildingId === `house_${n}`);
  await goto(kp.pad.x, kp.pad.z, 0.9);
  await goto(kp.pad.x, kp.pad.z, 0.3); // a long walk can stop just out of the keypad's reach
  await act();
  await page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
  for (const c of "1004") await press(p, page.locator(`.cv-keypad button[data-key="${c}"]`));
  await press(p, page.locator('.cv-keypad button[data-key="ok"]'));
  const inside = await waitArea(`house:house_${n}:1`, 20000);
  console.log("house", n, "inside", inside);
  await coverGone();
  await sleep(2500);
  // the light maps and the full-size albedos come in after the cover lifts: wait until the loading pill is gone
  await page.waitForFunction(() => !document.body.innerText.includes("불러오는 중"), null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const shoot = async (v) => {
    const [x, y, z, tx, ty, tz] = v.cam;
    await page.evaluate((s) => { window.__cvShot = s; }, { x, y, z, tx, ty, tz, fov: v.fov ?? 55 });
    await sleep(2200);
    // round 2 of the interiors: the player's own avatar out of the photo (it stands in front of the sofa in some houses)
    if (process.argv.includes("--hide-self")) await hideSelf(true);
    const base = `${TAG}_h${n}_${v.name}${phone ? "_phone" : "_pc"}${night ? "_night" : "_day"}`;
    if (v.frames) {
      for (let i = 0; i < v.frames; i++) {
        await page.screenshot({ path: join(run.evidence, `${base}_f${String(i).padStart(2, "0")}.png`) });
        await sleep(120);
      }
    } else {
      await page.screenshot({ path: join(run.evidence, `${base}.png`) });
    }
    if (process.argv.includes("--hide-self")) await hideSelf(false);
    console.log("shot", base);
  };
  for (const v of VIEWS) if ((v.floor ?? 1) === 1) await shoot(v);
  // round 2 of the interiors: second floor views walk up the stair first (the game's own stair pad + E)
  if (VIEWS.some((v) => v.floor === 2)) {
    const P = places[n];
    await page.evaluate(() => { window.__cvShot = null; });
    await goto(P.upPad.x, P.upPad.z, 0.4);
    await act();
    const up = await waitArea(`house:house_${n}:2`, 15000);
    console.log("house", n, "floor 2", up);
    await coverGone();
    await sleep(2500);
    await page.waitForFunction(() => !document.body.innerText.includes("불러오는 중"), null, { timeout: 30000 }).catch(() => {});
    await sleep(1000);
    for (const v of VIEWS) if (v.floor === 2) await shoot(v);
  }
  const perf = await page.evaluate(() => { const r = window.__cvThree?.().gl?.info?.render; return r ? { calls: r.calls, tris: r.triangles } : null; }).catch(() => null);
  console.log("PERF", JSON.stringify(perf));
  await page.evaluate(() => { window.__cvShot = null; });
}
await browser.close();
process.exit(0);
