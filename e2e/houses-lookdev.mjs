/**
 * e2e/houses-lookdev.mjs — the A8 house body kit's look-dev shots (X1, 2026-11-16): village_houses.glb with its PBR sets
 * under the village's day / night look (client/dev/houses-lookdev.html, served by the client's vite dev server).
 *   node e2e/houses-lookdev.mjs --url http://127.0.0.1:5695 --out <dir> [--houses 1,2] [--times day,night]
 *        [--views street,wall,window,door,eave] [--device pc|phone|both]
 * PC 1280 x 800, phone 375 x 812 (DPR 2). One page per house and time; the views switch in place (window.__view).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5695" },
    out: { type: "string", default: "houses-lookdev-out" },
    houses: { type: "string", default: "1,2,3,4,5,6,7,8,9,10" },
    times: { type: "string", default: "day,night" },
    views: { type: "string", default: "street,wall,window,door,eave" },
    device: { type: "string", default: "both" },
  },
});
mkdirSync(a.out, { recursive: true });
const devices = {
  pc: { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
let info = null;
for (const dev of a.device === "both" ? ["pc", "phone"] : [a.device]) {
  const ctx = await browser.newContext(devices[dev]);
  for (const h of a.houses.split(",")) {
    for (const t of a.times.split(",")) {
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto(`${a.url}/dev/houses-lookdev.html?house=${h}&time=${t}`);
      await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch((e) => {
        console.log("NOT READY", errors.join(" | "));
        throw e;
      });
      await page.waitForFunction(() => typeof window.__view === "function");
      info ??= await page.evaluate(() => window.__info ?? null);
      for (const v of a.views.split(",")) {
        await page.evaluate((view) => window.__view(view), v);
        await page.waitForTimeout(250);
        const file = join(a.out, `house_${h}_${v}_${t}_${dev}.png`);
        await page.screenshot({ path: file });
        console.log(file, errors.slice(0, 3).join(" | "));
      }
      await page.close();
    }
  }
  await ctx.close();
}
console.log("meshes", Object.keys(info ?? {}).length);
await browser.close();
