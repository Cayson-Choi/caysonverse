/**
 * e2e/lake-live-probe.mjs - one fishing loop as a NORMAL player (no dev hooks: DOM buttons and keys only), for a production
 * build or the live site: enter, the map's "여기로 가기" to the lake, rent, the cue to a free chair, sit, cast, pull at the
 * bite, hold through a fight, then a frame sequence of the catch (reel-in, lift-out, the hug, the show, the release) and every
 * console warning / error ("[lake] ... failed" included).
 *
 *   CV_CLIENT_URL=https://caysonverse.vercel.app node e2e/lake-live-probe.mjs --out=<folder> [--device=pc|phone] [--casts=2]
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, launchBrowser, sleep } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", "lake-live-probe");
const device = opt("device", "pc") === "phone" ? PHONE : DESKTOP;
const CASTS = Number(opt("casts", "2"));
mkdirSync(OUT, { recursive: true });
const log = [];
const note = (s) => {
  log.push(`${new Date().toISOString().slice(11, 19)} ${s}`);
  console.log(s);
};

const browser = await launchBrowser();
const ctx = await browser.newContext({ ...device });
const page = await ctx.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") note(`console.${m.type()}: ${m.text().slice(0, 300)}`);
});
page.on("pageerror", (e) => note(`pageerror: ${e.message}`));
const touch = !!device.hasTouch;
const tap = async (loc) => {
  if (touch) await loc.tap();
  else await loc.click();
};
const bigBtn = () => page.locator(".cv-lake-btn").first();
const bigText = async () => ((await bigBtn().count()) ? ((await bigBtn().textContent()) ?? "").trim() : "");
async function waitBig(re, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const t = await bigText();
    if (re.test(t)) return t;
    await sleep(80);
  }
  return null;
}

await page.goto(`${CLIENT_URL}/`, { waitUntil: "domcontentloaded" });
await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 90000 });
await sleep(1500);
await page.locator("input.cv-input").first().fill(`검${Math.floor(Math.random() * 900 + 100)}`);
await tap(page.locator(".cv-submit"));
await page.waitForSelector("canvas", { timeout: 90000 });
await sleep(12000);
note("entered");
await page.screenshot({ path: join(OUT, "00-village.png") });
// the map, the lake's tag, "여기로 가기"
await page.keyboard.press("KeyM");
await sleep(2500);
const tag = page.locator('[data-map-place="lake"] .cv-map-place-tag');
if (await tag.count()) await tap(tag);
await sleep(600);
const go = page.locator('[data-map-go="lake"]');
if (await go.count()) await tap(go);
else note("no map go button");
note("walking to the lake");
const rent = await waitBig(/낚싯대 빌리기/, 120000);
note(`at the pad: ${rent}`);
await sleep(1500);
await tap(bigBtn());
await sleep(2500);
// off the pad (the cue to a free chair shows away from the rental pad)
const cue = page.locator("[data-lake-cue]");
for (const key of ["KeyW", "KeyS", "KeyA", "KeyD"]) {
  if (await cue.count()) break;
  await page.keyboard.down(key);
  await sleep(1400);
  await page.keyboard.up(key);
  await sleep(700);
}
if (await cue.count()) await tap(cue);
else note("no pier cue");
const sit = await waitBig(/앉아서 낚시/, 90000);
note(`by a chair: ${sit}`);
await tap(bigBtn());
await sleep(4000);
await page.screenshot({ path: join(OUT, "01-seated.png") });
for (let n = 1; n <= CASTS; n++) {
  const c = await waitBig(/던지기/, 20000);
  if (!c) break;
  await page.keyboard.press("Space");
  note(`cast ${n}`);
  const bite = await waitBig(/당겨요/, 40000);
  if (!bite) {
    note("no bite");
    continue;
  }
  await page.keyboard.press("Space"); // at once: the bite window is short (a click waits for the shaking button to settle)
  note("pulled");
  const dir = join(OUT, `c${n}`);
  mkdirSync(dir, { recursive: true });
  const t0 = Date.now();
  let k = 0;
  let holding = false;
  while (Date.now() - t0 < 16000) {
    const t = await bigText();
    if (/꾹 누르고/.test(t) && !holding) {
      holding = true;
      note("a big fish: holding");
      await page.keyboard.down("Space");
    }
    if (holding && !/꾹 누르고/.test(t)) {
      await page.keyboard.up("Space");
      holding = false;
    }
    await page.screenshot({ path: join(dir, `f${String(k++).padStart(3, "0")}.jpg`), type: "jpeg", quality: 70 });
    if (k % 10 === 0) note(`  f${k}: ${t}`);
    if (/던지기/.test(t) && Date.now() - t0 > 4000) break;
  }
  note(`cast ${n}: ${k} frames`);
}
writeFileSync(join(OUT, "log.txt"), log.join("\n"));
await browser.close();
process.exit(0);
