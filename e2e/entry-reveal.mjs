/**
 * e2e/entry-reveal.mjs — 첫 입장 화면이 걷힌 뒤를 본다 (fix/entry-full-load, 2026-11-28). 빈 브라우저 컨텍스트(콜드 캐시)로
 * 입장하기를 누르고, 입장 로딩 화면이 걷힌 때(첫 화면)부터 몇 초 동안:
 *   - "불러오는 중" 알약이 떴는지(.cv-loading이 보이거나 화면 글자에 "불러오는 중"),
 *   - 첫 화면 뒤에 끝난 파일(이름·크기·끝난 때) — 광장에서 보이는 것이 늦게 오는지,
 *   - 긴 프레임(첫 화면 뒤 rAF 간격 > 50 ms) — 처음 그리는 셰이더·텍스처 올리기로 멈칫하는지,
 *   - JS 힙(performance.memory),
 * 그리고 화면 영상(CDP screencast)에서 고른 프레임을 한 장의 띠(strip)로 이어 붙인다.
 *
 *   서버: cd server && PORT=3030 npx tsx src/index.ts
 *   클라: 빌드한 정적 파일(vite preview --port 5630) 또는 개발 서버(vite --port 5630)
 *   CV_CLIENT_URL=http://localhost:5630 node e2e/entry-reveal.mjs [--only=pc|phone] [--tag=before] [--out=<폴더>] [--watch=ms]
 */
import { chromium } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const URL0 = process.env.CV_CLIENT_URL || "http://localhost:5630";
const args = Object.fromEntries(process.argv.slice(2).map((a) => a.replace(/^--/, "").split("=")));
const TAG = args.tag || "run";
const OUT = args.out || "./entry-reveal";
const WATCH_MS = Number(args.watch) || 12000;
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
/** Strip frames: seconds relative to the reveal. */
const STRIP_AT = [-0.6, 0, 0.3, 0.7, 1.2, 2, 3, 5, 8, 11];

async function launch() {
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"] : ["--enable-gpu", "--ignore-gpu-blocklist", "--enable-precise-memory-info"];
  try {
    return await chromium.launch({ headless: true, args: gpu });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome", args: gpu });
  }
}

async function measure(browser, name) {
  const prof = PROFILES[name];
  const dir = join(OUT, `${TAG}-${name}`);
  mkdirSync(dir, { recursive: true });
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
  await page.goto(URL0 + "/?time=" + encodeURIComponent("2026-11-03T12:30"), { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 120000 });
  await page.locator("input.cv-input").first().fill("띠" + Math.floor(Math.random() * 900 + 100));

  // the screencast: every frame, with the page's own clock (performance.now) to line it up with the marks
  const frames = [];
  cdp.on("Page.screencastFrame", async (f) => {
    frames.push({ ts: f.metadata.timestamp, data: f.data });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });

  await page.evaluate((watchMs) => {
    const t0 = performance.now();
    const m = (window.__rev = { t0, wall0: Date.now() / 1000, reveal: null, closing: null, pills: [], steps: [], long: [], heap: [], done: false, maxPct: 0 });
    let last = "";
    let prev = performance.now();
    const raf = () => {
      const t = performance.now();
      if (m.reveal !== null && t - t0 <= m.reveal + watchMs && t - prev > 50) m.long.push({ at: Math.round(t - t0 - m.reveal), ms: Math.round(t - prev) });
      prev = t;
      if (!m.done) requestAnimationFrame(raf);
    };
    requestAnimationFrame(raf);
    const id = setInterval(() => {
      const t = Math.round(performance.now() - t0);
      const loader = document.querySelector("[data-testid='village-loader']");
      const open = !!loader && loader.getAttribute("data-open") === "1";
      const closing = !!loader && loader.classList.contains("is-closing");
      const step = loader?.getAttribute("data-step") ?? "";
      const pct = loader?.getAttribute("data-pct") ?? "";
      const now = loader?.querySelector(".cv-loader-now span")?.textContent ?? "";
      if (pct) m.maxPct = Math.max(m.maxPct, Number(pct));
      const key = `${open}|${closing}|${step}|${pct}|${now}`;
      if (key !== last) {
        m.steps.push({ t, open, closing, step, pct, now });
        last = key;
      }
      if (closing && m.closing === null) m.closing = t;
      const entryGone = !document.querySelector("input.cv-input");
      const veil = document.querySelector(".cv-veg-veil");
      const veilOn = !!veil && (veil.getAttribute("data-covered") === "1" || parseFloat(getComputedStyle(veil).opacity) > 0.5);
      if (m.reveal === null && entryGone && !open && !veilOn && document.querySelector("canvas")) m.reveal = t;
      if (m.reveal !== null) {
        const pillEl = document.querySelector(".cv-loading");
        const pillShown = !!pillEl && !pillEl.hidden && pillEl.getClientRects().length > 0;
        const text = document.body.innerText.includes("불러오는 중");
        if (pillShown || text) m.pills.push({ at: t - m.reveal, el: pillShown, text });
        if (performance.memory && m.heap.length < 400) m.heap.push(Math.round(performance.memory.usedJSHeapSize / 1048576));
        if (t > m.reveal + watchMs) {
          m.done = true;
          clearInterval(id);
        }
      }
    }, 100);
  }, WATCH_MS);
  const wall0 = await page.evaluate(() => performance.timeOrigin / 1000 + window.__rev.t0 / 1000);
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 55, maxWidth: name === "pc" ? 640 : 300, maxHeight: 640, everyNthFrame: 1 });
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => window.__rev.done, null, { timeout: 240000, polling: 500 }).catch(() => {});
  await cdp.send("Page.stopScreencast").catch(() => {});
  const m = await page.evaluate(() => window.__rev);
  const reveal = await page.evaluate(() => window.__cvEntryReveal ?? null);
  const res = await page.evaluate((t0) => {
    return performance
      .getEntriesByType("resource")
      .map((r) => ({
        url: r.name.replace(/^https?:\/\/[^/]+/, "").split("?")[0],
        kb: Math.round((r.encodedBodySize || r.transferSize || 0) / 1024),
        start: Math.round(r.startTime - t0),
        end: Math.round(r.responseEnd - t0),
      }))
      .filter((r) => r.end > 0 && !r.url.startsWith("/@") && !r.url.startsWith("/src/") && !r.url.startsWith("/node_modules/"))
      .sort((a, b) => a.end - b.end);
  }, m.t0);
  const cvMarks = await page.evaluate((t0) => performance.getEntriesByType("mark").filter((x) => x.name.startsWith("cv:")).map((x) => `${x.name}@${Math.round(x.startTime - t0)}`), m.t0);
  await ctx.close();

  // frames -> files at the strip's moments
  const rev = m.reveal ?? 0;
  const picked = [];
  for (const s of STRIP_AT) {
    const want = wall0 + (rev + s * 1000) / 1000;
    let best = null;
    for (const f of frames) if (f.ts <= want + 0.02 && (!best || f.ts > best.ts)) best = f;
    if (!best) continue;
    const file = `f${String(Math.round(s * 1000)).replace("-", "m")}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(best.data, "base64"));
    picked.push({ s, file, lag: Math.round((want - best.ts) * 1000) });
  }
  const afterReveal = res.filter((r) => r.end > rev && r.kb > 0);
  const result = {
    name,
    tag: TAG,
    revealMs: m.reveal,
    closingMs: m.closing,
    maxPct: m.maxPct,
    pills: m.pills,
    long: m.long,
    heapMB: { atReveal: m.heap[0] ?? null, max: m.heap.length ? Math.max(...m.heap) : null, end: m.heap.at(-1) ?? null },
    steps: m.steps,
    cvMarks,
    afterReveal,
    kbAfterReveal: afterReveal.reduce((a, r) => a + r.kb, 0),
    kbBeforeReveal: res.filter((r) => r.end <= rev).reduce((a, r) => a + r.kb, 0),
    frames: picked,
    reveal,
    resources: res,
    errors,
  };
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
  return { result, dir };
}

/** One image: the picked frames side by side, each captioned with its time from the reveal. */
async function strip(browser, dir, result) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 400 } });
  const page = await ctx.newPage();
  const cells = result.frames
    .map((f) => `<figure><img src="data:image/jpeg;base64,${readFileSync(join(dir, f.file)).toString("base64")}"><figcaption>${f.s >= 0 ? "+" : ""}${f.s.toFixed(1)} s</figcaption></figure>`)
    .join("");
  const pills = result.pills.length ? `알약 ${result.pills.length}회 (첫 +${(result.pills[0].at / 1000).toFixed(1)} s)` : "알약 없음";
  const head = `${result.tag} · ${result.name} · 걷힘 ${(result.revealMs / 1000).toFixed(1)} s · ${pills} · 걷힌 뒤 받은 ${result.kbAfterReveal} KB · 긴 프레임 ${result.long.length}개(최대 ${Math.max(0, ...result.long.map((l) => l.ms))} ms)`;
  await page.setContent(
    `<html><body style="margin:0;background:#222;color:#eee;font:14px sans-serif"><div style="padding:6px 8px">${head}</div><div style="display:flex;flex-wrap:wrap;gap:4px;padding:4px">${cells}</div>
     <style>figure{margin:0}img{height:${result.name === "pc" ? 150 : 260}px;display:block}figcaption{text-align:center}</style></body></html>`,
  );
  await page.waitForTimeout(300);
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 1600, height: h });
  const file = join(OUT, `strip-${result.tag}-${result.name}.png`);
  await page.screenshot({ path: file, fullPage: true });
  await ctx.close();
  return file;
}

const browser = await launch();
let bad = 0;
if (args.restrip) {
  for (const name of args.only ? [args.only] : ["pc", "phone"]) {
    const dir = join(OUT, `${TAG}-${name}`);
    console.log(await strip(browser, dir, JSON.parse(readFileSync(join(dir, "result.json"), "utf8"))));
  }
  await browser.close();
  process.exit(0);
}
for (const name of args.only ? [args.only] : ["pc", "phone"]) {
  const { result, dir } = await measure(browser, name);
  const file = await strip(browser, dir, result);
  console.log(`\n== ${TAG} ${name}: 걷힘 ${result.revealMs} ms (닫기 시작 ${result.closingMs}), 최고 ${result.maxPct}%, 알약 ${result.pills.length}회, 걷힌 뒤 ${result.kbAfterReveal} KB / 전 ${result.kbBeforeReveal} KB, 긴 프레임 ${result.long.length}개 ${JSON.stringify(result.long.slice(0, 12))}, 힙 ${JSON.stringify(result.heapMB)}`);
  console.log("   marks:", result.cvMarks.join("  "));
  if (result.reveal) console.log("   reveal:", JSON.stringify(result.reveal));
  for (const s of result.steps) console.log(`   ${String(s.t).padStart(6)} ms  ${s.open ? "열림" : "닫힘"}${s.closing ? "(걷힘)" : ""} ${s.step} ${s.pct}% ${s.now}`);
  for (const r of result.afterReveal) console.log(`   걷힌 뒤 +${r.end - result.revealMs} ms  ${String(r.kb).padStart(6)} KB  ${r.url}`);
  if (result.pills.length) console.log("   알약:", JSON.stringify(result.pills.slice(0, 5)));
  if (result.errors.length) console.log("   errors:", result.errors.slice(0, 5));
  console.log("   띠:", file);
  if (result.pills.length) bad++;
}
await browser.close();
process.exit(bad ? 1 : 0);
