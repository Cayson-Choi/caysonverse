// Render an SVG to PNG with headless Chromium (playwright): node svg-to-png.mjs <in.svg> <out.png>
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const [inFile, outFile] = process.argv.slice(2);
const svg = fs.readFileSync(inFile, "utf8");
const w = Number(/width="(\d+)"/.exec(svg)[1]);
const h = Number(/height="(\d+)"/.exec(svg)[1]);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.setContent(`<html><body style="margin:0">${svg}</body></html>`);
  await page.screenshot({ path: path.resolve(outFile), type: outFile.endsWith(".jpg") ? "jpeg" : "png", quality: outFile.endsWith(".jpg") ? 88 : undefined });
} finally {
  await browser.close();
}
console.log(`PASS: ${outFile}`);
