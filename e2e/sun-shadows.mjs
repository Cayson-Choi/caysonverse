/**
 * e2e/sun-shadows.mjs — 실제 해 위치와 해를 따라가는 그림자 (docs/designs/sun-shadows).
 *
 *   node e2e/sun-shadows.mjs [high|low] [--device=desktop|phone] [--date=2026-11-16] [--times=07:20,09:00,12:00,15:00,16:40,17:15,21:00]
 *        [--out=<폴더>] [--perf] [--throttle=4]
 *
 * 시각마다 `?time=<날짜>T<시각>`(한국 시각, DEV 고정)으로 들어가서
 *  - 계산한 해의 방위·고도(shared sunClock)와 장면의 그림자 방향(LiveSunShadows의 dir)이 같은지,
 *  - 광장 위 고정 드론 시점(drone-*.png)과 게임 카메라(game-*.png) 사진,
 *  - 그림자 상태(__cvSunShadows: 캐스케이드 다시 그린 횟수, 구운 해 마스크)를 남긴다.
 * `--perf`: 같은 자리에서 그림자 켬/끔 프레임 시간(중앙값, p95)과 메인 스레드 바쁜 시간을 잰다(휴대폰은 CPU 스로틀).
 */
import { join as joinPath } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, cdp, createRun, entryReady, launchBrowser, openPlayer, press, sleep, turnCameraTo } from "./lib/common.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const TIER = args.includes("low") ? "low" : "high";
const DEVICE = opt("device", "desktop");
const DATE = opt("date", "2026-11-16");
const TIMES = opt("times", "07:20,09:00,12:00,15:00,16:40,17:15,21:00").split(",");
const PERF = args.includes("--perf");
const THROTTLE = Number(opt("throttle", DEVICE === "phone" ? "4" : "1"));
const run = createRun(`sun-shadows-${TIER}-${DEVICE}`);
const OUT = opt("out", run.evidence);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });

let nick = 0;
async function join(p, time, extra = "") {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`${DATE}T${time}`)}${extra}`, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`해${++nick}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  const off = extra.includes("sun=off");
  await p.page.waitForFunction((off) => !!window.__cvVillage && !!window.__cvThree && (off || !!window.__cvSunShadows), off, { timeout: 90000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  // the vegetation grows under its cover; the cached maps follow half a second after
  if (!off) await p.page.waitForFunction(() => window.__cvSunShadows().farRenders > 0, null, { timeout: 60000 });
  await sleep(6000);
}

/** The scene drawn from a fixed drone camera over the plaza (same frame at every hour), as a PNG data URL. */
async function drone(p, view) {
  return p.page.evaluate(async (v) => {
    const { gl, scene, camera } = window.__cvThree();
    const cam = camera.clone();
    cam.position.set(v.pos[0], v.pos[1], v.pos[2]);
    cam.up.set(0, 1, 0);
    cam.lookAt(v.at[0], v.at[1], v.at[2]);
    cam.updateMatrixWorld(true);
    cam.aspect = gl.domElement.width / gl.domElement.height;
    cam.updateProjectionMatrix();
    gl.render(scene, cam);
    return gl.domElement.toDataURL("image/png");
  }, view);
}

const VIEWS = {
  // the plaza from the south-west, above (the fountain, the crescent, benches, lamps, trees, the houses behind)
  plaza: { pos: [-26, 22, 30], at: [0, 0, -2] },
  // straight down over the plaza (shadow directions against north-up)
  top: { pos: [0.01, 70, 0.01], at: [0, 0, 0] },
};

const saveDataUrl = (file, url) => writeFileSync(file, Buffer.from(url.split(",")[1], "base64"));

async function frameStats(p, ms) {
  return p.page.evaluate(async (ms) => {
    const times = [];
    let last = performance.now();
    const t0 = last;
    await new Promise((res) => {
      const tick = (now) => {
        times.push(now - last);
        last = now;
        if (now - t0 < ms) requestAnimationFrame(tick);
        else res();
      };
      requestAnimationFrame(tick);
    });
    times.shift();
    times.sort((a, b) => a - b);
    const q = (f) => times[Math.min(times.length - 1, Math.floor(times.length * f))];
    return { frames: times.length, median: q(0.5), p95: q(0.95), mean: times.reduce((a, b) => a + b, 0) / times.length };
  }, ms);
}

async function busy(p, client, ms) {
  const a = await client.send("Performance.getMetrics");
  const f0 = await p.page.evaluate(() => performance.now());
  const fs = await frameStats(p, ms);
  const b = await client.send("Performance.getMetrics");
  const get = (m, n) => m.metrics.find((x) => x.name === n)?.value ?? 0;
  const task = (get(b, "TaskDuration") - get(a, "TaskDuration")) * 1000;
  void f0;
  return { ...fs, busyPerFrame: task / Math.max(1, fs.frames) };
}

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: `${TIER}-${DEVICE}`, device: DEVICE === "phone" ? PHONE : DESKTOP, settings: { graphics: TIER } });
const report = [];
for (const time of TIMES) {
  await run.step(`${DATE} ${time} KST (${TIER}, ${DEVICE})`, async () => {
    await join(p, time);
    const info = await p.page.evaluate(async () => {
      const d = window.__cvDayNight();
      // the real sun (sunClock.sunAt, unclamped) as the day and night carries it
      const v = d.applied.sunDir;
      const sun = { azimuthDeg: ((Math.atan2(v[0], -v[2]) * 180) / Math.PI + 360) % 360, elevationDeg: (Math.asin(v[1]) * 180) / Math.PI };
      const st = window.__cvSunShadows();
      return { sun, shadowDir: st.dir, stats: st, sunDir: d.applied.sunDir, sunDirect: d.applied.sunDirect, golden: d.applied.golden, night: d.applied.night };
    });
    // the shadow direction is the real sun's (above 2 degrees)
    const az = (Math.atan2(info.shadowDir[0], -info.shadowDir[2]) * 180) / Math.PI;
    const el = (Math.asin(info.shadowDir[1]) * 180) / Math.PI;
    const azOk = info.sun.elevationDeg < -2 || Math.abs((((az - info.sun.azimuthDeg) % 360) + 540) % 360 - 180) < 0.6;
    const elOk = info.sun.elevationDeg < -2 || Math.abs(el - Math.max(2, info.sun.elevationDeg)) < 0.6;
    run.check("shadow direction = the real sun's", azOk && elOk, { sunAz: +info.sun.azimuthDeg.toFixed(2), sunEl: +info.sun.elevationDeg.toFixed(2), az: +az.toFixed(2), el: +el.toFixed(2) });
    run.check("the maps are drawn", info.stats.farRenders > 0 && (TIER === "low" || info.stats.nearRenders > 0), { far: info.stats.farRenders, slices: info.stats.farSlices, near: info.stats.nearRenders, maxMs: info.stats.maxRenderMs, mask: info.stats.mask });
    const tag = `${TIER}-${DEVICE}-${time.replace(":", "")}`;
    for (const [name, view] of Object.entries(VIEWS)) saveDataUrl(joinPath(OUT, `drone-${name}-${tag}.png`), await drone(p, view));
    await sleep(500);
    await p.page.screenshot({ path: joinPath(OUT, `game-${tag}.png`) });
    // the game camera across the sunlight (shadows run sideways) and into it (shadows toward the camera)
    const pos = await p.page.evaluate(() => window.__cv.getPos());
    const h = Math.hypot(info.shadowDir[0], info.shadowDir[2]) || 1;
    const sx = info.shadowDir[0] / h;
    const sz = info.shadowDir[2] / h;
    for (const [name, dx, dz] of [["side", -sz, sx], ["into", sx, sz]]) {
      await turnCameraTo(p, pos.x + dx * 20, pos.z + dz * 20).catch(() => {});
      await sleep(1500);
      await p.page.screenshot({ path: joinPath(OUT, `game-${name}-${tag}.png`) });
    }
    report.push({ time, ...info, az, el });
  });
}
if (PERF) {
  await run.step(`frame time with and without the live shadows (${TIER}, ${DEVICE}, throttle ${THROTTLE}x)`, async () => {
    const measure = async (extra) => {
      await join(p, "12:00", extra);
      const client = await cdp(p);
      await client.send("Performance.enable");
      if (THROTTLE > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
      // the vegetation finishes growing and the far cascade settles before the still window
      await sleep(15000);
      const r = await busy(p, client, 12000);
      // walking: the cached near map is redrawn as the spot moves (low)
      await p.page.keyboard.down("KeyW");
      const walking = await busy(p, client, 8000);
      await p.page.keyboard.up("KeyW");
      if (THROTTLE > 1) await client.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      return { still: r, walking };
    };
    const off = await measure("&sun=off");
    const on = await measure("");
    run.check("frame stats measured", on.still.frames > 10 && off.still.frames > 10, { on, off });
    report.push({ perf: { throttle: THROTTLE, on, off } });
  });
}
writeFileSync(joinPath(OUT, `report-${TIER}-${DEVICE}.json`), JSON.stringify(report, null, 1));
await browser.close();
process.exit(run.finish({ report }));
