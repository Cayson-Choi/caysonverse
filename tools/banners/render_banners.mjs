// Renders banners.html (the 12 street-banner prints) to banners_raw.png, 3072 x 3072. Then: python print_banners.py.
// Run from the repo root: node tools/banners/render_banners.mjs
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
const here = path.dirname(fileURLToPath(import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 3072, height: 3072 }, deviceScaleFactor: 1 });
await page.goto(pathToFileURL(path.join(here, "banners.html")).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
const ok = await page.evaluate(() => document.fonts.check("40px Jua"));
if (!ok) throw new Error("Jua did not load (art/village/fonts/Jua-Regular.ttf)");
await page.locator("#atlas").screenshot({ path: path.join(here, "banners_raw.png") });
await browser.close();
console.log("wrote", path.join(here, "banners_raw.png"));
