/**
 * e2e/lake-look.mjs - the fishing lake as the client draws it (chunk E): walk from the plaza to the rental pad and along the pier,
 * screenshot the lake by day / dusk / night on a PC and on an iPhone 13 (375x812 touch). Evidence: --out=<folder>.
 *
 *   CV_CLIENT_URL=http://localhost:5571 node e2e/lake-look.mjs --out=<folder> [--device=pc|phone] [--time=2026-11-03T12:30]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-look"));
const device = opt("device", "pc") === "phone" ? PHONE : DESKTOP;
const time = opt("time", "2026-11-03T12:30");
const tag = `${opt("device", "pc")}-${time.slice(11, 13)}`;
const run = createRun("lake-look-" + tag);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });

// baseline of this PC's D3D11 shader compiler (also without the lake: ?nolake): the village's own shaders warn X3595
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "A", device });
await run.step("join the village", async () => {
  await joinVillage(p, "낚", time);
  run.check("joined", true);
});
await run.step("walk to the lake", async () => {
  for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
  const at = await pos(p);
  run.check("at the lake side", at.x > 95, at);
  await sleep(2500);
  await run.shot(p, `${tag}-01-pad.png`);
});
await run.step("the patch and the draw", async () => {
  const patch = await p.page.evaluate(() => window.__cvLakePatch?.() ?? null);
  run.check("village patch took the old lake out", !!patch && patch.trianglesRemoved > 0, patch);
});
await run.step("along the pier", async () => {
  await walkAndWait(p, 125, -12, 40000, 2);
  await sleep(1500);
  await run.shot(p, `${tag}-02-pier.png`);
  await walkAndWait(p, 143, -12, 40000, 2);
  await sleep(1500);
  await run.shot(p, `${tag}-03-tend.png`);
});
const code = run.finish();
await browser.close();
process.exit(code);
