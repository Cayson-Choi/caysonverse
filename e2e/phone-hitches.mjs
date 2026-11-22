/** e2e/phone-hitches.mjs — what stalls the phone profile after the join: timeline of long frames, program links (with their duration and
 *  the material's name) and long tasks, from the first frame to --s seconds. CV_CLIENT_URL=... node e2e/phone-hitches.mjs [--s 30] [--pc] */
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, cdp, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
const { values: a } = parseArgs({ options: { s: { type: "string", default: "30" }, pc: { type: "boolean", default: false }, throttle: { type: "string", default: "4" } } });
const run = createRun("phone-hitches");
run.evidence = "D:/ClaudeCode/tmpshots/phone-perf";
const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: "V", device: a.pc ? DESKTOP : PHONE, settings: a.pc ? {} : { graphics: "low" } });
await p.ctx.addInitScript(() => {
  window.__ev = [];
  const T0 = performance.now();
  for (const C of [WebGLRenderingContext, WebGL2RenderingContext]) {
    const orig = C.prototype.linkProgram;
    C.prototype.linkProgram = function (pr) { const t = performance.now(); const r = orig.call(this, pr); window.__ev.push({ t: Math.round(t - T0), k: "link", ms: Math.round(performance.now() - t) }); return r; };
    const o2 = C.prototype.getProgramParameter;
    C.prototype.getProgramParameter = function (pr, pn) { const t = performance.now(); const r = o2.call(this, pr, pn); const d = performance.now() - t; if (d > 5) window.__ev.push({ t: Math.round(t - T0), k: "getProgParam", ms: Math.round(d) }); return r; };
    const o3 = C.prototype.texSubImage2D;
    C.prototype.texSubImage2D = function (...args) { const t = performance.now(); const r = o3.apply(this, args); const d = performance.now() - t; if (d > 8) window.__ev.push({ t: Math.round(t - T0), k: "texSub", ms: Math.round(d) }); return r; };
    const o4 = C.prototype.texImage2D;
    C.prototype.texImage2D = function (...args) { const t = performance.now(); const r = o4.apply(this, args); const d = performance.now() - t; if (d > 8) window.__ev.push({ t: Math.round(t - T0), k: "texImg", ms: Math.round(d) }); return r; };
  }
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__ev.push({ t: Math.round(e.startTime - T0), k: "longtask", ms: Math.round(e.duration) }); }).observe({ entryTypes: ["longtask"] });
  window.__T0 = T0;
});
await joinVillage(p, "Ph");
const session = await cdp(p);
await walkAndWait(p, 0, 14, 25000, 1.5);
if (Number(a.throttle) > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: Number(a.throttle) });
await p.page.evaluate(() => { window.__ev.push({ t: Math.round(performance.now() - window.__T0), k: "MARK-throttled-on-plaza", ms: 0 }); window.__fr = []; let last = performance.now(); const tick = (now) => { if (now - last > 100) window.__ev.push({ t: Math.round(now - window.__T0), k: "frame", ms: Math.round(now - last) }); last = now; requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
await sleep(Number(a.s) * 1000);
const ev = await p.page.evaluate(() => window.__ev);
ev.sort((x, y) => x.t - y.t);
console.log(ev.filter((e) => e.k !== "link" || e.ms >= 20).map((e) => `${e.t}\t${e.k}\t${e.ms}`).join("\n"));
console.log("links:", ev.filter((e) => e.k === "link").length, "total link ms:", ev.filter((e) => e.k === "link").reduce((s, e) => s + e.ms, 0));
await b.close();
process.exit(0);
