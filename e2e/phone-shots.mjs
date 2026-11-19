/** e2e/phone-shots.mjs — the plaza overview {30,40,60 -> 0,0,0} on PC and phone, for before/after. CV_CLIENT_URL=... node e2e/phone-shots.mjs <label> */
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const label = process.argv[2] ?? "shot";
const b = await launchBrowser();
for (const [name, dev, st] of [["pc", DESKTOP, {}], ["phone", PHONE, { graphics: "low" }]]) {
  const run = createRun("phone-shots");
  const p = await openPlayer(b, run, { tag: "V", device: dev, settings: st });
  await joinVillage(p, "Ps");
  await walkAndWait(p, 0, 14, 25000, 1.5);
  await sleep(6000);
  for (const [k, pose] of [["overview", { x: 30, y: 40, z: 60, tx: 0, ty: 0, tz: 0 }], ["door", { x: 0, y: 3, z: -42, tx: 0, ty: 1.5, tz: -52 }]]) {
    await p.page.evaluate((s) => { window.__cvShot = s; }, pose);
    await sleep(2500);
    await p.page.screenshot({ path: `D:/ClaudeCode/tmpshots/phone-perf/shot-${label}-${name}-${k}.png` });
  }
  await p.ctx.close();
}
await b.close();
process.exit(0);
