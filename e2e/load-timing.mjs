/**
 * e2e/load-timing.mjs — 첫 입장 시간 재기 (콜드 캐시). 빈 브라우저 컨텍스트로 입장 화면을 열고 입장하기를 누른 뒤
 *   - 입장 폼이 사라진 때(방 접속 끝), 화면을 가리던 덮개(로딩 화면·식생 덮개)가 모두 걷힌 때(첫 화면)
 *   - 그때까지 받은 파일(이름·크기·시작·끝)과 웹소켓이 열린 때
 * 를 적는다. PC(1280x800, 30 Mbps)와 폰(iPhone 13 375x812, 9 Mbps 4G, CPU 4배 느리게) 두 번.
 *
 *   서버: PORT=3191 npx tsx src/index.ts (server/)
 *   클라: 빌드한 정적 파일을 vite preview 로 (개발 서버는 모듈이 수백 개로 나뉘어 실제와 다름)
 *   CV_CLIENT_URL=http://localhost:5792 node e2e/load-timing.mjs [--only=pc|phone] [--dwell=ms] [--out=파일.json]
 */
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const URL0 = process.env.CV_CLIENT_URL || "http://localhost:5792";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const PROFILES = {
  pc: { device: { viewport: { width: 1280, height: 800 } }, net: { down: 30e6 / 8, up: 10e6 / 8, latency: 20 }, cpu: 1 },
  phone: {
    device: { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3, userAgent: IPHONE_UA },
    net: { down: 9e6 / 8, up: 3e6 / 8, latency: 60 },
    cpu: 4,
  },
};

async function launch() {
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  try {
    return await chromium.launch({ headless: true, args: gpu });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome", args: gpu });
  }
}

async function measure(browser, name) {
  const prof = PROFILES[name];
  const ctx = await browser.newContext(prof.device);
  await ctx.addInitScript(() => {
    try {
      performance.setResourceTimingBufferSize(5000);
      if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
    } catch {}
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: prof.net.latency, downloadThroughput: prof.net.down, uploadThroughput: prof.net.up });
  if (prof.cpu > 1) await cdp.send("Emulation.setCPUThrottlingRate", { rate: prof.cpu });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let wsOpenAt = null;
  page.on("websocket", () => {
    if (wsOpenAt === null) wsOpenAt = Date.now();
  });
  const navAt = Date.now();
  await page.goto(URL0 + "/", { waitUntil: "domcontentloaded" });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 120000 });
  const entryShownMs = Date.now() - navAt;
  await page.locator("input.cv-input").first().fill("재기" + Math.floor(Math.random() * 90 + 10));
  // --dwell=ms: time spent on the entry screen before pressing (picking a look); 0 = press at once (the worst case)
  if (Number(args.dwell) > 0) await page.waitForTimeout(Number(args.dwell));
  // the page's own clock from the press: every 50 ms, which covers are up
  await page.evaluate(() => {
    const t0 = performance.now();
    const marks = (window.__loadMarks = { t0, entered: null, visible: null, steps: [] });
    let last = "";
    const id = setInterval(() => {
      const t = Math.round(performance.now() - t0);
      const entryGone = !document.querySelector("input.cv-input");
      const oldLoading = !!document.querySelector(".cv-loading");
      const veil = document.querySelector(".cv-veg-veil");
      const veilOn = !!veil && (veil.getAttribute("data-covered") === "1" || parseFloat(getComputedStyle(veil).opacity) > 0.5);
      const loader = document.querySelector("[data-testid='village-loader']");
      const loaderOn = !!loader && loader.getAttribute("data-open") === "1";
      const step = loader?.getAttribute("data-step") ?? "";
      const pct = loader?.getAttribute("data-pct") ?? "";
      const key = `${entryGone}|${oldLoading}|${veilOn}|${loaderOn}|${step}|${pct}`;
      if (key !== last) {
        marks.steps.push({ t, entryGone, oldLoading, veilOn, loaderOn, step, pct: loader?.getAttribute("data-pct") ?? null });
        last = key;
      }
      if (entryGone && marks.entered === null) marks.entered = t;
      // the first view: nothing covers the village any more (the old "불러오는 중…" tint was see-through: not a cover)
      if (entryGone && !veilOn && !loaderOn && document.querySelector("canvas")) {
        marks.visible = t;
        clearInterval(id);
      }
    }, 50);
  });
  const pressAt = Date.now();
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => window.__loadMarks.visible !== null, null, { timeout: 180000, polling: 200 }).catch(() => {});
  const marks = await page.evaluate(() => window.__loadMarks);
  const res = await page.evaluate((t0) => {
    return performance
      .getEntriesByType("resource")
      .map((r) => ({
        url: r.name.replace(/^https?:\/\/[^/]+/, "").split("?")[0],
        kb: Math.round((r.encodedBodySize || r.transferSize || 0) / 1024),
        start: Math.round(r.startTime - t0),
        end: Math.round(r.responseEnd - t0),
      }))
      .filter((r) => r.kb > 30)
      .sort((a, b) => a.start - b.start);
  }, marks.t0);
  const cvMarks = await page.evaluate((t0) => performance.getEntriesByType("mark").filter((m) => m.name.startsWith("cv:")).map((m) => `${m.name}@${Math.round(m.startTime - t0)}`), marks.t0);
  const shot = `${process.env.CV_SHOT_DIR ?? "."}/load-${name}.png`;
  await page.screenshot({ path: shot }).catch(() => {});
  await ctx.close();
  const beforeFirst = res.filter((r) => r.end <= (marks.visible ?? 1e9));
  return {
    name,
    entryShownMs,
    wsOpenMs: wsOpenAt === null ? null : wsOpenAt - pressAt,
    enteredMs: marks.entered,
    firstViewMs: marks.visible,
    kbBeforeFirstView: beforeFirst.reduce((a, r) => a + Math.max(0, r.kb), 0),
    steps: marks.steps,
    cvMarks,
    resources: res,
    errors,
  };
}

const browser = await launch();
const out = [];
for (const name of args.only ? [args.only] : ["pc", "phone"]) {
  const r = await measure(browser, name);
  out.push(r);
  console.log(`\n== ${name}: 입장화면 ${r.entryShownMs} ms, 웹소켓 ${r.wsOpenMs} ms, 접속 ${r.enteredMs} ms, 첫 화면 ${r.firstViewMs} ms, 그 전에 받은 ${r.kbBeforeFirstView} KB`);
  console.log("   marks:", r.cvMarks.join("  "));
  for (const s of r.steps) console.log(`   ${String(s.t).padStart(6)} ms  ${JSON.stringify(s)}`);
  for (const f of r.resources) console.log(`   ${String(f.start).padStart(6)}..${String(f.end).padStart(6)} ms ${String(f.kb).padStart(6)} KB ${f.url}`);
  if (r.errors.length) console.log("   errors:", r.errors.slice(0, 5));
}
await browser.close();
if (args.out) writeFileSync(args.out, JSON.stringify(out, null, 2));
