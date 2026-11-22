import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";
const OUT = "D:/ClaudeCode/tmpshots/cafe-enter";
mkdirSync(OUT, { recursive: true });
const tag = process.argv[2] ?? "pc";
const time = process.argv[3] ?? "2026-11-20T12:30";
const label = process.argv[4] ?? "day";
const run = createRun("cafe-look");
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device: tag === "phone" ? PHONE : DESKTOP, settings: { graphics: tag === "phone" ? "low" : "high" } });
await joinVillage(p, "cl", time);
// to the door: the plaza's road east
for (const [x, z] of [[20, -8], [36, -12], [42, -15.1], [45.4, -15.1]]) await walkAndWait(p, x, z, 60000, 1.2);
await p.page.waitForFunction(() => window.__cvCafeReady?.(), null, { timeout: 300000 });
await act(p);
await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea().startsWith("lot:"), null, { timeout: 30000 });
await p.page.waitForFunction(() => !!window.__cvLotRoom?.(), null, { timeout: 240000 });
await sleep(4000);
const O = { x: 560, z: 40 };
const shots = [
  ["door-in", [6.8, 1.65, 0.45], [6.8, 1.5, 7]],
  ["corner-r", [13.2, 2.7, 0.5], [4, 1.2, 6]],
  ["corner-l", [0.4, 2.7, 0.5], [10, 1.2, 6]],
  ["windows", [6.8, 1.6, 5.5], [6.8, 1.7, 0]],
  ["counter", [5, 1.7, 3.2], [9.5, 1.0, 6]],
  ["banquette", [8.5, 1.6, 2.5], [13.5, 0.8, 2.3]],
  ["tables", [12, 2.2, 5], [3, 0.8, 3]],
  ["ceiling", [6.8, 1.2, 4], [6.8, 4.0, 6]],
];
const times = { day: "2026-11-20T12:30", dusk: "2026-11-20T17:00", night: "2026-11-20T22:30" };
for (const [tl, tv] of Object.entries(times)) {
  await p.page.evaluate(async (t) => {
    const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
    villageClock.pin(pinFromSearch("?time=" + t));
    (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
  }, tv);
  await sleep(3500);
  for (const [n, a, b] of shots) {
    if (tl !== "day" && !["door-in", "windows", "counter", "banquette"].includes(n)) continue;
    await p.page.evaluate(([a, b, O]) => { window.__cvShot = { x: O.x + a[0], y: a[1], z: O.z + a[2], tx: O.x + b[0], ty: b[1], tz: O.z + b[2], fov: 70 }; }, [a, b, O]);
    await sleep(2200);
    await p.page.screenshot({ path: `${OUT}/${tag}-${tl}-${n}.png` });
  }
}
console.log("room", JSON.stringify(await p.page.evaluate(() => window.__cvLotRoom())));
await browser.close();
console.log("errors", JSON.stringify(run.errors.slice(0, 5)));
