// 케이슨 마을 1단계 Task 10 - 성능·다운로드 예산.
//
//   node e2e/village-perf.mjs --mode assets   # 파일 크기·삼각형·텍스처 한도 (정적, 서버 불필요)
//   node e2e/village-perf.mjs --mode load     # 휴대폰, 프로덕션 번들: 입장 화면 -> 마을 -> 추모관의 첫 접속 바이트
//   node e2e/village-perf.mjs --mode village  # 휴대폰 375x812, 4배 스로틀, low, 20초: 마을(봇 29명 + 측정 탭 = 30명)
//   node e2e/village-perf.mjs --mode hall     # 같은 조건, 추모관 안
//
// 서버·봇(측정 탭이 30번째 사람이 되도록 29봇. docs/loadtest.md 10절):
//   NODE_ENV=production node server/dist/index.cjs                      # :2567 (client/dist도 서빙: load 모드)
//   npm run dev -w client                                              # :5173 (DEV 전용 프레임·렌더 통계 훅: village/hall 모드)
//   npm run loadtest -- --scenario village --numClients 29 --duration 150 --doorShare 0 --statusDir <절대경로>      # village
//   npm run loadtest -- --scenario village --numClients 29 --duration 150 --doorShare 1 --hallStayMs 0 --statusDir <절대경로>  # hall
//
// 게이트(계획 Global Constraints 그대로):
//   village.glb <= 8 MB, <= 260k 삼각형, 텍스처 <= 2048^2 | memorial.glb <= 6 MB, <= 200k 삼각형(인스턴싱 전), 텍스처 <= 2048^2
//   첫 접속(휴대폰, 캐릭터 포함) 총 <= 15 MB | 휴대폰 4x 스로틀 평균 프레임 <= 33 ms (마을 30명, 추모관)
//   헤드리스 수치는 참고용이다(진짜 휴대폰 판정은 발주자 몫): 이 PC의 GPU와 CPU 스로틀 4배로 잰다.
//
// 노브: --ms / CV_PERF_MS (창, 기본 20000), --throttle / CV_PERF_THROTTLE (기본 4), --graphics (low|high, 기본 low),
//       --label (증거 파일 이름 꼬리), CV_CLIENT_URL (village/hall: http://localhost:5173, load: http://localhost:2567).
// 증거 -> .superpowers/sdd/evidence/task-village-perf/ (<mode>-<label>.json).

import { readFileSync, writeFileSync, mkdirSync, statSync, existsSync } from "node:fs";
import { gzipSync, brotliCompressSync, constants as zc } from "node:zlib";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { PHONE, REPO, cdp, createRun, entryReady, launchBrowser, openPlayer, press, r2, sleep, walkAndWait } from "./lib/escape.mjs";

const { values: args } = parseArgs({
  options: { mode: { type: "string", default: "village" }, ms: { type: "string" }, throttle: { type: "string" }, graphics: { type: "string", default: "low" }, label: { type: "string", default: "run" } },
});
if (!["assets", "load", "village", "hall"].includes(args.mode)) {
  console.error("usage: node e2e/village-perf.mjs --mode assets|load|village|hall [--ms 20000] [--throttle 4] [--graphics low|high] [--label x]");
  process.exit(2);
}
const MS = Number(args.ms ?? process.env.CV_PERF_MS ?? 20000);
const THROTTLE = Number(args.throttle ?? process.env.CV_PERF_THROTTLE ?? 4);
const EVID = join(REPO, ".superpowers", "sdd", "evidence", "task-village-perf");
mkdirSync(EVID, { recursive: true });
const MIB = 1048576;
const GATE = {
  village: { bytes: 8 * MIB, tris: 260_000, tex: 2048 },
  memorial: { bytes: 6 * MIB, tris: 200_000, tex: 2048 },
  firstLoadBytes: 15 * MIB,
  meanFrameMs: 33,
};
const run = createRun(`village-perf-${args.mode}`);
run.evidence = EVID;
const { check } = run;
const fmt = (n) => n.toLocaleString("en-US");

// ───────────────────────────── assets: a GLB's size, triangles and texture sizes ─────────────────────────────

function imageSize(buf, mime) {
  if (mime === "image/png") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (mime === "image/webp") {
    const kind = buf.toString("ascii", 12, 16);
    if (kind === "VP8X") return { w: 1 + buf.readUIntLE(24, 3), h: 1 + buf.readUIntLE(27, 3) };
    if (kind === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
    if (kind === "VP8L") {
      const b = buf.readUInt32LE(21);
      return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 };
    }
  }
  if (mime === "image/jpeg") {
    let i = 2;
    while (i < buf.length) {
      if (buf[i] !== 0xff) break;
      const m = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xc3) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
      i += 2 + len;
    }
  }
  return null;
}

/** Parse a .glb: bytes, triangles drawn once per node instance (and with instancing counted once), textures. */
function inspectGlb(path) {
  const buf = readFileSync(path);
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.toString("utf8", 20, 20 + jsonLen));
  const binStart = 20 + jsonLen + 8;
  const meshTris = (m) =>
    m.primitives.reduce((sum, p) => {
      if (p.mode !== undefined && p.mode !== 4) return sum;
      const acc = p.indices !== undefined ? json.accessors[p.indices] : json.accessors[p.attributes.POSITION];
      return sum + Math.floor(acc.count / 3);
    }, 0);
  const uniqueTris = json.meshes.reduce((s, m) => s + meshTris(m), 0);
  let sceneTris = 0; // every instance of an EXT_mesh_gpu_instancing node counted
  let drawnOnceTris = 0;
  let instances = 0;
  let draws = 0;
  for (const n of json.nodes) {
    if (n.mesh === undefined) continue;
    const inst = n.extensions?.EXT_mesh_gpu_instancing;
    const count = inst ? json.accessors[Object.values(inst.attributes)[0]].count : 1;
    if (inst) instances += count;
    sceneTris += meshTris(json.meshes[n.mesh]) * count;
    drawnOnceTris += meshTris(json.meshes[n.mesh]);
    draws += json.meshes[n.mesh].primitives.length;
  }
  const textures = (json.images ?? []).map((img) => {
    const view = json.bufferViews[img.bufferView];
    const data = buf.subarray(binStart + (view.byteOffset ?? 0), binStart + (view.byteOffset ?? 0) + view.byteLength);
    const size = imageSize(data, img.mimeType);
    return { name: img.name ?? img.mimeType, mime: img.mimeType, bytes: view.byteLength, ...size };
  });
  const decodedBytes = textures.reduce((s, t) => s + (t.w && t.h ? Math.round(t.w * t.h * 4 * 1.333) : 0), 0);
  return {
    file: path.replace(REPO, "").replace(/\\/g, "/"),
    bytes: statSync(path).size,
    uniqueMeshTriangles: uniqueTris,
    sceneTriangles: sceneTris,
    trianglesWithoutInstanceMultiplier: drawnOnceTris,
    instancedCopies: instances,
    meshNodes: json.nodes.filter((n) => n.mesh !== undefined).length,
    drawPrimitives: draws,
    textures,
    maxTextureSide: Math.max(0, ...textures.map((t) => Math.max(t.w ?? 0, t.h ?? 0))),
    decodedTextureBytesWithMips: decodedBytes,
    extensions: json.extensionsUsed ?? [],
  };
}

if (args.mode === "assets") {
  const M = join(REPO, "client", "public", "models", "village");
  const out = {};
  for (const [key, file, gate] of [["village", "village.glb", GATE.village], ["memorial", "memorial.glb", GATE.memorial]]) {
    const g = inspectGlb(join(M, file));
    out[key] = g;
    console.log(JSON.stringify({ ...g, textures: g.textures.map((t) => `${t.name} ${t.w}x${t.h} ${t.bytes}B`) }, null, 1));
    check(`${file} <= ${gate.bytes / MIB} MB (${fmt(g.bytes)} B)`, g.bytes <= gate.bytes);
    check(`${file} <= ${fmt(gate.tris)} triangles (scene ${fmt(g.sceneTriangles)}, unique meshes ${fmt(g.uniqueMeshTriangles)})`, g.sceneTriangles <= gate.tris);
    check(`${file} textures <= ${gate.tex}^2 (largest side ${g.maxTextureSide})`, g.maxTextureSide <= gate.tex);
  }
  for (const f of ["memorial_props.glb"]) out[f] = inspectGlb(join(M, f));
  for (const f of ["village_lm.webp", "village_lm_night.webp", "memorial_lm.webp"]) {
    const p = join(M, f);
    const size = imageSize(readFileSync(p), "image/webp");
    out[f] = { bytes: statSync(p).size, ...size };
    check(`${f} <= 2048 per side (${size?.w}x${size?.h})`, size && Math.max(size.w, size.h) <= 2048);
  }
  writeFileSync(join(EVID, `assets-${args.label}.json`), JSON.stringify(out, null, 2));
  process.exit(run.finish({ out }));
}

// ───────────────────────────── load: first-visit bytes through the production bundle ─────────────────────────────

const browser = await launchBrowser();

/** Every request of a tab by CDP, cache off; counts `encodedDataLength` (wire bytes with headers), each URL once (largest). */
async function attachBytes(p, origin) {
  const session = await cdp(p);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", { cacheDisabled: true });
  const reqs = new Map();
  session.on("Network.requestWillBeSent", (ev) => {
    const prev = reqs.get(ev.requestId);
    if (prev && ev.redirectResponse) prev.url = ev.request.url;
    else if (!prev) reqs.set(ev.requestId, { url: ev.request.url, bytes: 0, done: false, at: Date.now() });
  });
  session.on("Network.loadingFinished", (ev) => {
    const r = reqs.get(ev.requestId);
    if (r) Object.assign(r, { bytes: ev.encodedDataLength || 0, done: true });
  });
  const byUrl = () => {
    const m = new Map();
    for (const r of reqs.values()) {
      if (!r.done || r.url.startsWith("data:") || r.url.startsWith("blob:")) continue;
      const key = r.url.startsWith(origin) ? r.url.slice(origin.length).split("?")[0] : r.url;
      m.set(key, Math.max(m.get(key) ?? 0, r.bytes));
    }
    return m;
  };
  return {
    total: () => [...byUrl().values()].reduce((a, b) => a + b, 0),
    list: () => [...byUrl()].map(([url, bytes]) => ({ url, bytes })).sort((a, b) => b.bytes - a.bytes),
  };
}

const groupOf = (u) =>
  /\/models\/character\.glb/.test(u) ? "character.glb" :
  /\/models\/village\/village\.glb/.test(u) ? "village.glb" :
  /village_lm/.test(u) ? "village lightmaps" :
  /\/models\/village\/memorial/.test(u) ? "memorial (glb+props+lm)" :
  /\/audio\//.test(u) ? "BGM mp3" :
  /\/village\/voice\//.test(u) ? "voice clips" :
  /\/village\/sample-photos\//.test(u) ? "photo atlas" :
  /\/draco\//.test(u) ? "draco decoder" :
  /\.js(\?|$)/.test(u) ? "js" : /\.css(\?|$)/.test(u) ? "css" :
  /\/fonts\//.test(u) ? "fonts" : /\/entry\/|\/brand\/|favicon|\.png|\.jpg|\.svg/.test(u) ? "images/entry/brand" : "other";

async function loadMode() {
  const origin = new URL(process.env.CV_CLIENT_URL || "http://localhost:2567").origin;
  const ctxP = await openPlayer(browser, run, { tag: "L", device: PHONE, settings: { graphics: args.graphics } });
  const bytes = await attachBytes(ctxP, origin);
  const marks = [];
  const mark = (name) => {
    const m = { name, total: bytes.total(), requests: bytes.list().length, at: Date.now() - t0 };
    marks.push(m);
    console.log(`   . ${name}: ${fmt(m.total)} B (${(m.total / MIB).toFixed(2)} MiB) in ${m.requests} URLs`);
  };
  const t0 = Date.now();
  await ctxP.page.goto(origin + "/?time=" + encodeURIComponent("2026-11-03T12:30"), { waitUntil: "domcontentloaded" });
  await ctxP.page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 60000 });
  await ctxP.page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  mark("entry screen ready");
  await ctxP.page.locator("input.cv-input").first().fill("용량측정");
  await press(ctxP, ctxP.page.locator(".cv-submit"));
  await ctxP.page.locator(".cv-entry").waitFor({ state: "detached", timeout: 90000 });
  await ctxP.page.locator("canvas").first().waitFor({ state: "visible", timeout: 60000 });
  await ctxP.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 90000 }).catch(() => {});
  await sleep(8000);
  await ctxP.page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  mark("in the village (+8 s, network idle), before any gesture");
  // The first gesture inside the village starts the BGM (preload none, fetched on the first pointer/key press): count it.
  await ctxP.page.keyboard.press("KeyW");
  await sleep(8000);
  await ctxP.page.waitForLoadState("networkidle", { timeout: 60000 }).catch(() => {});
  mark("in the village after the first gesture (BGM fetched)");
  await ctxP.page.screenshot({ path: join(EVID, "load-village.png") }).catch(() => {});
  // The hall: the production page has no test hooks to walk with, so the files the hall mounts are fetched by URL in the same page
  // (cache off, counted like the rest). The list is what a DEV run of --mode hall fetched after the village (see its "fetched by this tab" line).
  const HALL_FILES = ["/models/village/memorial.glb", "/models/village/memorial_lm.webp", "/models/village/memorial_props.glb", "/village/sample-photos/atlas.webp"];
  await ctxP.page.evaluate((urls) => Promise.all(urls.map((u) => fetch(u, { cache: "no-store" }).then((r) => r.arrayBuffer()))), HALL_FILES);
  mark("hall files fetched by URL");
  await ctxP.page.screenshot({ path: join(EVID, "load-hall.png") }).catch(() => {});

  const list = bytes.list();
  const groups = {};
  for (const it of list) groups[groupOf(it.url)] = (groups[groupOf(it.url)] ?? 0) + it.bytes;
  const total = bytes.total();
  const bgm = groups["BGM mp3"] ?? 0;
  console.log(`   total ${fmt(total)} B (${(total / MIB).toFixed(2)} MiB); BGM ${fmt(bgm)} B; without BGM ${fmt(total - bgm)} B`);
  console.log("   by group: " + JSON.stringify(groups));
  for (const it of list.slice(0, 14)) console.log(`      ${String(it.bytes).padStart(9)}  ${it.url}`);
  // The local server (express.static) sends everything uncompressed; the deployed client (Vercel) sends text types (js, css, wasm, html, json,
  // svg) gzip/brotli-compressed. Estimate that: each such file's wire bytes become its gzip -9 size (brotli shown too) + the measured header overhead.
  const TEXT = /\.(js|css|wasm|html|json|svg|mjs)$/;
  let gz = 0, br = 0;
  const compressed = [];
  for (const it of list) {
    const file = join(REPO, "client", "dist", it.url.replace(/^\//, ""));
    if (!TEXT.test(it.url) || !existsSync(file)) { gz += it.bytes; br += it.bytes; continue; }
    const raw = readFileSync(file);
    const over = Math.max(0, it.bytes - raw.length); // headers
    const g = gzipSync(raw, { level: 9 }).length + over;
    const b = brotliCompressSync(raw, { params: { [zc.BROTLI_PARAM_QUALITY]: 9 } }).length + over;
    gz += g; br += b;
    compressed.push({ url: it.url, raw: it.bytes, gzip: g, brotli: b });
  }
  console.log(`   as deployed (text types compressed): gzip ${fmt(gz)} B (${(gz / MIB).toFixed(2)} MiB), brotli ${fmt(br)} B (${(br / MIB).toFixed(2)} MiB); without BGM gzip ${fmt(gz - bgm)} B (${((gz - bgm) / MIB).toFixed(2)} MiB)`);
  check(`first visit (entry -> village -> hall, phone, character + BGM included; as deployed: gzip on text types) <= 15 MiB (${(gz / MIB).toFixed(2)} MiB)`, gz <= GATE.firstLoadBytes);
  // Reference only: the local express server sends everything uncompressed; the gate above is the deployed shape (Vercel compresses text types).
  console.log(`   reference (uncompressed local server): ${(total / MIB).toFixed(2)} MiB with BGM, ${((total - bgm) / MIB).toFixed(2)} MiB without; 15 MiB gate ${total <= GATE.firstLoadBytes ? "met" : "NOT met"} without compression`);
  check(`BGM was part of the measured flow? (${bgm ? "yes" : "no"})`, true, bgm);
  writeFileSync(join(EVID, `load-${args.label}.json`), JSON.stringify({ gate: GATE.firstLoadBytes, gzipTotal: gz, brotliTotal: br, compressed, total, totalMiB: r2(total / MIB), bgm, withoutBgm: total - bgm, marks, groups, list }, null, 2));
}

// ───────────────────────────── village / hall: frame time under a 4x CPU throttle ─────────────────────────────

async function frameMode() {
  const origin = new URL(process.env.CV_CLIENT_URL || "http://localhost:5173").origin;
  const S = await openPlayer(browser, run, { tag: "S", device: PHONE, settings: { graphics: args.graphics } });
  // The asset files this tab fetched (url -> body bytes): the hall's set is read from here (see HALL_FILES in loadMode).
  const fetched = new Map();
  S.page.on("response", async (r) => {
    const u = r.url().replace(origin, "").split("?")[0];
    if (!/^\/(models|audio|draco)\/|^\/village\/(voice|sample-photos)\//.test(u)) return;
    fetched.set(u, (await r.body().catch(() => Buffer.alloc(0))).length);
  });
  await S.page.goto(origin + "/?time=" + encodeURIComponent("2026-11-03T12:30"), { waitUntil: "domcontentloaded" });
  await entryReady(S);
  await S.page.locator("input.cv-input").first().fill("측정" + String(Date.now() % 1000).padStart(3, "0"));
  await press(S, S.page.locator(".cv-submit"));
  await S.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await S.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 });
  await S.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(2500);

  const areaOf = () => S.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
  if (args.mode === "hall") {
    for (const [x, z] of [[-20, 5], [-14, -20], [0, -33], [0, -50.8]]) await walkAndWait(S, x, z, 40000, 1.2);
    await S.page.keyboard.press("KeyE");
    await S.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
    await S.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
    await sleep(2500);
  }
  check(`the measured screen is the ${args.mode === "hall" ? "hall" : "village"}`, (await areaOf()) === (args.mode === "hall" ? "hall" : "village"));

  // wait for the bots (up to 29 remotes in this room)
  const want = Number(process.env.CV_PERF_REMOTES ?? 29);
  await S.page.waitForFunction((n) => window.__cv.getRemotes().length >= n, want, { timeout: 90000 }).catch(() => {});
  if (args.mode === "hall") await sleep(8000); // bots arrive at the door over a while
  const remotes0 = await S.page.evaluate(() => window.__cv.getRemotes().length);
  console.log(`   remotes before measuring: ${remotes0}`);

  const session = await cdp(S);
  await session.send("Performance.enable");
  const metric = async (name) => (await session.send("Performance.getMetrics")).metrics.find((m) => m.name === name)?.value ?? 0;
  const heap = () => metric("JSHeapUsedSize");
  await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await S.page.keyboard.down("KeyZ"); // the camera turns: every view direction is sampled
  await sleep(2500);
  const calls = [], tris = [], texs = [], geoms = [], heaps = [];
  const task0 = await metric("TaskDuration");
  const t0 = Date.now();
  while (Date.now() - t0 < MS) {
    const info = await S.page.evaluate(() => window.__cvRenderInfo?.() ?? null);
    if (info) { calls.push(info.calls); tris.push(info.triangles); texs.push(info.textures); geoms.push(info.geometries); }
    heaps.push(await heap());
    await sleep(1000);
  }
  const taskS = (await metric("TaskDuration")) - task0; // main-thread busy seconds in the window (at the throttle)
  const frames = await S.page.evaluate((w) => window.__cv.getFrameStats(w), MS);
  const remotes = await S.page.evaluate(() => window.__cv.getRemotes().length);
  const area = await areaOf();
  const fetchedList = [...fetched].map(([url, bytes]) => ({ url, bytes }));
  console.log("   fetched by this tab: " + JSON.stringify(fetchedList));
  await S.page.screenshot({ path: join(EVID, `${args.mode}-${args.label}.png`) }).catch(() => {});
  await S.page.keyboard.up("KeyZ");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const avg = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const numbers = {
    mode: args.mode, area, throttle: THROTTLE, windowMs: MS, remotesBefore: remotes0, remotesAfter: remotes,
    frames: frames.frames, meanMs: r2(frames.meanMs), fps: r2(1000 / Math.max(frames.meanMs, 0.001)), p95Ms: r2(frames.p95Ms), maxMs: r2(frames.maxMs),
    busyMsPerFrame: r2((taskS * 1000) / Math.max(1, frames.frames)), mainThreadBusyPct: r2((taskS * 1000 * 100) / (Date.now() - t0)),
    drawCalls: avg(calls) === null ? null : Math.round(avg(calls)), drawCallsMax: Math.max(0, ...calls),
    triangles: avg(tris) === null ? null : Math.round(avg(tris)),
    textures: avg(texs) === null ? null : Math.round(avg(texs)), geometries: avg(geoms) === null ? null : Math.round(avg(geoms)),
    jsHeapMiB: r2(avg(heaps) / MIB), jsHeapMaxMiB: r2(Math.max(0, ...heaps) / MIB), fetched: fetchedList,
  };
  console.log(JSON.stringify(numbers));
  check(`mean frame <= ${GATE.meanFrameMs} ms at ${THROTTLE}x throttle (${numbers.meanMs} ms = ${numbers.fps} fps, p95 ${numbers.p95Ms}, max ${numbers.maxMs})`, numbers.meanMs <= GATE.meanFrameMs && numbers.frames > 20);
  if (args.mode === "village") check(`30 players in the village (remotes ${remotes}, + the measured tab)`, remotes >= 28, remotes);
  else check(`the hall had company (remotes ${remotes})`, remotes >= 1, remotes);
  writeFileSync(join(EVID, `${args.mode}-${args.label}.json`), JSON.stringify({ gate: GATE.meanFrameMs, numbers }, null, 2));
}

try {
  await run.step(args.mode, args.mode === "load" ? loadMode : frameMode);
} finally {
  const exit = run.finish();
  await browser.close();
  process.exit(exit);
}
