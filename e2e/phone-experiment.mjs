/**
 * e2e/phone-experiment.mjs — what does each part of the village cost on the phone profile? Joins, walks to the plaza, throttles 4x,
 * then for each experiment (a JS snippet that hides/changes things, undone afterwards) measures frame stats for --ms.
 *   CV_CLIENT_URL=http://localhost:5981 node e2e/phone-experiment.mjs [--n 0] [--ms 6000] [--only a,b]
 */
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { PHONE, cdp, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const { values: args } = parseArgs({ options: { ms: { type: "string", default: "6000" }, only: { type: "string" }, exp: { type: "string" } } });
const run = createRun("phone-experiment");
run.evidence = "D:/ClaudeCode/tmpshots/phone-perf";
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "V", device: PHONE, settings: { graphics: "low" } });
await joinVillage(p, "Px");
const session = await cdp(p);
await walkAndWait(p, 0, 14, 25000, 1.5);
await sleep(7000);
await session.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await sleep(1500);
const EXPS = {
  base: ``,
  noRender: `const o=gl.render; gl.render=()=>{}; undo=()=>{gl.render=o};`,
  noVeg: `const v=scene.getObjectByName('village_vegetation'); const was=v.visible; v.visible=false; undo=()=>{v.visible=was};`,
  noCreek: `const v=scene.getObjectByName('creek_patch'); const was=v.visible; v.visible=false; undo=()=>{v.visible=was};`,
  noStreet: `const v=scene.getObjectByName('village-street-furniture'); const was=v.visible; v.visible=false; undo=()=>{v.visible=was};`,
  noLakeFlora: `const v=scene.getObjectByName('lake_flora'); const was=v.visible; v.visible=false; undo=()=>{v.visible=was};`,
  noVillageLm: `const l=[]; scene.traverse(o=>{if(/^village_lm_/.test(o.name)&&o.visible){l.push(o);o.visible=false}}); undo=()=>l.forEach(o=>o.visible=true);`,
  tinyView: `const o=gl.getPixelRatio(); gl.setPixelRatio(0.4); undo=()=>gl.setPixelRatio(o);`,
  noMatrixAuto: `scene.matrixWorldAutoUpdate=false; undo=()=>{scene.matrixWorldAutoUpdate=true};`,
};
async function measure(code) {
  await p.page.evaluate((code) => {
    const { gl, scene } = window.__cvThree();
    let undo = () => {};
    eval(code);
    window.__undo = undo;
    window.__fr = [];
    let last = performance.now();
    const tick = (now) => { window.__fr.push(now - last); last = now; window.__frRaf = requestAnimationFrame(tick); };
    window.__frRaf = requestAnimationFrame(tick);
  }, code);
  await sleep(Number(args.ms));
  const r = await p.page.evaluate(() => {
    cancelAnimationFrame(window.__frRaf); window.__undo();
    const fr = window.__fr.slice(3).sort((a, b) => a - b); const q = (x) => fr[Math.min(fr.length - 1, Math.floor(fr.length * x))];
    const trim = fr.slice(0, fr.length - 3); const m = trim.reduce((a, b) => a + b, 0) / trim.length;
    return { n: fr.length, p50: q(0.5), p95: q(0.95), max: fr[fr.length - 1], trimFps: +(1000 / m).toFixed(1) };
  });
  return r;
}
const names = args.only ? args.only.split(",") : Object.keys(EXPS);
for (const k of names) {
  const code = EXPS[k] ?? args.exp;
  console.log(k, JSON.stringify(await measure(code)));
}
await b.close();
process.exit(0);
