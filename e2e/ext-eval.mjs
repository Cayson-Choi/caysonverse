/**
 * e2e/ext-eval.mjs — the exteriors audit's page probe: load the village (lots forced to full detail), then run a JS file's body in the
 * page (an async function body; `return` a JSON-able value) and print the result.
 *   CV_CLIENT_URL=http://localhost:5595 node e2e/ext-eval.mjs <probe.js> [--time=12:30] [--qs=&dress=off]
 */
import { readFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const body = readFileSync(args[0], "utf8");
const run = createRun("ext-eval");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "d", device: DESKTOP, settings: { graphics: "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T${opt("time", "12:30")}${opt("qs", "")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("eval");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 90000 });
await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 180000 });
await P.page.evaluate(() => window.__cvLotsForce?.(2));
await sleep(12000);
const res = await P.page.evaluate(`(async () => { ${body} })()`);
console.log(JSON.stringify(res, null, 1));
await browser.close();
process.exit(0);
