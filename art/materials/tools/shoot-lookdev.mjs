/**
 * Screenshots of the PBR lookdev page (client/dev/pbr-lookdev.html) for review.
 *   node art/materials/tools/shoot-lookdev.mjs --url http://localhost:5697 --out <dir> [--shots overview|close|all] [--only id,id]
 * Needs the client's vite dev server running (npm run dev -w client -- --port 5697).
 * Writes <out>/<name>.png and <out>/report.json (every set's load result: colour spaces, GPU formats, sizes, mips).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5697" },
    out: { type: "string", default: "pbr-lookdev-out" },
    shots: { type: "string", default: "all" },
    only: { type: "string", default: "" },
    tier: { type: "string", default: "2k" },
  },
});
mkdirSync(a.out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const report = {};

async function shoot(name, query, w = 1600, h = 1000) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await page.goto(`${a.url}/dev/pbr-lookdev.html?${query}`);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 }).catch((e) => {
    console.log("NOT READY", name, errors.join(" | "));
    throw e;
  });
  await page.waitForTimeout(300);
  const file = join(a.out, `${name}.png`);
  await page.screenshot({ path: file });
  const info = await page.evaluate(() => window.__info ?? null);
  const gl = await page.evaluate(() => {
    const c = document.createElement("canvas").getContext("webgl2");
    const d = c?.getExtension("WEBGL_debug_renderer_info");
    return d ? c.getParameter(d.UNMASKED_RENDERER_WEBGL) : null;
  });
  report[name] = { query, info, gl, errors };
  console.log(file, info?.ms, "ms", errors.slice(0, 3).join(" | "));
  await page.close();
}

const tier = a.tier;
if (a.shots === "overview" || a.shots === "all") {
  for (const time of ["day", "night"]) {
    for (const g of [["ground", "stone"], ["exterior"], ["interior", "wood", "metal", "fabric"]]) {
      await shoot(`overview_${tier}_${time}_${g[0]}`, `tier=${tier}&time=${time}&group=${g.join(",")}`);
    }
  }
  await shoot(`overview_${tier}_day_ground_noenv`, `tier=${tier}&time=day&env=none&group=ground,stone`);
}
if (a.shots === "close" || a.shots === "all") {
  const ids = a.only
    ? a.only.split(",")
    : (await (async () => {
        const page = await browser.newPage();
        await page.goto(`${a.url}/dev/pbr-lookdev.html?group=none`);
        await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
        const m = await page.evaluate(async () => (await import("/src/village/pbr/pbrManifest.generated.ts")).PBR_SETS.map((s) => s.id));
        await page.close();
        return m;
      })());
  for (const id of ids) await shoot(`close_${tier}_day_${id}`, `tier=${tier}&time=day&set=${id}&cam=close`, 1280, 800);
}
writeFileSync(join(a.out, `report_${tier}_${a.shots}.json`), JSON.stringify(report, null, 2));
await browser.close();
