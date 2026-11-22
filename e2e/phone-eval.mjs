/** e2e/phone-eval.mjs — join the village on the phone profile, walk to the plaza, evaluate a JS file in the page and print the result.
 *  CV_CLIENT_URL=... node e2e/phone-eval.mjs <file.js> [--device pc]   (the file is an expression/IIFE body using `t = window.__cvThree()`) */
import { readFileSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const file = process.argv[2];
const pc = process.argv.includes("pc");
const run = createRun("phone-eval");
run.evidence = "D:/ClaudeCode/tmpshots/phone-perf";
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "V", device: pc ? DESKTOP : PHONE, settings: pc ? {} : { graphics: "low" } });
await joinVillage(p, "Pe");
await walkAndWait(p, 0, 14, 25000, 1.5);
await sleep(6000);
const code = readFileSync(file, "utf8");
console.log(JSON.stringify(await p.page.evaluate(`(async()=>{const t=window.__cvThree();${code}})()`), null, 1));
await b.close();
process.exit(0);
