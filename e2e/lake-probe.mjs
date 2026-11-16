/**
 * e2e/lake-probe.mjs - a look into the running scene for the lake's integration (F): runs one JS snippet in a joined village page
 * (window.__cvThree gives the scene) and prints its JSON. Optional camera shot.
 *
 *   CV_CLIENT_URL=http://localhost:5621 node e2e/lake-probe.mjs --js=<file.js> [--at=x,z] [--time=...] [--shot=<png>] [--device=pc|phone]
 */
import { readFileSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const run = createRun("lake-probe");
run.allow("any", /./);
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "A", device: opt("device", "pc") === "phone" ? PHONE : DESKTOP });
await joinVillage(p, "탐", opt("time", "2026-11-03T12:00"));
const at = opt("at", "");
if (at) {
  const [x, z] = at.split(",").map(Number);
  for (const [wx, wz] of [[40, 0], [80, -9], [100, -12]]) if (x > wx - 5) await walkAndWait(p, wx, wz, 40000, 2);
  await walkAndWait(p, x, z, 40000, 1);
}
await sleep(Number(opt("wait", "6000")));
const js = opt("js", "");
if (js) {
  const out = await p.page.evaluate(readFileSync(js, "utf8"));
  console.log(JSON.stringify(out, null, 1));
}
const shot = opt("shot", "");
if (shot) await p.page.screenshot({ path: shot });
await browser.close();
process.exit(0);
