/**
 * e2e/cafe-real-shots.mjs — 케이슨 카페 사진 (owner 2026-11-21: "추모관 수준으로 아주 사실적이고 디테일하게", the facade's glass, the 2nd floor):
 * fixed photo cameras in the café, the salon upstairs and outside the facade, PC (graphics high) or phone (low), day / dusk / night.
 *
 *   CV_CLIENT_URL=http://localhost:5561 CV_E2E_SLOW=6 node e2e/cafe-real-shots.mjs [--phone] [--out=<folder>] [--only=facade,inside,up] [--times=day,dusk,night] [--prefix=after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, waitIdle } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const phone = process.argv.includes("--phone");
const OUT = arg("out", "D:/ClaudeCode/tmpshots/cafe-real/shots");
const ONLY = arg("only", "facade,inside,up").split(",");
const TIMES = arg("times", "day,dusk,night").split(",");
const PREFIX = arg("prefix", "after");
mkdirSync(OUT, { recursive: true });
const run = createRun("cafe-real-shots");
const T = { day: "2026-11-21T12:30", dusk: "2026-11-21T17:00", night: "2026-11-21T22:30" };
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
const tag = phone ? "phone" : "pc";
const numbers = {};

async function walkAndWait(p, x, z, ms = 30000, tol = 0.8) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const at = window.__cv.getPos();
      const via = plan.findDetour(at.x, at.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(400);
    await waitIdle(p, ms);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
    await sleep(600);
  }
  return pos(p);
}
const shared = (p, code) => p.page.evaluate(new Function(`return (async () => { const L = await window.__imp("/shared/src/village/villageLots.ts"); ${code} })()`));
const hideHud = (p) => p.page.addStyleTag({ content: "body > *:not(canvas):not(div:has(canvas)) { visibility: hidden !important; } .cv-hud, .cv-action-btn, .cv-chat, [class*='cv-'] { visibility: hidden !important; } canvas { visibility: visible !important; }" }).catch(() => {});
const setTime = (p, t) =>
  p.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, t);
const cam = async (p, a, b, name, fov = 62) => {
  await p.page.evaluate(([a, b, fov]) => (window.__cvShot = { x: a[0], y: a[1], z: a[2], tx: b[0], ty: b[1], tz: b[2], fov }), [a, b, fov]);
  await sleep(2600);
  await p.page.screenshot({ path: join(OUT, `${PREFIX}-${tag}-${name}.png`) });
  await p.page.evaluate(() => (window.__cvShot = null));
};
const roomCam = async (p, a, b, name, fov) => {
  const o = await p.page.evaluate(() => window.__cvLotRoom().origin);
  await cam(p, [o.x + a[0], a[1], o.z + a[2]], [o.x + b[0], b[1], o.z + b[2]], name, fov);
};
const area = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const waitArea = async (p, a, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await area(p)) === a) return true;
    await sleep(500);
  }
  return false;
};
const waitRoom = (p, unit, ms = 240000) => p.page.waitForFunction((u) => window.__cvLotRoom?.()?.unit === u, unit, { timeout: ms }).then(() => true, () => false);

// the café in the village frame (cafeRoom.ts: local x = right seen from the front, z toward the door; door side west)
const C = { x: 50.6, z: -15.1 };
const W = (lx, y, lz) => [C.x - lz, y, C.z + lx];

try {
  await joinVillage(P, `kafeShot${tag}`, T.day);
  await hideHud(P);
  const d = await shared(P, `const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotDoorPoint(r.lot, r.door);`);
  for (const [x, z] of [[20, -8], [36, -12], [40.5, -15.1]]) await walkAndWait(P, x, z, 80000, 1.3);
  await sleep(6000);
  if (ONLY.includes("facade")) {
    for (const t of TIMES) {
      await setTime(P, T[t]);
      await sleep(4000);
      if (t === "day") numbers.facade = await P.page.evaluate(() => window.__cvCafeFacade?.());
      await cam(P, W(0, 3.2, 17), W(0, 4.4, 3.8), `facade-${t}-front`, 58);
      await cam(P, W(-9, 2.2, 12), W(-1, 3.0, 3.8), `facade-${t}-oblique`, 58);
      await cam(P, W(3.4, 1.7, 7.2), W(3.4, 1.7, 3.8), `facade-${t}-glass`, 58);
      await cam(P, W(-3.5, 1.7, 6.2), W(-3.5, 1.5, 0.0), `facade-${t}-glass-in`, 55);
      await cam(P, W(2.0, 3.0, 9.0), W(1.8, 6.4, 3.8), `facade-${t}-upper`, 50);
      await cam(P, W(13, 2.4, 1.0), W(6.9, 4.5, -2.5), `facade-${t}-side`, 60);
    }
    await setTime(P, T.day);
  }
  if (ONLY.includes("inside") || ONLY.includes("up")) {
    await walkAndWait(P, d.pad.x - 0.6, d.pad.z, 60000, 0.9);
    await sleep(1000);
    await act(P);
    numbers.in = await waitArea(P, "lot:lot_cafe_room");
    await waitRoom(P, "lot_cafe_room");
    await sleep(4000);
    numbers.room = await P.page.evaluate(() => window.__cvLotRoom());
  }
  if (ONLY.includes("inside")) {
    const views = [
      ["door", [6.8, 1.6, 0.5], [8.0, 1.4, 7.0], 66],
      ["owner-frame", [12.6, 1.55, 1.3], [5.0, 1.6, 6.8], 74],
      ["counter", [8.6, 1.5, 3.6], [8.6, 1.25, 6.5], 60],
      ["machine", [9.5, 1.35, 6.45], [9.5, 1.22, 7.5], 46],
      ["case", [8.2, 1.42, 4.6], [8.2, 1.2, 5.8], 48],
      ["sign", [9.2, 2.3, 3.4], [9.2, 3.55, 7.8], 52],
      ["tables", [12.6, 1.7, 4.6], [3.5, 0.9, 2.0], 66],
      ["banquette", [10.0, 1.4, 1.0], [13.4, 0.8, 2.6], 62],
      ["stair", [5.2, 1.6, 1.6], [1.0, 2.3, 6.0], 66],
    ];
    for (const t of TIMES) {
      await setTime(P, T[t]);
      await sleep(4000);
      for (const [n, a, b, fov] of views) if (t === "day" || ["door", "owner-frame", "tables", "counter"].includes(n)) await roomCam(P, a, b, `in-${t}-${n}`, fov);
    }
    await setTime(P, T.day);
  }
  if (ONLY.includes("up")) {
    const st = await shared(P, `const r = L.lotRoomOf("lot:lot_cafe_room"); return L.lotRoomStair(r).pad;`);
    await walkAndWait(P, st.x, st.z - 0.3, 40000, 0.5);
    await sleep(800);
    await act(P);
    numbers.up = await waitArea(P, "lot:lot_cafe_upstairs");
    await waitRoom(P, "lot_cafe_upstairs");
    await sleep(4000);
    numbers.upRoom = await P.page.evaluate(() => window.__cvLotRoom());
    const views = [
      ["stairtop", [2.4, 1.6, 2.2], [9.0, 1.2, 9.0], 68],
      ["front-windows", [7.0, 1.6, 8.5], [7.0, 1.6, 0.0], 66],
      ["sofa", [7.5, 1.5, 4.8], [13.4, 0.8, 5.0], 62],
      ["sideboard", [6.3, 1.5, 9.6], [6.3, 1.0, 13.0], 60],
      ["well", [3.2, 1.7, 3.0], [1.0, -1.6, 6.0], 66],
    ];
    for (const t of TIMES) {
      await setTime(P, T[t]);
      await sleep(4000);
      for (const [n, a, b, fov] of views) if (t === "day" || ["stairtop", "front-windows"].includes(n)) await roomCam(P, a, b, `up-${t}-${n}`, fov);
    }
  }
} catch (err) {
  console.error("run error", err);
  run.check("run completed without an exception", false, String(err).slice(0, 300));
} finally {
  writeFileSync(join(OUT, `${PREFIX}-${tag}-numbers.json`), JSON.stringify(numbers, null, 1));
  await run.finish?.();
  await browser.close();
  if (run.errors.length) console.log("page errors:", JSON.stringify(run.errors.slice(0, 8)));
  console.log(JSON.stringify(numbers).slice(0, 1500));
}
