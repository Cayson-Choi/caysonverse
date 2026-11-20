/**
 * e2e/cafe-facade.mjs — the café seen from OUTSIDE, before / after sheets (the facade must not get worse when the café is enterable).
 *
 *   CV_CLIENT_URL=http://localhost:5541 CV_E2E_SLOW=6 node e2e/cafe-facade.mjs --label=after [--out=D:/ClaudeCode/tmpshots/cafe-enter]
 *   (before: the same against a client of origin/main, e.g. the main checkout's vite on another port)
 * Fixed photo cameras (window.__cvShot) at day, dusk and night: the front from the lane, from the plaza side, along the terrace, close
 * on the shop window and on the door.
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const OUT = arg("out", "D:/ClaudeCode/tmpshots/cafe-enter");
const LABEL = arg("label", "after");
mkdirSync(OUT, { recursive: true });
const run = createRun("cafe-facade");
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
await joinVillage(p, "fac", "2026-11-20T12:30");
for (const [x, z] of [[20, -8], [36, -12]]) await walkAndWait(p, x, z, 80000, 1.3);
// the cafe: door at (46.6, -15.1), the terrace to the west (x 40.6..46.6), z -22.6..-7.6
const views = [
  ["front", [34, 2.4, -15.1], [46.6, 2.2, -15.1], 60],
  ["oblique-n", [38, 2.2, -4.5], [46.6, 1.8, -16], 62],
  ["oblique-s", [38, 2.2, -26], [46.6, 1.8, -14], 62],
  ["window", [43.2, 1.5, -18.2], [47, 1.2, -19], 62],
  ["door", [43.6, 1.55, -15.1], [46.7, 1.3, -15.1], 62],
  ["door-low", [44.4, 1.3, -13.6], [47, 1.0, -16.2], 70],
];
for (const [label, t] of [["day", "2026-11-20T12:30"], ["dusk", "2026-11-20T17:00"], ["night", "2026-11-20T22:30"]]) {
  await p.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, t);
  await sleep(3500);
  for (const [n, a, b, fov] of views) {
    await p.page.evaluate(([a, b, fov]) => (window.__cvShot = { x: a[0], y: a[1], z: a[2], tx: b[0], ty: b[1], tz: b[2], fov }), [a, b, fov]);
    await sleep(label === "day" && n === "front" ? 6000 : 2200);
    await p.page.screenshot({ path: `${OUT}/facade-${LABEL}-${label}-${n}.png` });
  }
}
await browser.close();
console.log("done", JSON.stringify(run.errors.slice(0, 4)));
