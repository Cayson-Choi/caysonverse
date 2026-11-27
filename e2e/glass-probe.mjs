// e2e/glass-probe.mjs — DEV probe (feat/clear-glass): join, hold a lot door open, stand the photo camera, run a page script.
//   CV_CLIENT_URL=http://localhost:5601 node e2e/glass-probe.mjs --door=lot_temple_main --cam=-51.5,1.6,-37,-56,2.2,-37 --js=<file> [--time=12:30] [--shot=<png>]
import { readFileSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { hideHud, joinVillage } from "./lib/village.mjs";
const arg = (k, d) => process.argv.find((x) => x.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const run = createRun("glass-probe");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "pc", device: DESKTOP, settings: { graphics: "high" } });
await joinVillage(P, "prb", `2026-11-16T${arg("time", "12:30")}`);
await P.page.waitForFunction(() => window.__cvLots?.()?.ready, null, { timeout: 120000 }).catch(() => {});
await hideHud(P);
const door = arg("door", "");
if (door) await P.page.evaluate((d) => window.__cvLotsDoor?.(d, 1), door);
const c = arg("cam", "").split(",").map(Number);
if (c.length === 6) await P.page.evaluate((c) => (window.__cvShot = { x: c[0], y: c[1], z: c[2], tx: c[3], ty: c[4], tz: c[5] }), c);
await sleep(Number(arg("wait", "9000")));
const js = arg("js", "");
if (js) console.log(JSON.stringify(await P.page.evaluate(readFileSync(js, "utf8")), null, 1));
const shot = arg("shot", "");
if (shot) await P.page.screenshot({ path: shot });
await browser.close();
process.exit(0);
