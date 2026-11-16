/**
 * e2e/plants-lookdev.mjs — the plants rebuild's look-dev shots (2026-11-16): the plant atlas, and the plant meshes under
 * the game's vegetation material (client/dev/plants-lookdev.html, served by the client's vite dev server).
 *   node e2e/plants-lookdev.mjs --url http://localhost:5361 --out <dir> [--q "scene=bush&..."] [--name x]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { chromium } from "playwright";

const { values: a } = parseArgs({
  options: {
    url: { type: "string", default: "http://localhost:5361" },
    out: { type: "string", default: "lookdev-out" },
    q: { type: "string", default: "atlas" },
    name: { type: "string", default: "atlas" },
    w: { type: "string", default: "1024" },
    h: { type: "string", default: "1024" },
  },
});
mkdirSync(a.out, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: "chrome", args: ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: +a.w, height: +a.h } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
await page.goto(`${a.url}/dev/plants-lookdev.html?${a.q}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 }).catch((e) => { console.log("NOT READY", errors.join(" | ")); throw e; });
await page.waitForTimeout(400);
const file = join(a.out, `${a.name}.png`);
await page.screenshot({ path: file });
const info = await page.evaluate(() => window.__info ?? null);
console.log(file, JSON.stringify(info), errors.slice(0, 5).join(" | "));
await browser.close();
