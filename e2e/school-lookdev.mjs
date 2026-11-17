/**
 * e2e/school-lookdev.mjs — B1 look-dev shots (lots v2, 2026-11-17): the school (outside and its classroom) with the game's
 * KTX2 PBR sets, PC (1600x1000, 2K sets) and phone (390x844 @2x, 1K sets), day and night (client/dev/school-lookdev.html).
 *   node e2e/school-lookdev.mjs --url http://localhost:5710 --out <dir> [--models lot_school,lot_school_class] [--views a,b]
 * Writes <out>/<model>_<view>_<pc|phone>_<day|night>.png and <out>/report.json (triangles, sets, GPU memory, errors).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

export async function shootLookdev(page0, defaults) {
  const { values: a } = parseArgs({
    options: {
      url: { type: "string", default: "http://localhost:5710" },
      out: { type: "string", default: "lookdev-out" },
      models: { type: "string", default: defaults.models },
      views: { type: "string", default: "" },
      times: { type: "string", default: "day,night" },
      devices: { type: "string", default: "pc,phone" },
    },
  });
  mkdirSync(a.out, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
  const report = {};
  for (const model of a.models.split(",")) {
    const views = a.views ? a.views.split(",") : defaults.views[model];
    for (const dev of a.devices.split(",")) {
      for (const time of a.times.split(",")) {
        for (const view of views) {
          const phone = dev === "phone";
          const page = await browser.newPage(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 } : { viewport: { width: 1600, height: 1000 } });
          const errors = [];
          page.on("pageerror", (e) => errors.push(e.message));
          page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
          const q = `model=${model}&time=${time}&tier=${phone ? "1k" : "2k"}&view=${view}`;
          await page.goto(`${a.url}/dev/${page0}?${q}`);
          await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }).catch(() => console.log("NOT READY", q, errors.join(" | ")));
          await page.waitForTimeout(400);
          const name = `${model}_${view}_${dev}_${time}`;
          await page.screenshot({ path: join(a.out, `${name}.png`) });
          report[name] = { q, info: await page.evaluate(() => window.__info ?? null), errors };
          console.log(name, errors.slice(0, 2).join(" | "));
          await page.close();
        }
      }
    }
  }
  writeFileSync(join(a.out, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
}

if ((process.argv[1] ?? "").split(/[\\/]/).pop() === "school-lookdev.mjs") {
  await shootLookdev("school-lookdev.html", {
    models: "lot_school,lot_school_class",
    views: { lot_school: ["street", "entrance", "playground", "clock", "window"], lot_school_class: ["entry", "board", "seat", "corridor"] },
  });
}
