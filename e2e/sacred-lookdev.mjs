/**
 * e2e/sacred-lookdev.mjs — B2s/B3s sacred props as the game loads them (GLB + KTX2) in client/dev/sacred-lookdev.html.
 *   node e2e/sacred-lookdev.mjs --url http://localhost:5173 --out <dir> [--items a,b] [--cams close,full,seat] [--tiers pc,phone]
 * One browser, one page reused for every shot. Prints one JSON line per shot (tris, textures, size, errors).
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const ALL = [
  "lotstatue__lot_chapel_nave_mary", "lotstatue__lot_chapel_nave_saint_a", "lotstatue__lot_chapel_nave_saint_b", "lotstatue__lot_chapel_nave_crucifix",
  "lotglass__lot_chapel_nave_glass_lancet_virgin", "lotglass__lot_chapel_nave_glass_lancet_nativity", "lotglass__lot_chapel_nave_glass_lancet_assumption",
  "lotglass__lot_chapel_nave_glass_rose", "lotprop__lot_chapel_nave_station",
  "lotglass__lot_church_nave_glass_church_clear", "lotprop__lot_church_nave_cross",
  "lotstatue__lot_temple_hall_buddha", "lotstatue__lot_temple_hall_bodhisattva", "lotart__lot_temple_hall_taenghwa",
];
const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5173" },
    out: { type: "string", default: "sacred-lookdev-out" },
    items: { type: "string", default: ALL.join(",") },
    cams: { type: "string", default: "close,full,seat" },
    tiers: { type: "string", default: "pc" },
    w: { type: "string", default: "900" },
    h: { type: "string", default: "1100" },
  },
});
mkdirSync(a.out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +a.w, height: +a.h } });
let errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
for (const item of a.items.split(",")) for (const tier of a.tiers.split(",")) for (const cam of a.cams.split(",")) {
  errors = [];
  if (tier === "phone" && item.startsWith("lotprop")) continue;
  await page.goto(`${a.url}/dev/sacred-lookdev.html?item=${item}&cam=${cam}&tier=${tier}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 }).catch(() => errors.push("NOT READY"));
  await page.waitForTimeout(300);
  const file = join(a.out, `${item}_${tier}_${cam}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => window.__info ?? null);
  console.log(JSON.stringify({ file, info, errors: errors.slice(0, 3) }));
}
await browser.close();
