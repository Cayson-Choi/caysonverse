/**
 * e2e/map-hitch.mjs — the daytime minimap freeze (release 2 village-hud: the "내 위치" marker did not blink and the compass lagged).
 * Joins at noon (rich tier), opens the map, and records every animation frame's gap for a few seconds, plus the live sun
 * shadows' own counters (__cvSunShadows: cascade redraws, the longest shadow draw). `--sun=off` compares without them (DEV).
 *
 *   CV_CLIENT_URL=http://localhost:5631 node e2e/map-hitch.mjs [--out=<dir>] [--sun=off] [--time=2026-11-03T12:30] [--phone]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";

const arg = (k) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3);
const sunOff = arg("sun") === "off";
const time = arg("time") ?? "2026-11-03T12:30";
const phone = process.argv.includes("--phone");
const run = createRun(`map-hitch${sunOff ? "-sunoff" : ""}`);
const OUT = arg("out") ?? run.evidence;
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
try {
  const p = await openPlayer(browser, run, { tag: "A", device: phone ? PHONE : DESKTOP, settings: { graphics: "high" } });
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(time)}${sunOff ? "&sun=off" : ""}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill("지도" + Math.floor(Math.random() * 90 + 10));
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await sleep(9000);
  const frames = async (ms) =>
    p.page.evaluate(
      (ms) =>
        new Promise((res) => {
          const gaps = [];
          let last = performance.now();
          const t0 = last;
          const tick = (t) => {
            gaps.push(t - last);
            last = t;
            if (t - t0 < ms) requestAnimationFrame(tick);
            else res(gaps);
          };
          requestAnimationFrame(tick);
        }),
      ms,
    );
  const stats = () => p.page.evaluate(() => (window.__cvSunShadows ? window.__cvSunShadows() : null));
  const sum = (g) => {
    const s = [...g].sort((a, b) => a - b);
    return { frames: g.length, median: +s[Math.floor(s.length / 2)].toFixed(1), p95: +s[Math.floor(s.length * 0.95)].toFixed(1), max: +s[s.length - 1].toFixed(1), over100: g.filter((x) => x > 100).length };
  };
  const programs = () => p.page.evaluate(() => {
    const t = window.__cvThree?.();
    const gl = t?.gl ?? t?.renderer;
    return gl?.info ? { programs: gl.info.programs?.length ?? null, textures: gl.info.memory?.textures ?? null, geometries: gl.info.memory?.geometries ?? null } : null;
  });
  const progBefore = await programs();
  const beforeAt = await p.page.evaluate(() => performance.now());
  const before = await stats();
  const walk = sum(await frames(3000));
  // open the map and measure from the press on
  const pressAt = Date.now();
  const during = frames(6000);
  await press(p, p.page.locator('[aria-label="지도 보기"]'));
  const mapGaps = await during;
  const after = await stats();
  const progAfter = await programs();
  // close and open the map again: does it hitch a second time (a one-off compile) or every time?
  await press(p, p.page.locator('[aria-label="지도 보기"]'));
  await sleep(3000);
  const again = frames(5000);
  await press(p, p.page.locator('[aria-label="지도 보기"]'));
  const againGaps = await again;
  await p.page.screenshot({ path: join(OUT, "map.png") });
  const report = {
    sunOff,
    time,
    village: walk,
    mapOpen: sum(mapGaps),
    mapOpenAgain: sum(againGaps),
    programs: { before: progBefore, after: progAfter },
    beforeAt,
    longest: mapGaps
      .map((g, i) => ({ i, g: +g.toFixed(1) }))
      .sort((a, b) => b.g - a.g)
      .slice(0, 6),
    shadowsBefore: before && { nearRenders: before.nearRenders, farRenders: before.farRenders, farSlices: before.farSlices, maxRenderMs: before.maxRenderMs, mask: before.mask },
    shadowsAfter: after && { nearRenders: after.nearRenders, farRenders: after.farRenders, farSlices: after.farSlices, maxRenderMs: after.maxRenderMs, lastRenderMs: after.lastRenderMs, far: after.far, near: after.near },
    pressMs: Date.now() - pressAt,
  };
  writeFileSync(join(OUT, `map-hitch${sunOff ? "-sunoff" : ""}.json`), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 1));
  run.check("map opened without a frame longer than 250 ms", report.mapOpen.max < 250, report.mapOpen);
} finally {
  await browser.close();
}
process.exit(run.finish ? run.finish() : 0);
