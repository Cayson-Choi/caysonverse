/**
 * e2e/cam-shots.mjs — free camera shots of the village: --cams='[{"name":"a","x":0,"y":150,"z":0.1,"tx":0,"ty":0,"tz":0,"fov":60}]'
 *   CV_CLIENT_URL=http://localhost:5628 node e2e/cam-shots.mjs --tag=t --out=<folder> --cams=<json or @file>
 */
import { mkdirSync, readFileSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const tag = arg("tag", "x");
const run = createRun("cam-shots");
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const camsArg = arg("cams", "[]");
const cams = JSON.parse(camsArg.startsWith("@") ? readFileSync(camsArg.slice(1), "utf8") : camsArg);
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: "A-pc", device: DESKTOP });
await run.step("join", async () => { await joinVillage(A, "Cs", process.env.TIME ?? "2026-11-03T12:30"); });
await run.step("shots", async () => {
  await A.page.waitForFunction(() => { try { return !!window.__cvLots?.()?.ready; } catch { return false; } }, null, { timeout: 120000 }).catch(() => {});
  await A.page.evaluate(() => window.__cvLotsForce?.(2));
  await sleep(8000);
  for (const c of cams) {
    await A.page.evaluate((c) => { window.__cvShot = { x: c.x, y: c.y, z: c.z, tx: c.tx, ty: c.ty, tz: c.tz, fov: c.fov ?? 55 }; }, c);
    await sleep(c.wait ?? 3000);
    await run.shot(A, `${tag}-${c.name}.png`);
  }
});
const code = run.finish({});
await b.close();
process.exit(code);
