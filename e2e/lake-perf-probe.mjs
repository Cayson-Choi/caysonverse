/**
 * e2e/lake-perf-probe.mjs - lake v2 dev probe: 30 mock anglers in a phase on a 4x-throttled phone, frame stats and a CPU profile's
 * top self-time functions (to find what a crowd costs). Not part of the regular sweep.
 *   CV_CLIENT_URL=... node e2e/lake-perf-probe.mjs --phase=9 --device=phone
 */
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
const args = process.argv.slice(2);
const opt = (n, f) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${f}`).slice(n.length + 3);
const device = opt("device", "phone") === "phone" ? PHONE : DESKTOP;
const run = createRun("lake-perf-probe");
run.evidence = process.env.TEMP || ".";
run.allow("X3595", /X3595/);
const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "P", device });
await p.page.goto(`${CLIENT_URL}/?time=2026-11-03T12:30`, { waitUntil: "domcontentloaded" });
await entryReady(p);
await p.page.locator("input.cv-input").first().fill(`프${Math.floor(Math.random() * 900 + 100)}`);
await press(p, p.page.locator(".cv-submit"));
await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
await sleep(1500);
for (const [x, z] of [[40, 0], [80, -9], [100, -12], [118, -12]]) await walkAndWait(p, x, z, 40000, 2);
const cdp = await p.ctx.newCDPSession(p.page);
if (device === PHONE) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await sleep(2000);
console.log("alone", JSON.stringify(await p.page.evaluate(() => window.__cv.getFrameStats(5000))));
await p.page.evaluate(() => {
  const clock = window.__cvLake.clock();
  for (let i = 0; i < 30; i++) window.__cvLake.setView("bot" + i, { rod: 1, spot: i, phase: 5, seq: i + 1, sig: 0, kind: 0, cm: 0, at: clock });
});
await sleep(1500);
console.log("30 waiting", JSON.stringify(await p.page.evaluate(() => window.__cv.getFrameStats(5000))));
const phase = Number(opt("phase", "9"));
await p.page.evaluate((ph) => {
  const clock = window.__cvLake.clock();
  for (let i = 0; i < 30; i++) window.__cvLake.setView("bot" + i, { rod: 1, spot: i, phase: ph, seq: i + 1, sig: 0, kind: 6, cm: 50, at: clock });
}, phase);
await sleep(2000);
const measure = () => p.page.evaluate(() => window.__cv.getFrameStats(5000));
console.log("as is", JSON.stringify(await measure()));
// experiments: the drops hidden; the water's ripples off; the water swapped for a plain material
await p.page.evaluate(() => {
  const t = window.__cvThree();
  t.scene.traverse((o) => { if (o.isPoints) o.visible = false; });
});
console.log("drops hidden", JSON.stringify(await measure()));
await p.page.evaluate(() => {
  const m = window.__cvLakeWater;
  m.uniforms.uHq.value = 0;
});
console.log("+ uHq 0", JSON.stringify(await measure()));
await p.page.evaluate(() => {
  const t = window.__cvThree();
  window.__hidden = [];
  t.scene.traverse((o) => { if (o.material === window.__cvLakeWater) { o.visible = false; window.__hidden.push(o); } });
});
console.log("+ water hidden", JSON.stringify(await measure()));
await cdp.send("Profiler.enable");
await cdp.send("Profiler.start");
const stats = await measure();
const { profile } = await cdp.send("Profiler.stop");
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
profile.samples.forEach((id, i) => {
  const n = byId.get(id);
  const k = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber}`;
  self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000);
});
console.log("phase", phase, JSON.stringify(stats));
console.log([...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, v]) => `${v.toFixed(0).padStart(6)} ms  ${k}`).join("\n"));
await browser.close();
process.exit(0);
