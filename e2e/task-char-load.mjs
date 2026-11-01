// Character stage 3 Task 1 — 첫 접속 바이트 (production bundle).
//
// Standalone Playwright against the PRODUCTION bundle that the local server serves from client/dist:
//
//   npm run build
//   NODE_ENV=production node server/dist/index.cjs        # :2567 (also serves client/dist)
//   node e2e/task-char-load.mjs --baseline                # KayKit baseline  -> load-kaykit.json (record only)
//   node e2e/task-char-load.mjs                           # toy figure       -> load-toy.json    (judges the gates)
//
// What it measures: a brand-new browser context with the HTTP cache disabled (CDP
// `Network.setCacheDisabled`) opens the page, waits until `button.cv-submit` is visible and the network is
// idle, types a nickname into `input.cv-input[placeholder="2~12자"]`, presses the submit button, and waits
// 10 s + networkidle inside the world. Every `Network.loadingFinished.encodedDataLength` (bytes over the wire,
// response headers included) is summed, each distinct URL ONCE (see "numbers" below for why). WebSocket frames are
// not part of it. The entry uses the nickname and `.cv-submit` ONLY (no character / colour clicks: the character picker is replaced in Task 7, and this script is
// re-run unchanged in Task 11), and seeds localStorage `cv-settings-v1` = {"coachDone":true} like the other scripts.
//
// Evidence -> .superpowers/sdd/evidence/task-char/load-<label>.json (label: kaykit with --baseline, toy otherwise).
// Baseline mode records only. The BASELINE JSON (and only it) also carries a PROJECTED toy first-load total (the
// baseline minus what the KayKit characters took, plus the new character.glb and the builder-title logo) to show early
// whether the 8 MB budget is reachable. A toy JSON measures the real thing and has no projection.
//
// Gates (toy only; exit 1 if any fails):
//   total <= 8,388,608 B (design 5.4)
//   /models/character.glb response <= 4,718,592 B (the manifest maxBytes)
//   zero requests for knight|barbarian|mage|rogue|crown .glb
// Exit code 0 = no gate failed and no console/page error and the measurement itself ran.
//
// Knobs: CV_CLIENT_URL (default http://localhost:2567), CV_IDLE_WAIT_MS (the in-world wait, default 10000),
// CV_CHAR_EVIDENCE_DIR (default .superpowers/sdd/evidence/task-char), CV_CHROME_PATH, CV_E2E_RENDER=software.

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const BASELINE = process.argv.includes("--baseline");
const LABEL = BASELINE ? "kaykit" : "toy";
const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:2567";
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
const IN_WORLD_WAIT_MS = Number(process.env.CV_IDLE_WAIT_MS || 10000);
const NICKNAME = "용량측정";
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = process.env.CV_CHAR_EVIDENCE_DIR ? resolve(process.env.CV_CHAR_EVIDENCE_DIR) : join(REPO, ".superpowers", "sdd", "evidence", "task-char");
mkdirSync(EVIDENCE, { recursive: true });

const GATE = {
  totalBytes: 8_388_608, // 8 MiB, design 5.4
  characterGlbBytes: 4_718_592, // manifest maxBytes (controller ruling S2; the plan's 3,145,728 was the old figure)
};
const CHARACTER_GLB_PATH = "/models/character.glb";
const FORBIDDEN_GLB = /\/(?:knight|barbarian|mage|rogue|crown)\.glb(?:[?#]|$)/;
// What the KayKit characters put into the first load and Task 9 deletes: their GLBs and the crown, plus any
// stand-alone texture/bin beside them under /models/ (not furniture, not the new character.glb).
const KAYKIT_GLB = /^\/models\/(?:knight|barbarian|mage|rogue|crown)\.glb$/;
const MODELS_SIDE_FILE = /^\/models\/(?!furniture\/)[^/]+\.(?:png|jpe?g|webp|ktx2|bin)$/i;
// Projection inputs (bytes of the files, measured in the main checkout's art/ folder on 2026-11-01).
const PROJECTION = {
  characterGlbBytes: 4_712_660, // art/character/export/character.glb
  logoPngBytes: 33_553, // art/brand/cayson-logo-white.png (builder title only)
  budgetBytes: 8_388_608,
  earlyWarningBytes: 8_000_000,
};

// ───────────────────────────── tiny harness ─────────────────────────────

const results = [];
const errors = [];
function check(name, ok, detail) {
  const row = { name, ok: !!ok, detail: detail === undefined ? null : detail };
  results.push(row);
  const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${text}`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (n) => n.toLocaleString("en-US");
const mb = (n) => (n / 1048576).toFixed(2);

/** Same launch as the other perf scripts (GPU by default; the installed Chrome when Playwright's own is missing). */
async function launchBrowser() {
  const software = ["--use-gl=angle", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  const args = process.env.CV_E2E_RENDER === "software" ? software : gpu;
  if (process.env.CV_CHROME_PATH) return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  try {
    return await chromium.launch({ headless: true, args });
  } catch {
    return chromium.launch({ headless: true, channel: "chrome", args });
  }
}

function watchErrors(page) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged through the response events below
    errors.push(`console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) errors.push(`local ${r.status()}: ${r.url()}`);
  });
}

/** `/models/x.glb` for the page's own origin, the full URL for anything else. */
function shortUrl(url) {
  try {
    const u = new URL(url);
    return u.origin === CLIENT_ORIGIN ? u.pathname + u.search : url;
  } catch {
    return url;
  }
}

// ─────────────────────────────── the run ───────────────────────────────

const requests = new Map(); // CDP requestId -> { url, status, mime, bytes, finished, failed }
const timeline = []; // { name, ms, bytes, requests } snapshots of the running total
const t0 = Date.now();
const totalSoFar = () => {
  let bytes = 0;
  let count = 0;
  for (const r of requests.values()) {
    if (r.finished) {
      bytes += r.bytes;
      count++;
    }
  }
  return { bytes, count };
};
const mark = (name) => {
  const { bytes, count } = totalSoFar();
  timeline.push({ name, ms: Date.now() - t0, bytes, requests: count });
  console.log(`   · ${name}: ${fmt(bytes)} B in ${count} requests (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
};

const browser = await launchBrowser();
let measurementRan = false;
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
    } catch {
      /* storage blocked: the guide just shows */
    }
  });
  const page = await ctx.newPage();
  watchErrors(page);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.setCacheDisabled", { cacheDisabled: true });

  cdp.on("Network.requestWillBeSent", (ev) => {
    const prev = requests.get(ev.requestId);
    // A redirect re-uses the request id: keep the final URL, the redirect hop carries no counted body.
    if (prev && ev.redirectResponse) prev.url = ev.request.url;
    else if (!prev) requests.set(ev.requestId, { url: ev.request.url, status: 0, mime: "", bytes: 0, finished: false, failed: false });
  });
  cdp.on("Network.responseReceived", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) {
      r.status = ev.response.status;
      r.mime = ev.response.mimeType || "";
    }
  });
  cdp.on("Network.loadingFinished", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) {
      r.bytes = ev.encodedDataLength || 0;
      r.finished = true;
    }
  });
  cdp.on("Network.loadingFailed", (ev) => {
    const r = requests.get(ev.requestId);
    if (r) r.failed = true;
  });

  // 1. open the page -> entry screen ready and quiet
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  await page.locator("button.cv-submit").waitFor({ state: "visible", timeout: 60000 });
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  mark("entry screen ready (submit button visible + networkidle)");

  // 2. nickname + submit only
  await page.locator('input.cv-input[placeholder="2~12자"]').fill(NICKNAME);
  await page.locator("button.cv-submit").click();
  await page.locator(".cv-entry").waitFor({ state: "detached", timeout: 90000 });
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 60000 });
  mark("entered the world (entry screen gone, canvas visible)");

  // 3. wait inside the world, then until the network is quiet again
  await sleep(IN_WORLD_WAIT_MS);
  await page.waitForLoadState("networkidle", { timeout: 60000 });
  mark(`${IN_WORLD_WAIT_MS / 1000} s in the world + networkidle`);
  await page.screenshot({ path: join(EVIDENCE, `load-${LABEL}.png`) });
  measurementRan = true;
} finally {
  await browser.close();
}

// ───────────────────────────── numbers ─────────────────────────────

const allRows = [...requests.values()]
  .filter((r) => r.finished && !r.url.startsWith("data:") && !r.url.startsWith("blob:"))
  .map((r) => ({ url: shortUrl(r.url), bytes: r.bytes, status: r.status, mime: r.mime }));
const failedRows = [...requests.values()].filter((r) => r.failed).map((r) => shortUrl(r.url));
// Every URL counts ONCE (the largest response it got). With the cache switched off for the measurement, a URL the page
// asks for twice is downloaded twice — the gallery photos are (GalleryPhotos loads them from a useMemo that React can
// run twice while the scene suspends), and whether it happens varies from run to run: the raw sum swung by the whole
// 1.78 MB photo set between two identical runs. A real browser serves the second request from its cache, so the judged
// total is the sum over distinct URLs; the raw sum and the repeats stay in the output.
const byUrl = new Map();
for (const r of allRows) {
  const prev = byUrl.get(r.url);
  if (!prev) byUrl.set(r.url, { ...r, requests: 1, repeatBytes: 0 });
  else {
    prev.requests++;
    if (r.bytes > prev.bytes) {
      prev.repeatBytes += prev.bytes;
      Object.assign(prev, { bytes: r.bytes, status: r.status, mime: r.mime });
    } else prev.repeatBytes += r.bytes;
  }
}
const rows = [...byUrl.values()].map(({ requests: n, repeatBytes, ...row }) => ({ ...row, ...(n > 1 ? { requests: n, repeatBytes } : {}) }));
const repeats = rows.filter((r) => r.requests > 1).map((r) => ({ url: r.url, requests: r.requests, repeatBytes: r.repeatBytes }));
const rawTotalBytes = allRows.reduce((s, r) => s + r.bytes, 0);
const totalBytes = rows.reduce((s, r) => s + r.bytes, 0);
const byBytes = rows.slice().sort((a, b) => b.bytes - a.bytes);
const top15 = byBytes.slice(0, 15);
const pathOf = (u) => u.split("?")[0].split("#")[0];
const characterGlb = rows.find((r) => pathOf(r.url) === CHARACTER_GLB_PATH) || null;
const forbidden = rows.filter((r) => FORBIDDEN_GLB.test(r.url));
// Baseline only: what the KayKit characters took (the toy result carries neither this list nor the projection).
const kaykitRemovable = BASELINE ? rows.filter((r) => KAYKIT_GLB.test(pathOf(r.url)) || MODELS_SIDE_FILE.test(pathOf(r.url))) : [];
const kaykitRemovableBytes = kaykitRemovable.reduce((s, r) => s + r.bytes, 0);

console.log(`\n══ 첫 접속 바이트 (${LABEL}) ══`);
console.log(`합계(URL마다 한 번): ${fmt(totalBytes)} B = ${mb(totalBytes)} MiB, 서로 다른 URL ${rows.length}개`);
if (repeats.length > 0) {
  const extra = rawTotalBytes - totalBytes;
  console.log(`  (같은 URL을 두 번 이상 받은 것 ${repeats.length}개, 되풀이 ${fmt(extra)} B는 합계에서 뺐다. 단순 합 ${fmt(rawTotalBytes)} B)`);
  for (const r of repeats) console.log(`    ${r.requests}회  ${fmt(r.repeatBytes)} B 되풀이  ${r.url}`);
}
console.log("상위 15개:");
for (const r of top15) console.log(`  ${String(fmt(r.bytes)).padStart(11)} B  ${r.url}`);
if (BASELINE) {
  console.log(`KayKit 캐릭터가 차지하는 분(Task 9가 지움): ${fmt(kaykitRemovableBytes)} B`);
  for (const r of kaykitRemovable) console.log(`  ${String(fmt(r.bytes)).padStart(11)} B  ${r.url}`);
}

// The projection exists ONLY for the KayKit baseline (it is "baseline - what Task 9 deletes + the new files"); a toy run
// measures the real thing and must not carry a projection or its verdict.
const projectedTotal = totalBytes - kaykitRemovableBytes + PROJECTION.characterGlbBytes + PROJECTION.logoPngBytes;
const projection = !BASELINE ? null : {
  note: "baseline total - KayKit character GLBs/crown/side files (listed) + new character.glb + builder-title logo PNG",
  baselineTotalBytes: totalBytes,
  subtracted: kaykitRemovable.map((r) => ({ url: r.url, bytes: r.bytes })),
  subtractedBytes: kaykitRemovableBytes,
  addedCharacterGlbBytes: PROJECTION.characterGlbBytes,
  addedLogoPngBytes: PROJECTION.logoPngBytes,
  projectedTotalBytes: projectedTotal,
  projectedTotalMiB: Number(mb(projectedTotal)),
  projectedTotalMB: Number((projectedTotal / 1_000_000).toFixed(3)),
  withinGate8MiB: projectedTotal <= PROJECTION.budgetBytes,
  withinEarlyWarning8MB: projectedTotal <= PROJECTION.earlyWarningBytes,
  budgetBytes: PROJECTION.budgetBytes,
  earlyWarningBytes: PROJECTION.earlyWarningBytes,
};
if (BASELINE) {
  console.log(
    `\n예상 toy 첫 접속(투영): ${fmt(projectedTotal)} B = ${mb(projectedTotal)} MiB / ${(projectedTotal / 1e6).toFixed(2)} MB` +
      ` — 게이트 ${fmt(PROJECTION.budgetBytes)} B ${projection.withinGate8MiB ? "이내" : "초과"}, 8.0 MB(십진) 경고선 ${projection.withinEarlyWarning8MB ? "이내" : "초과"}`,
  );
}

check("the measurement ran to the end (entry screen, world entry, 10 s wait)", measurementRan);
check("some bytes were measured", totalBytes > 0, { totalBytes, distinctUrls: rows.length, rawTotalBytes, repeatedUrls: repeats.length });
check("no failed network request", failedRows.length === 0, failedRows.slice(0, 5));
check("no console error or page error", errors.length === 0, errors.slice(0, 5));

if (!BASELINE) {
  check(`GATE total ${fmt(totalBytes)} B <= ${fmt(GATE.totalBytes)}`, totalBytes <= GATE.totalBytes);
  check(
    `GATE ${CHARACTER_GLB_PATH} ${characterGlb ? fmt(characterGlb.bytes) : "missing"} B <= ${fmt(GATE.characterGlbBytes)}`,
    !!characterGlb && characterGlb.bytes <= GATE.characterGlbBytes,
  );
  check("GATE zero requests for knight|barbarian|mage|rogue|crown .glb", forbidden.length === 0, forbidden.map((r) => r.url));
}

const failed = results.filter((r) => !r.ok);
const out = {
  label: LABEL,
  baseline: BASELINE,
  clientUrl: CLIENT_URL,
  nickname: NICKNAME,
  measuredAt: new Date().toISOString(),
  inWorldWaitMs: IN_WORLD_WAIT_MS,
  // Judged total: every distinct URL once. rawTotalBytes is the plain sum of every response (repeats included).
  totalBytes,
  totalMiB: Number(mb(totalBytes)),
  rawTotalBytes,
  repeatBytes: rawTotalBytes - totalBytes,
  repeatedUrls: repeats,
  requestCount: allRows.length,
  distinctUrlCount: rows.length,
  timeline,
  top15,
  characterGlb,
  forbiddenGlbRequests: forbidden,
  // Baseline only: the KayKit bytes Task 9 deletes and the projected toy total built from them.
  ...(BASELINE ? { kaykitCharacterBytes: kaykitRemovableBytes, kaykitCharacterFiles: kaykitRemovable, projection } : {}),
  gates: BASELINE ? null : { ...GATE, forbiddenPattern: String(FORBIDDEN_GLB) },
  allRequests: allRows.slice().sort((a, b) => b.bytes - a.bytes),
  errors,
  results,
  ok: failed.length === 0,
};
writeFileSync(join(EVIDENCE, `load-${LABEL}.json`), JSON.stringify(out, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed -> .superpowers/sdd/evidence/task-char/load-${LABEL}.json`);
for (const f of failed) console.log(`FAIL ${f.name}`);
process.exit(failed.length === 0 ? 0 : 1);
