/** node e2e/zz-bush-dump.mjs <out.json>: the village's drawn bushes (DEV hook __cvBushList) */
import { writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
const run = createRun("bush-dump");
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: "dump", device: DESKTOP, settings: { graphics: "high" } });
await P.page.goto(`${CLIENT_URL}/?time=2026-11-16T12:30`, { waitUntil: "domcontentloaded" });
await entryReady(P);
await P.page.locator("input.cv-input").first().fill("dump");
await press(P, P.page.locator(".cv-submit"));
await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
await P.page.waitForFunction(() => !!window.__cvBushList?.village, null, { timeout: 120000 });
const list = await P.page.evaluate(() => window.__cvBushList);
writeFileSync(process.argv[2], JSON.stringify(list));
console.log(Object.entries(list).map(([k, v]) => `${k}: ${v.length}`).join(" "));
await browser.close();
process.exit(0);
