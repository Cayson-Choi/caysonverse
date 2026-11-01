// Character stage 3 Task 10 E2E — 캐릭터 조립실 → 입장 → 다른 화면에서 같은 외형.
//
// Standalone Playwright against the dev stack (server :2567, client :5173):
//   npm run dev
//   node e2e/task-char-builder.mjs              # CV_CLIENT_URL=http://localhost:5173 by default
//
// Desktop (1280×800; A, B, C, D, E are separate browser contexts):
//   1  entry screen: preview canvas visible, preview.parts == the default look's 7 parts, no body__torso
//   2  preset 기사: helmet/armor/tall boots/wooden sword, no hair__* mesh (the helmet hides hair)
//   3  hair 포니테일 under the helmet → still no hair mesh (Ruling S3); hat 캡모자 → hair__ponytail__hat;
//      hat 없음 → hair__ponytail, no __hat variant
//   4  웃옷 swatches 흰색 / 남색: aria-pressed follows, parts unchanged, the look key (colour) changes
//   5  hat 왕관 / 티아라 → swatch 금색 pressed (their default colour), from a non-gold start
//   6  render sheets through the game renderer (setYaw before every shot — presets/🎲 spin 500 ms):
//      presets ×8 (front/back), 🎲 ×30 (drawMeshes ≤ 8, voice unchanged, parts changed ≥ 25),
//      coverage set of 13 looks where look i wears option (i mod n) in every slot (Ruling S9),
//      helmet sheet (knight/space helmet × 5 hairs, no hair mesh), every other hat × 5 hairs (hat-variant hair),
//      pose sheet via __cvPreview.setClip: idle / walk ×2 / run / jump / sit for all 8 presets, plus side rows
//      for 공주 (longskirt) and 요정 (petal_skirt); the resolved clip names are checked against manifest clipVariants;
//      every shot is checked to show the figure (against the bare background art).
//      Sheets: builder-{presets,random,coverage,poses,helmet,hats}-sheet.png
//   7  voice 여자 목소리 → aria-checked
//   8  mouse drag 200 px across the preview → yaw +2.0 ± 0.2
//   (S8) preset 기사 pressed again right before entering, so A's motion row is the deterministic pants control
//   9  A enters as 조립A (own parts == preview parts just before); B enters as 조립B with the default look;
//      B: A's synced appearance == A's localStorage cv.entry, B's parts of A == A's own, every entry drawMeshes ≤ 8
//   10 A chats "안녕 조립실" (task-ux-desktop step-6 routine) → B's /api/npc-voice request body gender "female"
//   11 motion seen from B (first person, aimed at the path): A walk/run/jump with Walking_A / Running_A /
//      Jump_Full_Short on B and on A; C (공주, longskirt: *_LongSkirt) and D (요정, petal_skirt: Walking_A_ShortSkirt /
//      Running_A_ShortSkirt / Jump_Full_Short_ShortSkirt — Ruling S4) with those literal variant clips (= manifest
//      clipVariants) on B AND on their own screen, then Idle when they stop; then A sits on a hall chair
//      (seatIndex ≥ 0 on B) and stands up (after C and D, so B moves to the hall once). → builder-motion-sheet.png
//   12 A drops its connection (matchmake blocked while it is down) → B sees connected === false (shot);
//      back → same session, same parts on B and on A; front shot of A's face → builder-reconnect-sheet.png
//   13 A reloads → nickname 조립A and preview.parts == step-9 parts (last look remembered)
//   14 a pre-builder cache {"nickname":"옛사람","character":5,"tint":3} → nickname 옛사람, default parts, enters
//   15 the hall AI 조교 wears top/bottom/shoes__android; screenshot from inside the hall
// Phone (375×812, isMobile, hasTouch):
//   M1 no horizontal overflow (document AND .cv-entry, Ruling S22/S23); preview ≥ 200 px tall, starts on screen
//   M2 every chip / swatch / preset / 🎲 / voice option / tab ≥ 44×44 and no two overlap (all 7 tabs); the open tab
//      shows its word (visible, inside the tab, not cut) for each of the 7 tabs
//   M2b the 관리자 toggle has aria-controls="cv-admin-pop" only while the popover is open
//   M3 .cv-submit fully on screen after scrollIntoViewIfNeeded
//   M4 real touch drags: sideways on the preview turns it; up on the preview scrolls .cv-sheet-body and does not
//      turn it; up on the sheet scrolls .cv-sheet-body and does not turn the preview
//   M5 preset 마법사 → enter → own parts have hat__wizard, top__robe, shoes__wizard_shoes, item__staff
//   M6 screenshots: entry top, sheet scrolled to the bottom, world
//
// Rendering: the installed Chrome, headless, on the GPU; CV_E2E_RENDER=software forces SwiftShader (see launchBrowser).
// Evidence → .superpowers/sdd/evidence/task-char/ (builder-*.png sheets and step shots, builder-shots/ cells,
// assertions-builder.json). Exit code 0 = every assertion passed and no console/page error on any tab.

import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";

const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
const CLIENT_ORIGIN = new URL(CLIENT_URL).origin;
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, "..");
const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-char");
const SHOTS = join(EVIDENCE, "builder-shots");
mkdirSync(SHOTS, { recursive: true });

const VIEW = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 812 };
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const NAME = { A: "조립A", B: "조립B", C: "조립C", D: "조립D", M: "조립M" };
const OLD_CACHE = '{"nickname":"옛사람","character":5,"tint":3}';
const CHAT_TEXT = "안녕 조립실";
/** Task 4's first test: the default look's visible parts. */
const DEFAULT_PARTS = ["body__hands", "body__head", "bottom__pants", "face__smile", "hair__short", "shoes__sneakers", "top__tee"];
const FRONT = 0.5; // PREVIEW_START_YAW: a 3/4 front view
const BACK = 0.5 + Math.PI;
const SIDE = Math.PI / 2;
const WORLD_FOV_DEG = 55; // WorldScene <Canvas camera={{ fov: 55 }}>

// ───────────────────────────── tiny harness ─────────────────────────────

const results = [];
const errors = [];
let currentStep = "setup";
function check(name, ok, detail) {
  const row = { step: currentStep, name, ok: !!ok, detail: detail === undefined ? null : detail };
  results.push(row);
  const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail));
  console.log(`${ok ? "PASS" : "FAIL"}  [${currentStep}] ${name}${text.length > 600 ? text.slice(0, 600) + "…" : text}`);
}
/** Debug knob: CV_T10_SKIP="6c,6f" skips those steps — a skipped step is a failure, so such a run never exits 0. */
const SKIP = new Set((process.env.CV_T10_SKIP || "").split(",").map((s) => s.trim()).filter(Boolean));
async function step(name, fn) {
  currentStep = name;
  console.log(`\n── ${name}`);
  if (SKIP.has(name.split(" ")[0])) {
    check("step skipped (CV_T10_SKIP)", false);
    return;
  }
  const t0 = Date.now();
  try {
    await fn();
  } catch (err) {
    check("step ran to the end", false, String(err && err.stack ? err.stack : err));
  }
  console.log(`   (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (a) => Math.atan2(Math.sin(a), Math.cos(a));
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const r2 = (n) => Math.round(n * 100) / 100;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fsUrl = (rel) => "/@fs/" + pathToFileURL(join(REPO, rel)).pathname.replace(/^\//, "");

async function pollUntil(read, pred, timeoutMs = 8000, stepMs = 40) {
  const deadline = Date.now() + timeoutMs;
  let value = await read();
  while (!pred(value) && Date.now() < deadline) {
    await sleep(stepMs);
    value = await read();
  }
  return value;
}

/**
 * The installed Chrome, headless, on the real GPU (ANGLE/D3D11 on Windows) — like task-ux-desktop/mobile.
 * CV_E2E_RENDER=software uses SwiftShader WebGL instead (--use-angle=swiftshader --enable-unsafe-swiftshader). Measured
 * here with three world tabs: SwiftShader ~3 fps per tab and ~2 s per screenshot vs ~107 fps and ~0.1 s on the GPU —
 * a 1 s Shift+W then reaches B as three position updates (B never switches to the run clip) and the motion shots land
 * after the motion; SwiftShader also composites an occasional preview frame without the figure while card pictures
 * are drawn (see stageBackgroundOf).
 */
const SOFTWARE = process.env.CV_E2E_RENDER === "software";
async function launchBrowser() {
  const software = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
  const gpu = process.platform === "win32" ? ["--use-angle=d3d11", "--enable-gpu", "--ignore-gpu-blocklist"] : ["--enable-gpu", "--ignore-gpu-blocklist"];
  const args = SOFTWARE ? software : gpu;
  if (process.env.CV_CHROME_PATH) return chromium.launch({ headless: true, executablePath: process.env.CV_CHROME_PATH, args });
  return chromium.launch({ headless: true, channel: "chrome", args });
}

function watchErrors(page, tag) {
  page.on("console", (msg) => {
    if (msg.type() !== "error") return; // warnings (incl. the known R3F THREE.Clock deprecation) are not errors
    const text = msg.text();
    if (/Failed to load resource/i.test(text)) return; // judged through the response events below
    errors.push(`[${tag}] console.error: ${text}`);
  });
  page.on("pageerror", (err) => errors.push(`[${tag}] pageerror: ${err.message}`));
  page.on("response", (r) => {
    if (r.status() >= 400 && r.url().startsWith(CLIENT_ORIGIN)) errors.push(`[${tag}] local ${r.status()}: ${r.url()}`);
  });
}

// ───────────────────────────── page set-up ─────────────────────────────

/** A new browser context + page on the entry screen. Every context pre-saves the first-run guide as seen (S19). */
async function openPlayer(browser, { tag, phone = false, oldCache = false }) {
  const ctx = await browser.newContext(
    phone ? { viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA } : { viewport: VIEW },
  );
  await ctx.addInitScript(
    ({ oldCache, value }) => {
      try {
        if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true }));
        if (oldCache) localStorage.setItem("cv.entry", value);
      } catch {
        /* storage blocked: the guide just shows */
      }
    },
    { oldCache, value: OLD_CACHE },
  );
  const page = await ctx.newPage();
  watchErrors(page, tag);
  await page.goto(CLIENT_URL, { waitUntil: "domcontentloaded" });
  return { tag, ctx, page };
}

const MOD_URLS = {
  cl: "/src/game/characterLook.ts",
  bo: "/src/ui/builderOptions.ts",
  jp: "/src/game/jump.ts",
  ap: fsUrl("shared/src/appearance.ts"),
  cm: fsUrl("shared/src/characterManifest.ts"),
  wm: fsUrl("shared/src/worldMap.ts"),
};

/** Load the pure source modules into the page once per document (the dev server serves them) and expose helpers. */
async function ensureMods(page) {
  await page.evaluate(async (urls) => {
    if (window.__t10) return;
    const [CL, BO, JP, AP, CM, WM] = await Promise.all([urls.cl, urls.bo, urls.jp, urls.ap, urls.cm, urls.wm].map((u) => import(u)));
    const slots = CM.CHARACTER_SLOTS;
    const partsFromKey = (key) => {
      const ids = key.split("|")[0].split(",");
      const parts = {};
      slots.forEach((s, i) => (parts[s] = ids[i] === "-" ? null : ids[i]));
      return parts;
    };
    window.__t10 = {
      partsFromKey,
      visibleForKey: (key) => CL.visibleParts(partsFromKey(key)),
      clipFor: (base, a) => CL.clipFor(base, CL.lookFromAppearance(a)),
      presetVisible: (id) =>
        CL.visibleParts(CL.lookFromAppearance(AP.applyPreset(AP.DEFAULT_APPEARANCE, AP.APPEARANCE_PRESETS.find((p) => p.id === id))).parts),
      meta: () => ({
        slots: [...slots],
        slotLabels: { ...CM.CHARACTER_MANIFEST.slotLabels },
        options: Object.fromEntries(slots.map((s) => [s, [...AP.SLOT_OPTIONS[s]]])),
        chipLabels: Object.fromEntries(slots.map((s) => [s, BO.partChips(s).map((c) => c.label)])),
        presets: AP.APPEARANCE_PRESETS.map((p) => ({ id: p.id, label: p.label, parts: { ...p.parts } })),
        clipVariants: JSON.parse(JSON.stringify(CM.CHARACTER_MANIFEST.clipVariants)),
        hatHidesHair: [...CM.CHARACTER_MANIFEST.hatHidesHair],
        hatVariants: { ...CM.CHARACTER_MANIFEST.hatVariants },
        defaultVisible: CL.visibleParts(CL.lookFromAppearance(AP.DEFAULT_APPEARANCE).parts),
        defaultKey: CL.lookKey(CL.lookFromAppearance(AP.DEFAULT_APPEARANCE)),
        defaultColors: JSON.parse(JSON.stringify(CM.CHARACTER_MANIFEST.defaultColors)),
        voiceLabels: BO.VOICE_OPTIONS.map((o) => o.label),
        jumpCooldownMs: JP.JUMP_CLIENT_COOLDOWN_MS,
        seats: WM.SEATS.map((s) => ({ ...s })),
        npcHall: { ...WM.NPC_SPOTS.hall },
      }),
    };
  }, MOD_URLS);
}

/** Numbers / names read from the source modules (filled from A's page). */
let META = null;
/** The clip a look with `bottomId` plays for base clip `base` — straight from manifest clipVariants (S4). */
const expectClip = (bottomId, base) => META.clipVariants[bottomId]?.[base] ?? base;

// ───────────────────────────── builder helpers ─────────────────────────────

const preview = (page) => page.evaluate(() => window.__cvPreview());
const lookKeyOf = (page) => page.evaluate(() => window.__cvPreview().lookKey);
const frames = (page, n = 3) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        let i = 0;
        const f = () => (++i >= n ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** Wait for the builder's first figure, then load the helper modules. */
async function waitBuilder(page) {
  await page.waitForFunction(() => window.__cvPreview && window.__cvPreview().shown && window.__cvAvatars?.().preview, null, {
    timeout: 120000,
  });
  await ensureMods(page);
  return settle(page);
}

/**
 * The preview figure for the current look is mounted: its probe parts are visibleParts(look) of the preview's
 * lookKey and a clip was reported. Returns { key, parts, drawMeshes, clip }.
 */
async function settle(page) {
  const v = await pollUntil(
    () =>
      page.evaluate(() => {
        const p = window.__cvPreview();
        const e = window.__cvAvatars().preview;
        if (!p.lookKey || !e) return null;
        const want = window.__t10.visibleForKey(p.lookKey);
        if (e.clip === null || JSON.stringify(e.parts) !== JSON.stringify(want)) return null;
        return { key: p.lookKey, parts: e.parts, drawMeshes: e.drawMeshes, triangles: e.triangles, clip: e.clip, yaw: p.yaw };
      }),
    (x) => x !== null,
    15000,
    30,
  );
  if (!v) throw new Error("the preview figure did not settle on the current look");
  return v;
}

/** Run `act` (a builder click) and wait until the preview shows the new look. */
async function change(page, act, { expectChange = true } = {}) {
  const before = await lookKeyOf(page);
  await act();
  if (expectChange) await pollUntil(() => lookKeyOf(page), (k) => k !== before, 4000, 25);
  return settle(page);
}

const presetBtn = (page, label) => page.locator(".cv-preset", { hasText: new RegExp(`^${label}$`) });
const tabBtn = (page, label) => page.getByRole("tab", { name: label, exact: true });
const chipBtn = (page, label) => page.locator(".cv-chips").getByRole("button", { name: label, exact: true });
const swatchBtn = (page, label) => page.locator(`.cv-swatch[aria-label="${label}"]`);
const voiceBtn = (page, label) => page.locator(".cv-voice-option", { hasText: label });

async function clickPreset(page, label) {
  return change(page, () => presetBtn(page, label).click());
}
async function openTab(page, label) {
  const t = tabBtn(page, label);
  if ((await t.getAttribute("aria-selected")) !== "true") await t.click();
  await pollUntil(() => t.getAttribute("aria-selected"), (v) => v === "true", 3000, 25);
}
async function clickChip(page, label) {
  const c = chipBtn(page, label);
  const pressed = (await c.getAttribute("aria-pressed")) === "true";
  return change(page, () => c.click(), { expectChange: !pressed });
}
/** Wear part `id` (null = none) in `slot` through its tab and chip. */
async function wear(page, slot, id) {
  await openTab(page, META.slotLabels[slot]);
  const idx = META.options[slot].indexOf(id);
  if (idx < 0) throw new Error(`unknown ${slot} option ${id}`);
  return clickChip(page, META.chipLabels[slot][idx]);
}
const pressedOf = (loc) => loc.getAttribute("aria-pressed");
/** Click the open tab's colour swatch `label` unless it is already the picked one. */
async function pickSwatch(page, label) {
  const s = swatchBtn(page, label);
  if ((await s.count()) === 0) throw new Error(`no swatch ${label} on this tab`);
  if ((await pressedOf(s)) !== "true") await change(page, () => s.click());
}
/** Hair and hat sheets: dark brown hair under a blue hat (crown/tiara keep their gold) so hair poking through shows. */
const SHEET_COLORS = { hair: "진갈색", hat: "파랑" };
async function contrastColors(page, hat) {
  await openTab(page, META.slotLabels.hair);
  await pickSwatch(page, SHEET_COLORS.hair);
  if (!(hat in (META.defaultColors.hat ?? {}))) {
    await openTab(page, META.slotLabels.hat);
    await pickSwatch(page, SHEET_COLORS.hat);
  }
}
const voiceState = (page) =>
  page.locator(".cv-voice-option").evaluateAll((els) => els.map((e) => `${e.textContent.trim()}=${e.getAttribute("aria-checked")}`));

/**
 * The stage with the canvas hidden (background art only), to tell a captured frame without the figure. Under
 * SwiftShader a frame in which the card pictures are drawn (builderThumbs: render into a corner + drawImage
 * readback, then the preview render) is now and then composited with an empty canvas; see stageShot.
 */
let stageBackground = null;
async function stageBackgroundOf(page, bb) {
  if (stageBackground && eq(stageBackground.bb, bb)) return stageBackground.png;
  await page.evaluate(() => (document.querySelector(".cv-builder-stage canvas").style.visibility = "hidden"));
  await frames(page, 2);
  const png = await page.screenshot({ clip: bb });
  await page.evaluate(() => (document.querySelector(".cv-builder-stage canvas").style.visibility = ""));
  await frames(page, 2);
  stageBackground = { bb, png };
  return png;
}
let helperPage = null;
/** Share of the stage's middle (where the figure stands) that differs from the bare background. */
async function figureCover(png, background) {
  helperPage ??= await sheetCtx.newPage();
  return helperPage.evaluate(
    async ({ a, b }) => {
      const load = (s) =>
        new Promise((res, rej) => {
          const i = new Image();
          i.onload = () => res(i);
          i.onerror = rej;
          i.src = "data:image/png;base64," + s;
        });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const c = document.createElement("canvas");
      c.width = ia.width;
      c.height = ia.height;
      const g = c.getContext("2d", { willReadFrequently: true });
      const x0 = Math.round(ia.width * 0.3);
      const y0 = Math.round(ia.height * 0.2);
      const w = Math.round(ia.width * 0.4);
      const h = Math.round(ia.height * 0.65);
      g.drawImage(ia, 0, 0);
      const da = g.getImageData(x0, y0, w, h).data;
      g.drawImage(ib, 0, 0);
      const db = g.getImageData(x0, y0, w, h).data;
      let n = 0;
      for (let i = 0; i < da.length; i += 4) if (Math.abs(da[i] - db[i]) + Math.abs(da[i + 1] - db[i + 1]) + Math.abs(da[i + 2] - db[i + 2]) > 60) n++;
      return n / (w * h);
    },
    { a: background.toString("base64"), b: png.toString("base64") },
  );
}
/**
 * Captures without the figure. On the GPU (default) none is allowed — the first capture must show it. Only under
 * SwiftShader (CV_E2E_RENDER=software), where the compositing glitch above is known, is such a capture retaken (≤ 3
 * times) and listed here.
 */
const RETAKES = SOFTWARE ? 3 : 0;
const emptyCaptures = [];
/** Stage shots that never showed the figure (a failure). */
const emptyShots = [];
let stageShots = 0;

/** One shot of the preview stage (the transparent canvas box over the background art) at `yaw`. */
async function stageShot(page, name, yaw = FRONT) {
  await page.evaluate((y) => window.__cvPreview.setYaw(y), yaw);
  await frames(page, 3);
  const bb = await page.locator(".cv-builder-stage").boundingBox();
  const background = await stageBackgroundOf(page, bb);
  let png = null;
  for (let attempt = 0; attempt <= RETAKES; attempt++) {
    // page.screenshot with a clip: an element screenshot drops the transparent WebGL canvas (seen in headless Chrome).
    png = await page.screenshot({ clip: bb });
    const cover = await figureCover(png, background);
    if (cover >= 0.05) break;
    if (attempt === RETAKES) emptyShots.push({ name, cover });
    else emptyCaptures.push({ name, attempt, cover: Math.round(cover * 1000) / 1000 });
    await frames(page, 2);
  }
  writeFileSync(join(SHOTS, name + ".png"), png);
  stageShots++;
  return png;
}

// ───────────────────────────── sheets ─────────────────────────────

let sheetCtx = null;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
/** Bundle PNG buffers into a data-URL grid page and screenshot it (rows: { label, cells: [{ label, png }] }). */
async function writeSheet(file, title, rows, { cellW = 162 } = {}) {
  const maxCells = Math.max(1, ...rows.map((r) => r.cells.length));
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{margin:0;padding:12px;background:#f3efea;font:12px/1.35 "Malgun Gothic","Noto Sans KR",sans-serif;color:#1b1640}
    h1{font-size:16px;margin:0 0 10px}
    .row{display:flex;gap:6px;margin-bottom:8px;align-items:flex-start}
    .rl{width:110px;flex:none;font-weight:700;padding-top:4px;word-break:keep-all}
    figure{margin:0;width:${cellW}px;flex:none;background:#fff;border:1px solid #d8d2e8;border-radius:6px;overflow:hidden}
    figure img{display:block;width:100%}
    figcaption{padding:2px 4px;font-size:11px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  </style></head><body><h1>${esc(title)}</h1>${rows
    .map(
      (r) =>
        `<div class="row"><div class="rl">${esc(r.label)}</div>${r.cells
          .map((c) => `<figure><img src="data:image/png;base64,${c.png.toString("base64")}"><figcaption>${esc(c.label)}</figcaption></figure>`)
          .join("")}</div>`,
    )
    .join("")}</body></html>`;
  const page = await sheetCtx.newPage();
  await page.setViewportSize({ width: Math.ceil(24 + 116 + maxCells * (cellW + 6)), height: 600 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: join(EVIDENCE, file), fullPage: true });
  await page.close();
  console.log(`   sheet → ${file} (${rows.length} rows, ${rows.reduce((n, r) => n + r.cells.length, 0)} shots)`);
}
const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

// ───────────────────────────── world helpers ─────────────────────────────

const getPos = (p) => p.evaluate(() => window.__cv.getPos());
const getOrbit = (p) => p.evaluate(() => window.__cv.getOrbit());
const getView = (p) => p.evaluate(() => window.__cv.getView());
const getRemotes = (p) => p.evaluate(() => window.__cv.getRemotes());
const remoteOf = async (p, sid) => (await getRemotes(p)).find((r) => r.sessionId === sid) ?? null;
const avatarOf = (p, id) => p.evaluate((id) => window.__cvAvatars?.()[id] ?? null, id);
const shot = (p, name) => p.screenshot({ path: join(EVIDENCE, name) });

/** Fill the nickname and press 입장; returns the own session id once the own avatar is assembled (S17). */
async function enter(page, nickname) {
  await page.locator("input.cv-input").first().fill(nickname);
  await page.locator(".cv-submit").click();
  await page.waitForFunction(() => typeof window.__cv?.getSessionId === "function", null, { timeout: 90000 });
  const sid = await page.evaluate(() => window.__cv.getSessionId());
  await pollUntil(() => avatarOf(page, sid), (e) => !!e && e.parts.length > 0 && e.clip !== null, 30000);
  await page.locator("canvas").first().waitFor({ state: "visible", timeout: 30000 });
  return sid;
}

/** Camera-relative key sets for the 8 directions: sector k = k × 45° clockwise from straight ahead. */
const SECTOR_KEYS = new Map([
  [0, ["w"]], [1, ["w", "d"]], [2, ["d"]], [3, ["s", "d"]], [4, ["s"]], [-4, ["s"]], [-3, ["s", "a"]], [-2, ["a"]], [-1, ["w", "a"]],
]);
/**
 * Closed-loop keyboard walk to (tx, tz), camera-relative (task-ux-desktop walkTo, but the keys are the 8-direction set
 * closest to the target's bearing: off by ≤ 22.5°, so a long leg does not drift sideways into the desks). Third person only.
 */
async function walkTo(page, tx, tz, { tol = 0.5, timeout = 40000 } = {}) {
  await page.bringToFront();
  const held = new Set();
  const press = async (want) => {
    for (const k of [...held]) if (!want.has(k)) { await page.keyboard.up(k); held.delete(k); }
    for (const k of want) if (!held.has(k)) { await page.keyboard.down(k); held.add(k); }
  };
  const deadline = Date.now() + timeout;
  const sector = (a) => SECTOR_KEYS.get(Math.round(norm(a) / (Math.PI / 4)));
  // Avatars are solid: another player standing on the straight line stops the walk. When the position has not
  // changed for 0.8 s, step aside (perpendicular to the bearing, alternating sides) and go on.
  let still = { p: null, t: Date.now() };
  let side = 1;
  try {
    while (Date.now() < deadline) {
      const p = await getPos(page);
      const { yaw } = await getOrbit(page);
      const dx = tx - p.x;
      const dz = tz - p.z;
      if (Math.hypot(dx, dz) <= tol) break;
      const f = dx * -Math.sin(yaw) + dz * -Math.cos(yaw);
      const r = dx * Math.cos(yaw) + dz * -Math.sin(yaw);
      const bearing = Math.atan2(r, f);
      if (!still.p || dist(p, still.p) > 0.15) still = { p, t: Date.now() };
      else if (Date.now() - still.t > 800) {
        await press(new Set(sector(bearing + (side * Math.PI) / 2)));
        await sleep(450);
        side = -side;
        still = { p: null, t: Date.now() };
        continue;
      }
      await press(new Set(sector(bearing)));
      await sleep(40);
    }
  } finally {
    for (const k of [...held]) await page.keyboard.up(k);
  }
  await sleep(300);
  return getPos(page);
}
async function walkPath(page, points) {
  let p = null;
  for (const [x, z, tol] of points) p = await walkTo(page, x, z, { tol: tol ?? 0.5 });
  return p;
}

/**
 * Closed-loop camera aim with mouse drags on the world canvas (the drag gain is measured from the first drag).
 * `fp` aims the first-person look yaw, otherwise the third-person orbit yaw. Drags never stay a "click"
 * (a small correction swings out 40 px and back), so no click-move target is ever set.
 */
async function aimDrag(page, target, { fp = false, tol = 0.03, y = 300 } = {}) {
  const read = () => page.evaluate((fp) => (fp ? window.__cv.getView().fpYaw : window.__cv.getOrbit().yaw), fp);
  let k = null;
  let yaw = await read();
  for (let i = 0; i < 16; i++) {
    const d = norm(target - yaw);
    if (Math.abs(d) <= tol) break;
    let dx = k === null ? 100 * Math.sign(d || 1) : d / k;
    if (!Number.isFinite(dx)) dx = 100;
    dx = Math.max(-760, Math.min(760, dx));
    const x0 = VIEW.width / 2 - dx / 2;
    await page.mouse.move(x0, y);
    await page.mouse.down();
    if (Math.abs(dx) < 30) await page.mouse.move(x0 + 40, y, { steps: 3 });
    await page.mouse.move(x0 + dx, y, { steps: Math.max(4, Math.ceil(Math.abs(dx) / 40)) });
    await page.mouse.up();
    await sleep(150);
    const next = await read();
    const got = norm(next - yaw);
    if (Math.abs(got) > 1e-3 && Math.abs(dx) >= 1) k = got / dx;
    yaw = next;
  }
  return yaw;
}

async function setFp(page, on) {
  await page.bringToFront();
  const v = await getView(page);
  if ((v.mode === "fp") !== on) await page.keyboard.press("v");
  return pollUntil(() => getView(page), (s) => (on ? s.mode === "fp" && s.blend > 0.99 : s.mode === "tp" && s.blend < 0.01), 6000);
}

/** In-page recorder: `fn(arg)` every ~20 ms stamped with Date.now() (one clock for every tab). */
async function startRecorder(page, name, fn, arg) {
  await page.evaluate(
    ({ name, src, arg }) => {
      const read = (0, eval)("(" + src + ")");
      const rec = (window.__recs ??= {});
      if (rec[name]?.iv) clearInterval(rec[name].iv);
      rec[name] = { rows: [], iv: null };
      const tick = () => {
        let row;
        try {
          row = read(arg);
        } catch (e) {
          row = { error: String(e) };
        }
        row.t = Date.now();
        rec[name].rows.push(row);
      };
      tick();
      rec[name].iv = setInterval(tick, 20);
    },
    { name, src: fn.toString(), arg },
  );
}
const stopRecorder = (page, name) => page.evaluate((n) => window.__recs?.[n]?.iv && clearInterval(window.__recs[n].iv), name).catch(() => {});
const rowsBetween = (page, name, t0, t1) =>
  page.evaluate(({ name, t0, t1 }) => window.__recs[name].rows.filter((r) => r.t >= t0 && r.t <= t1), { name, t0, t1 });
const clipsIn = (rows) => [...new Set(rows.map((r) => (r.error ? "ERR" : r.v)))];

/**
 * World point → pixel box in B's FIRST-PERSON view (live camera from __cvCamera, look from getView).
 * Returns a crop rectangle around a figure standing at (x, z), or null when it is behind the camera.
 */
async function figureClip(page, x, z, heightM = 2.4, lead = null) {
  const cam = await page.evaluate(() => window.__cvCamera());
  const v = await getView(page);
  const cosP = Math.cos(v.fpPitch);
  const f = [-Math.sin(v.fpYaw) * cosP, -Math.sin(v.fpPitch), -Math.cos(v.fpYaw) * cosP];
  let rt = [-f[2], 0, f[0]];
  const rl = Math.hypot(rt[0], rt[2]);
  rt = [rt[0] / rl, 0, rt[2] / rl];
  const up = [rt[1] * f[2] - rt[2] * f[1], rt[2] * f[0] - rt[0] * f[2], rt[0] * f[1] - rt[1] * f[0]];
  const th = Math.tan((WORLD_FOV_DEG * Math.PI) / 360);
  const proj = (wx, wy, wz) => {
    const d = [wx - cam.x, wy - cam.y, wz - cam.z];
    const zc = d[0] * f[0] + d[1] * f[1] + d[2] * f[2];
    if (zc <= 0.2) return null;
    const xc = d[0] * rt[0] + d[1] * rt[1] + d[2] * rt[2];
    const yc = d[0] * up[0] + d[1] * up[1] + d[2] * up[2];
    return { x: ((xc / (zc * th * (VIEW.width / VIEW.height)) + 1) / 2) * VIEW.width, y: ((1 - yc / (zc * th)) / 2) * VIEW.height };
  };
  // The figure's screen box where it is now and (with `lead`) where it will be a moment later: a moving figure
  // stays inside the union even when the capture lands a few frames after the request.
  const spots = lead ? [[x, z], [x + lead.dx, z + lead.dz]] : [[x, z]];
  const pts = [];
  for (const [sx, sz] of spots) {
    const feet = proj(sx, 0, sz);
    const top = proj(sx, heightM, sz);
    if (!feet || !top) return null;
    const half = (feet.y - top.y) * 0.45;
    pts.push({ x: feet.x - half, y: top.y }, { x: feet.x + half, y: feet.y });
  }
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const h = Math.max(240, (maxY - minY) * 1.3);
  const w = Math.max(h * 0.875, (maxX - minX) * 1.3);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const box = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
  box.x = Math.max(0, Math.min(VIEW.width - box.width, box.x));
  box.y = Math.max(0, Math.min(VIEW.height - box.height, box.y));
  box.width = Math.min(box.width, VIEW.width);
  box.height = Math.min(box.height, VIEW.height);
  return box;
}
/** B's view of the figure `sid` (or a fixed world point): the crop (for the sheet) and the full frame (evidence). */
async function shotFigure(page, name, { sid = null, at = null, heightM = 2.4, lead = null } = {}) {
  let pos = at;
  if (sid) {
    const r = await remoteOf(page, sid);
    pos = r ? { x: r.x, z: r.z } : null;
  }
  const clip = pos ? await figureClip(page, pos.x, pos.z, heightM, lead) : null;
  const png = await page.screenshot(clip ? { clip } : {});
  writeFileSync(join(SHOTS, name + ".png"), png);
  await page.screenshot({ path: join(SHOTS, name + "-full.png") });
  return { png, clip };
}

// ───────────────────────────── phone touch (task-ux-mobile) ─────────────────────────────

function makeTouch(cdp) {
  const fingers = new Map();
  const send = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points.map(([id, [x, y]]) => ({ x, y, id })) });
  const api = {
    async down(id, x, y) {
      fingers.set(id, [x, y]);
      await send("touchStart", [...fingers]);
    },
    async move(id, x, y) {
      fingers.set(id, [x, y]);
      await send("touchMove", [...fingers]);
    },
    async up(id) {
      const at = fingers.get(id);
      if (!at) return;
      fingers.delete(id);
      await send("touchEnd", [[id, at]]);
    },
    async drag(id, x0, y0, x1, y1, { steps = 16, stepMs = 16 } = {}) {
      await api.down(id, x0, y0);
      for (let i = 1; i <= steps; i++) {
        await api.move(id, x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps);
        await sleep(stepMs);
      }
      await api.up(id);
    },
  };
  return api;
}
const rectOf = (p, sel) =>
  p.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  }, sel);

// ─────────────────────────────── the run ───────────────────────────────

const browser = await launchBrowser();
// Closed in the finally below, whatever throws on the way (a context that fails to open, the evidence write).
try {
  sheetCtx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  let A, B, C, D, E, M;
  let sidA = null;
  let sidB = null;
  let partsAtEntry = null;
  let keyAtEntry = null;
  const motionRows = [];
  const voiceReqs = [];
  try {
    // ════════════════════════════ desktop: the builder ════════════════════════════
    currentStep = "A opens";
    A = await openPlayer(browser, { tag: "A" });
    const pa = A.page;
    await waitBuilder(pa);
    META = await pa.evaluate(() => window.__t10.meta());
    check("source modules loaded (7 slots, 8 presets, clip variants for 3 skirts)", META.slots.length === 7 && META.presets.length === 8 && Object.keys(META.clipVariants).length === 3, {
      slots: META.slots,
      presets: META.presets.map((p) => p.label),
      variants: Object.keys(META.clipVariants),
    });
    const presetByLabel = (label) => META.presets.find((p) => p.label === label);

    await step("1 입장 화면: 미리보기 캔버스·기본 외형 7개 부품", async () => {
      check(".cv-builder-preview canvas is visible", await pa.locator(".cv-builder-preview canvas").isVisible());
      const s = await settle(pa);
      check("preview.parts == the default look's 7 parts (Task 4 first test)", eq(s.parts, DEFAULT_PARTS) && eq(META.defaultVisible, DEFAULT_PARTS), { parts: s.parts });
      check('no "body__torso" (the tee covers it)', s.parts.length === 7 && !s.parts.includes("body__torso"), { parts: s.parts });
      check("the preview starts on the default look (lookKey)", s.key === META.defaultKey, { key: s.key });
      await shot(pa, "builder-01-entry.png");
    });

    await step("2 프리셋 기사", async () => {
      const s = await clickPreset(pa, "기사");
      const want = ["hat__knight_helmet", "top__armor", "shoes__tall_boots", "item__wooden_sword"];
      check("parts have hat__knight_helmet, top__armor, shoes__tall_boots, item__wooden_sword", want.every((p) => s.parts.includes(p)), { parts: s.parts });
      check("no hair__* part (the helmet hides hair) and no hair__short", s.parts.length > 0 && !s.parts.some((p) => p.startsWith("hair__")) && !s.parts.includes("hair__short"), {
        parts: s.parts,
      });
      check("the 기사 card is aria-pressed", (await pressedOf(presetBtn(pa, "기사"))) === "true");
      await shot(pa, "builder-02-knight.png");
    });

    await step("3 머리카락 포니테일 → 모자 캡모자 → 모자 없음 (Ruling S3)", async () => {
      await openTab(pa, "머리카락");
      let s = await clickChip(pa, "포니테일");
      check("포니테일 chip pressed, the look wears ponytail", (await pressedOf(chipBtn(pa, "포니테일"))) === "true" && s.key.split("|")[0].split(",")[1] === "ponytail", { key: s.key });
      check("…under the knight helmet still no hair__* mesh (hatHidesHair)", s.parts.includes("hat__knight_helmet") && !s.parts.some((p) => p.startsWith("hair__")), { parts: s.parts });
      await openTab(pa, "모자");
      s = await clickChip(pa, "캡모자");
      check("모자 캡모자 → hair__ponytail__hat (the hat variant) with hat__cap", s.parts.includes("hair__ponytail__hat") && s.parts.includes("hat__cap") && !s.parts.includes("hair__ponytail"), { parts: s.parts });
      await shot(pa, "builder-03-cap-ponytail.png");
      s = await clickChip(pa, "없음");
      check("모자 없음 → hair__ponytail, no hair__ponytail__hat, no hat__*", s.parts.includes("hair__ponytail") && !s.parts.includes("hair__ponytail__hat") && !s.parts.some((p) => p.startsWith("hat__")), {
        parts: s.parts,
      });
    });

    await step("4 웃옷 견본 흰색 → 남색", async () => {
      await openTab(pa, "웃옷");
      const before = await settle(pa);
      const s1 = await change(pa, () => swatchBtn(pa, "흰색").click());
      check('흰색 swatch aria-pressed="true"', (await pressedOf(swatchBtn(pa, "흰색"))) === "true");
      check("parts unchanged, only the colour changed (look key differs, top colour #F7F7F2)", eq(s1.parts, before.parts) && s1.key !== before.key && s1.key.split("|")[1].split(",")[3] === "#F7F7F2", {
        parts: s1.parts,
        key: s1.key,
      });
      const s2 = await change(pa, () => swatchBtn(pa, "남색").click());
      check('남색 swatch aria-pressed="true", 흰색 "false"', (await pressedOf(swatchBtn(pa, "남색"))) === "true" && (await pressedOf(swatchBtn(pa, "흰색"))) === "false");
      check("…parts still unchanged, top colour #2D3A75", eq(s2.parts, before.parts) && s2.key.split("|")[1].split(",")[3] === "#2D3A75", { key: s2.key });
    });

    await step("5 모자 왕관·티아라 → 금색 견본", async () => {
      await openTab(pa, "모자");
      const pre = await settle(pa);
      const hatHex = (k) => k.split("|")[1].split(",")[2];
      check("setup: the hat colour is not gold before 왕관", hatHex(pre.key) !== "#D4A93A", { hatColour: hatHex(pre.key) });
      let s = await clickChip(pa, "왕관");
      check('왕관 → swatch 금색 aria-pressed="true" (crown default gold)', (await pressedOf(swatchBtn(pa, "금색"))) === "true" && hatHex(s.key) === "#D4A93A" && s.parts.includes("hat__crown"), {
        key: s.key,
      });
      await change(pa, () => swatchBtn(pa, "빨강").click());
      check("setup: 빨강 picked, 금색 no longer pressed", (await pressedOf(swatchBtn(pa, "금색"))) === "false" && (await pressedOf(swatchBtn(pa, "빨강"))) === "true");
      s = await clickChip(pa, "티아라");
      check('티아라 → swatch 금색 aria-pressed="true" (tiara default gold)', (await pressedOf(swatchBtn(pa, "금색"))) === "true" && hatHex(s.key) === "#D4A93A" && s.parts.includes("hat__tiara"), {
        key: s.key,
      });
      await shot(pa, "builder-05-tiara.png");
    });

    await step("6a 렌더 시트: 프리셋 8개", async () => {
      const front = [];
      const back = [];
      for (const p of META.presets) {
        const s = await clickPreset(pa, p.label);
        const want = await pa.evaluate((id) => window.__t10.presetVisible(id), p.id);
        check(`${p.label}: card pressed, parts == the preset's visible parts, drawMeshes ≤ 8`, (await pressedOf(presetBtn(pa, p.label))) === "true" && eq(s.parts, want) && s.drawMeshes <= 8, {
          parts: s.parts,
          drawMeshes: s.drawMeshes,
        });
        front.push({ label: `${p.label} · 앞`, png: await stageShot(pa, `preset-${p.id}-front`, FRONT) });
        back.push({ label: `${p.label} · 뒤`, png: await stageShot(pa, `preset-${p.id}-back`, BACK) });
      }
      await writeSheet("builder-presets-sheet.png", "프리셋 8개 (게임 렌더러, 앞 3/4 · 뒤 3/4)", [
        { label: "앞", cells: front },
        { label: "뒤", cells: back },
      ], { cellW: 200 });
    });

    await step("6b 렌더 시트: 🎲 랜덤 30회", async () => {
      const voice0 = await voiceState(pa);
      let prev = (await settle(pa)).parts;
      let changed = 0;
      const cells = [];
      const meshes = [];
      const voiceDiffs = [];
      for (let i = 1; i <= 30; i++) {
        const s = await change(pa, () => pa.locator(".cv-random").click());
        meshes.push(s.drawMeshes);
        if (!eq(s.parts, prev)) changed++;
        prev = s.parts;
        const v = await voiceState(pa);
        if (!eq(v, voice0)) voiceDiffs.push({ i, v });
        cells.push({ label: `#${i} · ${s.drawMeshes} mesh`, png: await stageShot(pa, `random-${String(i).padStart(2, "0")}`, FRONT) });
      }
      check("every roll: preview drawMeshes ≤ 8", meshes.length === 30 && meshes.every((n) => n <= 8), { meshes });
      check("every roll: the voice aria-checked stays as it was", voice0.length === 2 && voiceDiffs.length === 0, { voice0, voiceDiffs });
      check("parts changed on ≥ 25 of 30 rolls", changed >= 25, { changed });
      await writeSheet("builder-random-sheet.png", "🎲 랜덤 30회 (앞 3/4)", chunk(cells, 10).map((c, i) => ({ label: `${i * 10 + 1}–${i * 10 + c.length}`, cells: c })), { cellW: 162 });
    });

    await step("6c 렌더 시트: 모든 부품이 한 번씩 나오는 13개 조합 (Ruling S9)", async () => {
      const n = Math.max(...META.slots.map((s) => META.options[s].length));
      const used = Object.fromEntries(META.slots.map((s) => [s, new Set()]));
      const rows = [];
      const bad = [];
      for (let i = 0; i < n; i++) {
        for (const slot of META.slots) {
          await openTab(pa, META.slotLabels[slot]);
          const k = i % META.options[slot].length;
          const chip = pa.locator(".cv-chips .cv-chip").nth(k);
          await change(pa, () => chip.click(), { expectChange: (await pressedOf(chip)) !== "true" });
          const sw = pa.locator(".cv-builder-swatches .cv-swatch");
          const count = await sw.count();
          if (count > 0) {
            const target = sw.nth(i % count);
            await change(pa, () => target.click(), { expectChange: (await pressedOf(target)) !== "true" });
          }
        }
        const s = await settle(pa);
        const parts = await pa.evaluate((k) => window.__t10.partsFromKey(k), s.key);
        const want = Object.fromEntries(META.slots.map((slot) => [slot, META.options[slot][i % META.options[slot].length]]));
        if (!eq(parts, want) || s.drawMeshes > 8) bad.push({ i, parts, want, drawMeshes: s.drawMeshes });
        for (const slot of META.slots) used[slot].add(META.options[slot].indexOf(parts[slot]));
        const label = META.slots.map((slot) => parts[slot] ?? "-").join(" · ");
        rows.push({
          label: `#${i}`,
          cells: [
            { label: `앞 · ${label}`, png: await stageShot(pa, `coverage-${String(i).padStart(2, "0")}-front`, FRONT) },
            { label: "뒤", png: await stageShot(pa, `coverage-${String(i).padStart(2, "0")}-back`, BACK) },
            { label: "옆", png: await stageShot(pa, `coverage-${String(i).padStart(2, "0")}-side`, SIDE) },
          ],
        });
      }
      check(`each of the ${n} looks wears option (i mod n) in every slot, drawMeshes ≤ 8`, rows.length === n && bad.length === 0, { bad });
      const missing = META.slots.filter((slot) => used[slot].size !== META.options[slot].length).map((slot) => ({ slot, used: used[slot].size, of: META.options[slot].length }));
      check("together they show every option of every slot at least once", missing.length === 0, { missing });
      // 3 views per look → two looks per sheet row.
      const pairs = chunk(rows, 2).map((pair) => ({ label: pair.map((r) => r.label).join(" / "), cells: pair.flatMap((r) => r.cells) }));
      await writeSheet("builder-coverage-sheet.png", "슬롯마다 모든 부품을 한 번씩: 조합 i = 각 슬롯의 (i mod n)번 (앞 · 뒤 · 옆)", pairs, { cellW: 150 });
    });

    await step("6d 렌더 시트: 자세 (setClip — 서기·걷기·달리기·점프·앉기, 롱스커트·꽃잎 치마 옆모습)", async () => {
      const POSES = [
        { base: "Idle", at: [0], tag: "서기" },
        { base: "Walking_A", at: [150, 550], tag: "걷기" },
        { base: "Running_A", at: [250], tag: "달리기" },
        { base: "Jump_Full_Short", at: [450], tag: "점프" },
        { base: "Sit_Chair_Idle", at: [300], tag: "앉기" },
      ];
      const rows = [];
      const bad = [];
      const shootRow = async (p, yaw, view) => {
        const cells = [];
        for (const pose of POSES) {
          const resolved = await pa.evaluate((b) => window.__cvPreview.setClip(b), pose.base);
          const want = expectClip(p.parts.bottom, pose.base);
          const playing = await pollUntil(() => pa.evaluate(() => window.__cvPreview().clip), (c) => c === resolved, 4000, 20);
          const probe = (await avatarOf(pa, "preview"))?.clip;
          if (resolved !== want || playing !== resolved || probe !== resolved) bad.push({ preset: p.label, base: pose.base, resolved, want, playing, probe });
          await pa.evaluate((y) => window.__cvPreview.setYaw(y), yaw);
          const t0 = Date.now();
          for (const at of pose.at) {
            const wait = at - (Date.now() - t0);
            if (wait > 0) await sleep(wait);
            cells.push({ label: `${pose.tag} · ${resolved}`, png: await stageShot(pa, `pose-${p.id}-${view}-${pose.base}-${at}`, yaw) });
          }
        }
        return cells;
      };
      for (const p of META.presets) {
        await clickPreset(pa, p.label);
        rows.push({ label: `${p.label} (${p.parts.bottom})`, cells: await shootRow(p, FRONT, "front") });
      }
      for (const label of ["공주", "요정"]) {
        const p = presetByLabel(label);
        await clickPreset(pa, p.label);
        rows.push({ label: `${p.label} 옆 (${p.parts.bottom})`, cells: await shootRow(p, SIDE, "side") });
      }
      await pa.evaluate(() => window.__cvPreview.setClip("Idle"));
      check("setClip resolved every pose through clipFor = manifest clipVariants (skirts → *_LongSkirt / *_ShortSkirt), and the preview played it", bad.length === 0 && rows.length === 10, { bad });
      const princess = presetByLabel("공주");
      const fairy = presetByLabel("요정");
      check("…공주 (longskirt) walks/runs/jumps with the LongSkirt clips, 요정 (petal_skirt) with the ShortSkirt clips", expectClip(princess.parts.bottom, "Walking_A") === "Walking_A_LongSkirt" && expectClip(princess.parts.bottom, "Jump_Full_Short") === "Jump_Full_Short_LongSkirt" && expectClip(fairy.parts.bottom, "Running_A") === "Running_A_ShortSkirt", {
        princess: princess.parts.bottom,
        fairy: fairy.parts.bottom,
      });
      await writeSheet("builder-poses-sheet.png", "자세 시트 (미리보기 setClip): 서기 · 걷기 2장 · 달리기 · 점프 · 앉기", rows, { cellW: 150 });
    });

    await step("6e 투구 시트: 기사 투구·우주 헬멧 × 머리 5종 (Review Focus 6)", async () => {
      const hairs = META.options.hair.filter((h) => h !== null);
      const rows = [];
      const bad = [];
      await wear(pa, "hair", hairs[0]);
      for (const hat of META.hatHidesHair) {
        await wear(pa, "hat", hat);
        await contrastColors(pa, hat);
        const cells = [];
        for (const hair of hairs) {
          const s = await wear(pa, "hair", hair);
          if (!s.parts.includes(`hat__${hat}`) || s.parts.some((p) => p.startsWith("hair__"))) bad.push({ hat, hair, parts: s.parts });
          cells.push({ label: `${hair} · 앞`, png: await stageShot(pa, `helmet-${hat}-${hair}-front`, FRONT) });
          cells.push({ label: `${hair} · 뒤`, png: await stageShot(pa, `helmet-${hat}-${hair}-back`, BACK) });
        }
        rows.push({ label: META.chipLabels.hat[META.options.hat.indexOf(hat)], cells });
      }
      check(`${META.hatHidesHair.join(" / ")} × ${hairs.length} hairs: the helmet is worn and no hair mesh is drawn`, rows.length === 2 && bad.length === 0, { bad });
      await writeSheet("builder-helmet-sheet.png", "투구 시트: 기사 투구 · 우주 헬멧(파랑) × 머리 5종(진갈색) (앞 · 뒤) — 머리카락이 밖으로 나오면 안 됨", rows, { cellW: 140 });
    });

    await step("6f 모자 시트: 나머지 모자 × 머리 5종 (모자용 머리 변형)", async () => {
      const hairs = META.options.hair.filter((h) => h !== null);
      const hats = META.options.hat.filter((h) => h !== null && !META.hatHidesHair.includes(h));
      const rows = [];
      const bad = [];
      await wear(pa, "hair", hairs[0]);
      for (const hat of hats) {
        await wear(pa, "hat", hat);
        await contrastColors(pa, hat);
        const cells = [];
        for (const hair of hairs) {
          const s = await wear(pa, "hair", hair);
          const want = META.hatVariants[hair];
          if (!s.parts.includes(`hat__${hat}`) || !s.parts.includes(want) || s.parts.includes(`hair__${hair}`)) bad.push({ hat, hair, parts: s.parts });
          cells.push({ label: `${hair} · 앞`, png: await stageShot(pa, `hat-${hat}-${hair}-front`, FRONT) });
          cells.push({ label: `${hair} · 뒤`, png: await stageShot(pa, `hat-${hat}-${hair}-back`, BACK) });
        }
        rows.push({ label: META.chipLabels.hat[META.options.hat.indexOf(hat)], cells });
      }
      check(`${hats.length} hats × ${hairs.length} hairs: each draws the hat and hair__<id>__hat (never the plain hair)`, rows.length === hats.length && hats.length > 0 && bad.length === 0, { bad });
      await writeSheet("builder-hats-sheet.png", "모자(파랑, 왕관·티아라는 금색) × 머리 5종(진갈색) (모자용 머리 변형, 앞 · 뒤) — 머리카락이 모자를 뚫으면 안 됨", rows, { cellW: 140 });
    });

    await step("6g 시트의 모든 장면에 인형이 보임", async () => {
      check(`every preview shot (${stageShots}) shows the figure${SOFTWARE ? " (SwiftShader: an empty capture is retaken up to 3 times)" : " on the first capture"}`, stageShots > 0 && emptyShots.length === 0, {
        emptyShots,
        retakenCaptures: emptyCaptures.length,
        retaken: emptyCaptures.slice(0, 12),
      });
    });

    await step("7 목소리 여자 목소리", async () => {
      const [male, female] = META.voiceLabels;
      check(`setup: "${male}" is the checked voice`, (await voiceBtn(pa, male).getAttribute("aria-checked")) === "true");
      await voiceBtn(pa, female).click();
      await pollUntil(() => voiceBtn(pa, female).getAttribute("aria-checked"), (v) => v === "true", 3000);
      check(`"${female}" aria-checked="true", "${male}" "false"`, (await voiceBtn(pa, female).getAttribute("aria-checked")) === "true" && (await voiceBtn(pa, male).getAttribute("aria-checked")) === "false");
    });

    await step("8 미리보기 마우스 끌기 200 px → yaw +2.0", async () => {
      await pa.evaluate(() => window.__cvPreview.setYaw(0.5));
      await frames(pa, 2);
      const p0 = await preview(pa);
      const stage = await pa.locator(".cv-builder-stage").boundingBox();
      const x0 = stage.x + stage.width / 2 - 100;
      const y = p0.feet.y - 160;
      const hit = await pa.evaluate(({ x, y }) => {
        const el = document.elementFromPoint(x, y);
        return { tag: el?.tagName ?? null, inPreview: !!el?.closest(".cv-builder-preview"), button: !!el?.closest("button") };
      }, { x: x0, y });
      check("setup: the drag starts on the preview canvas", hit.tag === "CANVAS" && hit.inPreview && !hit.button, hit);
      await pa.mouse.move(x0, y);
      await pa.mouse.down();
      await pa.mouse.move(x0 + 200, y, { steps: 10 });
      await pa.mouse.up();
      await frames(pa, 2);
      const p1 = await preview(pa);
      const d = p1.yaw - p0.yaw;
      check("yaw changed by 2.0 ± 0.2 rad", Math.abs(d - 2.0) <= 0.2, { from: r2(p0.yaw), to: r2(p1.yaw), delta: r2(d) });
      await shot(pa, "builder-08-dragged.png");
    });

    await step("9 입장: A 조립A(기사), B 조립B(기본) — 같은 외형", async () => {
      // Ruling S8: the knight preset again right before entering, so A's motion row is the pants control.
      const s = await clickPreset(pa, "기사");
      check("(S8) 기사 pressed again: card pressed, wears pants, the voice stays 여자 목소리", (await pressedOf(presetBtn(pa, "기사"))) === "true" && s.key.split("|")[0].split(",")[4] === "pants" && (await voiceBtn(pa, META.voiceLabels[1]).getAttribute("aria-checked")) === "true", {
        key: s.key,
      });
      partsAtEntry = (await settle(pa)).parts;
      keyAtEntry = await lookKeyOf(pa);
      sidA = await enter(pa, NAME.A);
      const own = await avatarOf(pa, sidA);
      check("A in the world: __cvAvatars()[A.sid].parts == preview.parts just before 입장", !!own && partsAtEntry.length > 0 && eq(own.parts, partsAtEntry), { own: own?.parts, preview: partsAtEntry });
      check("the preview probe is gone with the entry screen", (await avatarOf(pa, "preview")) === null);
      await shot(pa, "builder-09-entered-A.png");

      B = await openPlayer(browser, { tag: "B" });
      const pb = B.page;
      pb.on("request", (req) => {
        if (req.url().includes("/api/npc-voice")) voiceReqs.push({ t: Date.now(), body: req.postData() });
      });
      const sb = await waitBuilder(pb);
      check("B's builder opens on the default look", sb.key === META.defaultKey && eq(sb.parts, DEFAULT_PARTS), { key: sb.key });
      sidB = await enter(pb, NAME.B);
      check("B's own parts are the default look's", eq((await avatarOf(pb, sidB))?.parts, DEFAULT_PARTS), { parts: (await avatarOf(pb, sidB))?.parts });

      const rA = await pollUntil(() => remoteOf(pb, sidA), (r) => !!r, 20000);
      const cached = await pa.evaluate(() => JSON.parse(localStorage.getItem("cv.entry") || "null"));
      check("A's localStorage cv.entry holds nickname 조립A and a 15-field appearance", cached?.nickname === NAME.A && Object.keys(cached?.appearance ?? {}).length === 15, cached);
      check("B: getRemotes() A.appearance == A's localStorage cv.entry appearance (all 15 fields)", !!rA && eq(Object.keys(rA.appearance).sort().map((k) => [k, rA.appearance[k]]), Object.keys(cached.appearance).sort().map((k) => [k, cached.appearance[k]])), {
        remote: rA?.appearance,
        cached: cached?.appearance,
      });
      const onB = await pollUntil(() => avatarOf(pb, sidA), (e) => !!e && e.parts.length > 0, 20000);
      check("B: __cvAvatars()[A.sid].parts == A's own parts", !!onB && eq(onB.parts, own.parts), { onB: onB?.parts });
      const all = await pb.evaluate(() => Object.entries(window.__cvAvatars()).map(([id, e]) => ({ id, drawMeshes: e.drawMeshes })));
      check("B: every avatar entry has drawMeshes ≤ 8 (players and AI 조교)", all.length >= 2 + 4 && all.every((e) => e.drawMeshes <= 8), { all });
      const ri = await pb.evaluate(() => window.__cvRenderInfo?.() ?? null);
      check("B: __cvRenderInfo() reports a drawn frame", !!ri && ri.calls > 0 && ri.triangles > 0, ri);
      await shot(pb, "builder-09-entered-B.png");
    });

    await step("10 목소리: A 채팅 → B의 /api/npc-voice gender female", async () => {
      const pb = B.page;
      await pa.bringToFront();
      const a = await getPos(pa);
      const b = await getPos(pb);
      check("setup: B is within the 15 m speech radius of A", dist(a, b) < 15, { d: r2(dist(a, b)) });
      const t0 = Date.now();
      await pa.keyboard.press("Slash");
      const f = await pollUntil(() => pa.evaluate(() => document.activeElement?.className ?? ""), (c) => /cv-chat-field/.test(c), 3000);
      check("/ focuses the chat field", /cv-chat-field/.test(f), { active: f });
      await pa.keyboard.type(CHAT_TEXT, { delay: 40 });
      await pa.keyboard.press("Enter");
      const bubble = await pollUntil(
        () => pb.evaluate((sid) => window.__cv.getBubbles().filter((x) => x.sid === sid).map((x) => x.text), sidA),
        (l) => l.includes(CHAT_TEXT),
        5000,
      );
      check(`B shows A's bubble "${CHAT_TEXT}"`, bubble.includes(CHAT_TEXT), { bubble });
      const req = await pollUntil(
        () => voiceReqs.filter((r) => r.t >= t0).map((r) => { try { return JSON.parse(r.body); } catch { return { raw: r.body }; } }).find((r) => r.text === CHAT_TEXT) ?? null,
        (r) => !!r,
        8000,
      );
      check('B requested /api/npc-voice for the line with gender "female"', !!req && req.gender === "female", req);
      await shot(pb, "builder-10-chat-B.png");
    });

    // ── 11: motion seen from B (first person, so B's own body never hides the figure) ──
    // B watches from just outside the spawn circle (radius 2 around (-15, 0)), so nobody spawns on top of it; the path
    // runs north→south 2.5 m to B's side, toward B.
    const PATH = { x: -10, z0: -14.5 };
    const B_SPOT = { x: -12.5, z: 1.5 };
    const A_ASIDE = { x: -6, z: -4 };
    const motionCells = { walk: null, run: null, jump: null };
    /** One subject's walk / run / jump in front of B, asserted on B and on the subject's own screen. */
    async function motionRow(subj, label, expect, rowTag) {
      const pb = B.page;
      const ps = subj.page;
      const cells = [];
      await startRecorder(pb, `clip-${rowTag}`, (sid) => ({ v: window.__cvAvatars?.()[sid]?.clip ?? null }), subj.sid);
      await startRecorder(ps, `own-${rowTag}`, (sid) => ({ v: window.__cvAvatars?.()[sid]?.clip ?? null }), subj.sid);
      const waitIdle = async () => {
        const both = await pollUntil(
          async () => ({ b: (await avatarOf(pb, subj.sid))?.clip, own: (await avatarOf(ps, subj.sid))?.clip }),
          (v) => v.b === expect.idle && v.own === expect.idle,
          6000,
          60,
        );
        return both;
      };
      /**
       * Hold `keys` for exactly `ms` (a timer, not the screenshot, decides when they are released — under SwiftShader a
       * capture can take seconds) while B's shot of the figure is requested `shotAt` ms in.
       */
      const hold = async (keys, ms, shotAt, name, lead) => {
        for (const k of keys) await ps.keyboard.down(k);
        const t0 = Date.now();
        const shotP = sleep(shotAt).then(() => shotFigure(pb, name, { sid: subj.sid, lead }));
        await sleep(Math.max(0, ms - (Date.now() - t0)));
        for (const k of [...keys].reverse()) await ps.keyboard.up(k);
        const moved = Date.now() - t0;
        return { t0, moved, png: (await shotP).png };
      };
      // Walk: W held 1 s.
      await ps.bringToFront();
      const walk = await hold(["w"], 1000, 600, `motion-${rowTag}-walk`, { dx: 0, dz: 1.5 });
      cells.push({ label: `걷기 · ${expect.walk}`, png: walk.png });
      await waitIdle();
      let rowsB = await rowsBetween(pb, `clip-${rowTag}`, walk.t0, Date.now());
      let rowsS = await rowsBetween(ps, `own-${rowTag}`, walk.t0, Date.now());
      check(`${label} W 1 s: B's __cvAvatars()[sid].clip showed ${expect.walk}`, clipsIn(rowsB).includes(expect.walk) && !clipsIn(rowsB).includes(expect.run), { clipsOnB: clipsIn(rowsB), heldMs: walk.moved });
      check(`…and its own __cvAvatars()[sid].clip showed ${expect.walk}`, clipsIn(rowsS).includes(expect.walk), { own: clipsIn(rowsS) });
      // Run: Shift+W held 1 s.
      await sleep(400);
      const run = await hold(["Shift", "w"], 1000, 400, `motion-${rowTag}-run`, { dx: 0, dz: 2.5 });
      cells.push({ label: `달리기 · ${expect.run}`, png: run.png });
      await waitIdle();
      rowsB = await rowsBetween(pb, `clip-${rowTag}`, run.t0, Date.now());
      rowsS = await rowsBetween(ps, `own-${rowTag}`, run.t0, Date.now());
      check(`${label} Shift+W 1 s: B showed ${expect.run}`, clipsIn(rowsB).includes(expect.run), { clipsOnB: clipsIn(rowsB), heldMs: run.moved });
      check(`…and its own screen showed ${expect.run}`, clipsIn(rowsS).includes(expect.run), { own: clipsIn(rowsS) });
      // Jump: Space (short — the 20 ms recorder is finer than the brief's 100 ms polling).
      await sleep(Math.max(300, META.jumpCooldownMs));
      const jd = Date.now();
      await ps.keyboard.press("Space");
      await sleep(200);
      cells.push({ label: `점프 · ${expect.jump}`, png: (await shotFigure(pb, `motion-${rowTag}-jump`, { sid: subj.sid, heightM: 3.2 })).png });
      const idle = await waitIdle();
      rowsB = await rowsBetween(pb, `clip-${rowTag}`, jd, Date.now());
      rowsS = await rowsBetween(ps, `own-${rowTag}`, jd, Date.now());
      check(`${label} Space: B showed ${expect.jump} at least once`, clipsIn(rowsB).includes(expect.jump), { clipsOnB: clipsIn(rowsB) });
      check(`…and its own screen showed ${expect.jump}`, clipsIn(rowsS).includes(expect.jump), { own: clipsIn(rowsS) });
      check(`${label} stopped: ${expect.idle} on B and on its own screen`, idle.b === expect.idle && idle.own === expect.idle, idle);
      await stopRecorder(pb, `clip-${rowTag}`);
      await stopRecorder(ps, `own-${rowTag}`);
      return cells;
    }
    /** The expected clips for a subject, from ITS synced appearance as B sees it (bottom → manifest clipVariants). */
    async function expectedFor(sid) {
      const r = await remoteOf(B.page, sid);
      const bottom = META.options.bottom[r.appearance.bottom];
      const viaClipFor = await B.page.evaluate(
        ({ a }) => ["Idle", "Walking_A", "Running_A", "Jump_Full_Short"].map((b) => window.__t10.clipFor(b, a)),
        { a: r.appearance },
      );
      const e = { bottom, idle: expectClip(bottom, "Idle"), walk: expectClip(bottom, "Walking_A"), run: expectClip(bottom, "Running_A"), jump: expectClip(bottom, "Jump_Full_Short") };
      check(`expected clips for ${r.nickname} (${bottom}): manifest clipVariants == clipFor(synced appearance)`, eq([e.idle, e.walk, e.run, e.jump], viaClipFor), { manifest: e, clipFor: viaClipFor });
      return e;
    }
    /** Put the subject at the start of the path, its camera looking down it (+Z, toward B). */
    async function toStart(subj) {
      const p = await walkTo(subj.page, PATH.x, PATH.z0, { tol: 0.4 });
      const yaw = await aimDrag(subj.page, Math.PI);
      check(`setup: ${subj.tag} at the path start, camera looking +Z`, Math.hypot(p.x - PATH.x, p.z - PATH.z0) < 0.8 && Math.abs(norm(yaw - Math.PI)) < 0.06, { x: r2(p.x), z: r2(p.z), yaw: r2(yaw) });
    }

    await step("11a 동작: B가 1인칭으로 길을 바라봄, A(기사, 바지 — 대조군) 걷기·달리기·점프", async () => {
      const pb = B.page;
      await ensureMods(pb);
      const at = await walkTo(pb, B_SPOT.x, B_SPOT.z, { tol: 0.4 });
      check("setup: B stands at its spot beside the path", Math.hypot(at.x - B_SPOT.x, at.z - B_SPOT.z) < 0.7, { x: r2(at.x), z: r2(at.z) });
      const fp = await setFp(pb, true);
      check("setup: B is in first person", fp.mode === "fp", { mode: fp.mode });
      const bp = await getPos(pb);
      const aimYaw = Math.atan2(-(PATH.x - bp.x), -(PATH.z0 + 7 - bp.z));
      const got = await aimDrag(pb, aimYaw, { fp: true });
      check("setup: B looks along the path", Math.abs(norm(got - aimYaw)) < 0.06, { want: r2(aimYaw), got: r2(got) });
      A.sid = sidA;
      await toStart(A);
      const e = await expectedFor(sidA);
      check("A (S8 knight) wears pants: the plain clips Walking_A / Running_A / Jump_Full_Short (the control row)", e.bottom === "pants" && e.walk === "Walking_A" && e.run === "Running_A" && e.jump === "Jump_Full_Short", e);
      const cells = await motionRow(A, "A", e, "A");
      motionRows.push({ label: "A 기사 (pants)", cells });
      await walkTo(pa, A_ASIDE.x, A_ASIDE.z, { tol: 0.6 });
    });

    // A only waits while C and D move: a small A window keeps the frame rate of the other tabs up (it matters on SwiftShader).
    await pa.setViewportSize({ width: 320, height: 200 });
    for (const [tag, presetLabel, nickname, wantBottom, wantClips] of [
      ["C", "공주", NAME.C, "longskirt", ["Walking_A_LongSkirt", "Running_A_LongSkirt", "Jump_Full_Short_LongSkirt"]],
      ["D", "요정", NAME.D, "petal_skirt", ["Walking_A_ShortSkirt", "Running_A_ShortSkirt", "Jump_Full_Short_ShortSkirt"]],
    ]) {
      await step(`11${tag === "C" ? "b" : "c"} 동작: ${tag} ${presetLabel}(${wantBottom}) 걷기·달리기·점프 — B와 ${tag} 자신의 화면${tag === "D" ? " (Ruling S4)" : " (Review Focus 7)"}`, async () => {
        const subj = await openPlayer(browser, { tag });
        if (tag === "C") C = subj;
        else D = subj;
        await waitBuilder(subj.page);
        const s = await clickPreset(subj.page, presetLabel);
        check(`${tag}: preset ${presetLabel} wears ${wantBottom}`, s.key.split("|")[0].split(",")[4] === wantBottom, { key: s.key });
        subj.sid = await enter(subj.page, nickname);
        await pollUntil(() => remoteOf(B.page, subj.sid), (r) => !!r, 20000);
        await pollUntil(() => avatarOf(B.page, subj.sid), (x) => !!x, 20000);
        await toStart(subj);
        const e = await expectedFor(subj.sid);
        // Literal names (Ruling S4 / GC clip list), and the manifest's clipVariants must agree with them.
        const lit = wantClips;
        const fromManifest = [expectClip(wantBottom, "Walking_A"), expectClip(wantBottom, "Running_A"), expectClip(wantBottom, "Jump_Full_Short")];
        check(`${tag}'s expected clips: ${lit.join(" / ")} (Idle when stopped)`, e.bottom === wantBottom && eq([e.walk, e.run, e.jump], lit) && eq(fromManifest, lit) && e.idle === "Idle", { ...e, fromManifest });
        const cells = await motionRow(subj, tag, e, tag);
        motionRows.push({ label: `${tag} ${presetLabel} (${wantBottom})`, cells });
        await subj.ctx.close();
        if (tag === "C") C = null;
        else D = null;
      });
    }

    await pa.setViewportSize(VIEW);
    await step("11d 동작: A 의자 앉기 → B에서 seatIndex ≥ 0 → 일어서기", async () => {
      const pb = B.page;
      await setFp(pb, false);
      const seatIndex = META.seats.findIndex((s) => Math.abs(s.z - 3) < 0.01 && s.x < 4);
      const seat = META.seats[seatIndex];
      // Beside the row, level with the chair: a side view of the seated figure (the desk hides it from the front).
      const VIEWPOINT = { x: seat.x, z: seat.z + 3.5 };
      // B first (through the door, up the aisle), then A — never both in the doorway.
      const bp = await walkPath(pb, [[-2.5, 0.5, 0.5], [1.3, 0.5, 0.45], [1.3, VIEWPOINT.z, 0.4], [VIEWPOINT.x, VIEWPOINT.z, 0.3]]);
      check("setup: B stands beside the row, level with the chair", Math.hypot(bp.x - VIEWPOINT.x, bp.z - VIEWPOINT.z) < 0.7, { x: r2(bp.x), z: r2(bp.z) });
      const ap = await walkPath(pa, [[-2.5, 0, 0.5], [1.4, 0, 0.45], [seat.standX, seat.standZ, 0.3]]);
      check(`setup: A at seat ${seatIndex}'s dismount point`, Math.hypot(ap.x - seat.standX, ap.z - seat.standZ) < 0.6, { x: r2(ap.x), z: r2(ap.z), seat });
      await setFp(pb, true);
      const want = Math.atan2(-(seat.x - bp.x), -(seat.z - bp.z));
      await aimDrag(pb, want, { fp: true });
      await startRecorder(pb, "clip-sit", (sid) => ({ v: window.__cvAvatars?.()[sid]?.clip ?? null }), sidA);
      await pa.bringToFront();
      const t0 = Date.now();
      await pa.keyboard.press("e");
      const own = await pollUntil(() => getPos(pa), (p) => p.seatIndex >= 0, 6000);
      const onB = await pollUntil(() => remoteOf(pb, sidA), (r) => !!r && r.seatIndex >= 0, 6000);
      check("E → A seated; B's getRemotes() A.seatIndex ≥ 0", own.seatIndex === seatIndex && !!onB && onB.seatIndex === seatIndex, { own: own.seatIndex, onB: onB?.seatIndex });
      await pollUntil(() => avatarOf(pb, sidA), (x) => x?.clip === "Sit_Chair_Idle", 5000);
      await sleep(300);
      const sitShot = await shotFigure(pb, "motion-A-sit", { at: { x: seat.x, z: seat.z }, heightM: 2.9 });
      const rows = await rowsBetween(pb, "clip-sit", t0, Date.now());
      check("B: A's clip went Sit_Chair_Down → Sit_Chair_Idle", clipsIn(rows).includes("Sit_Chair_Down") && clipsIn(rows).includes("Sit_Chair_Idle"), { clips: clipsIn(rows) });
      motionRows[0]?.cells.push({ label: "앉기 · Sit_Chair_Idle", png: sitShot.png });
      const t1 = Date.now();
      await pa.keyboard.press("e");
      const up = await pollUntil(() => remoteOf(pb, sidA), (r) => !!r && r.seatIndex === -1, 6000);
      const ownUp = await pollUntil(() => getPos(pa), (p) => p.seatIndex === -1, 6000);
      const idle = await pollUntil(() => avatarOf(pb, sidA), (x) => x?.clip === "Idle", 6000);
      const rows2 = await rowsBetween(pb, "clip-sit", t1, Date.now());
      check("E again → stands up: seatIndex −1 on A and on B, B played Sit_Chair_StandUp → Idle", ownUp.seatIndex === -1 && up?.seatIndex === -1 && clipsIn(rows2).includes("Sit_Chair_StandUp") && idle?.clip === "Idle", {
        own: ownUp.seatIndex,
        onB: up?.seatIndex,
        clips: clipsIn(rows2),
      });
      await stopRecorder(pb, "clip-sit");
    });

    await step("11e 동작 시트", async () => {
      check("motion rows: A (walk, run, jump, sit), C and D (walk, run, jump)", motionRows.length === 3 && motionRows[0].cells.length === 4 && motionRows.slice(1).every((r) => r.cells.length === 3), motionRows.map((r) => [r.label, r.cells.length]));
      await writeSheet("builder-motion-sheet.png", "동작 시트 (B 화면, 1인칭): A 기사 = 바지 대조군 / C 공주 롱스커트 / D 요정 꽃잎 치마", motionRows, { cellW: 220 });
    });

    await step("12 재접속: A 연결 끊김 → B에서 connected false → 복귀 후 같은 외형", async () => {
      const pb = B.page;
      const beforeB = (await avatarOf(pb, sidA))?.parts;
      const beforeOwn = (await avatarOf(pa, sidA))?.parts;
      check("setup: B and A both hold A's parts", !!beforeB && !!beforeOwn && eq(beforeB, beforeOwn), { beforeB });
      // Hold A in the reconnection window (its re-join matchmake is blocked) so B's ghost can be seen and shot.
      await pa.route("**/matchmake/**", (route) => route.abort());
      await pa.evaluate(() => window.__cv.dropConnection());
      const ghost = await pollUntil(() => remoteOf(pb, sidA), (r) => !!r && r.connected === false, 8000, 60);
      check("B: getRemotes() A.connected === false", !!ghost && ghost.connected === false, { connected: ghost?.connected });
      await sleep(400);
      const ghostShot = await shotFigure(pb, "reconnect-ghost-B", { sid: sidA });
      await shot(pb, "builder-12-ghost-B.png");
      await shot(pa, "builder-12-reconnecting-A.png");
      await pa.unroute("**/matchmake/**");
      await pa.locator(".cv-reconnecting").waitFor({ state: "hidden", timeout: 30000 });
      await pa.waitForFunction(() => typeof window.__cv?.getSessionId === "function", null, { timeout: 20000 });
      const sidAfter = await pa.evaluate(() => window.__cv.getSessionId());
      check("A came back on the same session (reconnection, not a new join)", sidAfter === sidA, { sidA, sidAfter });
      const back = await pollUntil(() => remoteOf(pb, sidA), (r) => !!r && r.connected === true, 15000, 80);
      check("B: A.connected === true again", back?.connected === true);
      const afterB = await pollUntil(() => avatarOf(pb, sidA), (x) => !!x && x.parts.length > 0, 10000);
      const afterOwn = await pollUntil(() => avatarOf(pa, sidA), (x) => !!x && x.parts.length > 0 && x.clip !== null, 10000);
      check("B's __cvAvatars()[A.sid].parts unchanged", eq(afterB?.parts, beforeB), { afterB: afterB?.parts });
      check("A's own parts unchanged after the remount", eq(afterOwn?.parts, beforeOwn), { afterOwn: afterOwn?.parts });
      // Front view of A's face from its own camera (orbit turned to face the body).
      await pa.bringToFront();
      const pose = await getPos(pa);
      await aimDrag(pa, norm(pose.yaw));
      await sleep(700);
      await shot(pa, "builder-12-front-A.png");
      const face = await pa.screenshot({ clip: { x: VIEW.width / 2 - 200, y: 120, width: 400, height: 460 } });
      writeFileSync(join(SHOTS, "reconnect-front-A.png"), face);
      const bView = await shotFigure(pb, "reconnect-back-B", { sid: sidA });
      await writeSheet("builder-reconnect-sheet.png", "재접속: B의 끊김 표시 → 복귀 후 A 정면(자기 화면) · B 화면", [
        { label: "재접속", cells: [{ label: "B: connected=false", png: ghostShot.png }, { label: "복귀 후 A 정면", png: face }, { label: "복귀 후 B 화면", png: bView.png }] },
      ], { cellW: 300 });
    });

    await step("13 A 새로고침 → 마지막 외형 기억", async () => {
      await pa.reload({ waitUntil: "domcontentloaded" });
      const s = await waitBuilder(pa);
      const nick = await pa.locator("input.cv-input").first().inputValue();
      check('the nickname field reads "조립A"', nick === NAME.A, { nick });
      check("preview.parts == the step-9 parts", partsAtEntry?.length > 0 && eq(s.parts, partsAtEntry), { parts: s.parts, step9: partsAtEntry });
      check("…the whole look (colours too) and the 여자 목소리 voice are back", s.key === keyAtEntry && (await voiceBtn(pa, META.voiceLabels[1]).getAttribute("aria-checked")) === "true", { key: s.key });
      await shot(pa, "builder-13-reload-A.png");
    });

    await step("14 예전 저장값 {nickname 옛사람, character 5, tint 3}", async () => {
      E = await openPlayer(browser, { tag: "E", oldCache: true });
      const pe = E.page;
      const s = await waitBuilder(pe);
      const nick = await pe.locator("input.cv-input").first().inputValue();
      check('nickname "옛사람" kept from the old cache', nick === "옛사람", { nick });
      check("preview.parts == the default look (and the whole default look key)", eq(s.parts, DEFAULT_PARTS) && s.key === META.defaultKey, { parts: s.parts, key: s.key });
      await shot(pe, "builder-14-old-cache.png");
      E.sid = await enter(pe, "옛사람");
      const own = await avatarOf(pe, E.sid);
      check("입장 succeeds with the default parts", !!E.sid && eq(own?.parts, DEFAULT_PARTS), { sid: E.sid, parts: own?.parts });
      const cached = await pe.evaluate(() => JSON.parse(localStorage.getItem("cv.entry") || "null"));
      check("…and the cache is rewritten in the new shape", cached?.nickname === "옛사람" && Object.keys(cached?.appearance ?? {}).length === 15 && !("character" in (cached ?? {})), cached);
    });

    // A and E are done: closing them leaves B the only world tab for the walk across the hall.
    for (const p of [A, E]) await p?.ctx.close().catch(() => {});
    A = E = null;
    await step("15 강의실 AI 조교: 안드로이드 옷", async () => {
      const pb = B.page;
      const npc = await avatarOf(pb, "npc:hall");
      const want = ["top__android", "bottom__android", "shoes__android"];
      check('__cvAvatars()["npc:hall"].parts has top/bottom/shoes__android', !!npc && want.every((p) => npc.parts.includes(p)), { parts: npc?.parts });
      await setFp(pb, false);
      const spot = { x: META.npcHall.x - 3.6, z: META.npcHall.z };
      // Out of the row into the aisle by the divider, down to the door corridor (z = 0), across the hall.
      const p = await walkPath(pb, [[1.3, (await getPos(pb)).z, 0.4], [1.3, 0, 0.5], [22, 0, 0.6], [spot.x, spot.z, 0.35]]);
      check("setup: B stands in front of the hall assistant", Math.hypot(p.x - spot.x, p.z - spot.z) < 0.7, { x: r2(p.x), z: r2(p.z) });
      await setFp(pb, true);
      await aimDrag(pb, Math.atan2(-(META.npcHall.x - p.x), -(META.npcHall.z - p.z)), { fp: true });
      await sleep(500);
      await shot(pb, "builder-15-npc-hall.png");
      await shotFigure(pb, "npc-hall", { at: META.npcHall, heightM: 2.6 });
    });
  } catch (err) {
    currentStep = "fatal (desktop)";
    check("desktop part ran to the end", false, String(err && err.stack ? err.stack : err));
  }

  // ════════════════════════════ phone ════════════════════════════
  try {
    for (const p of [A, B, C, D, E]) await p?.ctx.close().catch(() => {});
    M = await openPlayer(browser, { tag: "M", phone: true });
    const pm = M.page;
    const touch = makeTouch(await M.ctx.newCDPSession(pm));
    await waitBuilder(pm);
    if (!META) META = await pm.evaluate(() => window.__t10.meta());

    await step("M1 휴대폰 입장 화면: 가로 넘침 없음, 미리보기 크기", async () => {
      const w = await pm.evaluate(() => {
        const d = document.documentElement;
        const e = document.querySelector(".cv-entry");
        return { layout: e?.dataset.layout, docSW: d.scrollWidth, docCW: d.clientWidth, entSW: e?.scrollWidth, entCW: e?.clientWidth };
      });
      check("phone layout (bottom sheet)", w.layout === "phone", w);
      check("document.documentElement scrollWidth ≤ clientWidth (≤ 375)", w.docSW <= w.docCW && w.docSW <= PHONE.width, w);
      check(".cv-entry scrollWidth ≤ clientWidth (Ruling S22/S23)", w.entSW <= w.entCW, w);
      const r = await rectOf(pm, ".cv-builder-preview");
      check(".cv-builder-preview height ≥ 200 and starts within the top 812 px", !!r && r.h >= 200 && r.y >= 0 && r.y < PHONE.height, r);
      await shot(pm, "m-builder-01-top.png");
    });

    await step("M2 44×44 이상, 서로 겹치지 않음 (탭 7개 모두)", async () => {
      const report = [];
      for (const slot of META.slots) {
        const t = tabBtn(pm, META.slotLabels[slot]);
        await t.scrollIntoViewIfNeeded();
        await t.tap();
        await pollUntil(() => t.getAttribute("aria-selected"), (v) => v === "true", 3000);
        // Let the press feedback (:active scale 0.96 — it starts a moment after tap() returns, and eases back in
        // 0.12 s) and the chips' entrance finish first: measured is the resting size, not the press flash.
        await sleep(150);
        await pollUntil(
          () =>
            pm.evaluate(() =>
              [...document.querySelectorAll(".cv-chip, .cv-swatch, .cv-preset, .cv-random, .cv-voice-option, [role=tab]")].every(
                (e) => !e.matches(":active") && e.getAnimations().every((a) => a.playState !== "running"),
              ),
            ),
          (done) => done,
          4000,
          50,
        );
        const r = await pm.evaluate(() => {
          const els = [...document.querySelectorAll(".cv-chip, .cv-swatch, .cv-preset, .cv-random, .cv-voice-option, [role=tab]")].filter(
            (e) => e.getClientRects().length > 0 && (e.checkVisibility ? e.checkVisibility({ visibilityProperty: true }) : true),
          );
          const box = els.map((e) => {
            const b = e.getBoundingClientRect();
            return { cls: e.className.split(" ")[0] || e.getAttribute("role"), name: (e.getAttribute("aria-label") || e.textContent || "").trim().slice(0, 12), x: b.x, y: b.y, w: b.width, h: b.height };
          });
          const small = box.filter((b) => b.w < 44 - 0.01 || b.h < 44 - 0.01);
          const overlaps = [];
          for (let i = 0; i < box.length; i++)
            for (let j = i + 1; j < box.length; j++) {
              const a = box[i];
              const b = box[j];
              const ix = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
              const iy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
              if (ix > 0.5 && iy > 0.5) overlaps.push([`${a.cls}:${a.name}`, `${b.cls}:${b.name}`]);
            }
          const kinds = {};
          for (const b of box) kinds[b.cls] = (kinds[b.cls] || 0) + 1;
          return { n: box.length, kinds, small, overlaps, minW: Math.min(...box.map((b) => b.w)), minH: Math.min(...box.map((b) => b.h)) };
        });
        // The open tab names its slot: the word is shown (not visually hidden), inside the tab and not cut (Task 7b fix
        // round 2 item 2.1 — the phone hides .cv-slot-head, so nothing else names the open tab).
        const word = await pm.evaluate(() => {
          const tab = document.querySelector(".cv-slot-tab[aria-selected='true']");
          const label = tab?.querySelector(".cv-slot-tab-label");
          if (!tab || !label) return null;
          const t = tab.getBoundingClientRect();
          const l = label.getBoundingClientRect();
          const cs = getComputedStyle(label);
          const visible = cs.position !== "absolute" && cs.clipPath === "none" && cs.visibility !== "hidden" && l.width > 4 && l.height > 4;
          const inside = l.left >= t.left - 0.5 && l.right <= t.right + 0.5 && l.top >= t.top - 0.5 && l.bottom <= t.bottom + 0.5;
          return { text: label.textContent, visible, inside, fits: label.scrollWidth <= label.clientWidth + 1, font: cs.fontSize, tabW: Math.round(t.width) };
        });
        report.push({ slot, ...r, word });
      }
      check(
        "375×812: the open tab shows its word (visible, inside the tab, not cut) for each of the 7 tabs",
        report.every((r) => r.word && r.word.text === META.slotLabels[r.slot] && r.word.visible && r.word.inside && r.word.fits),
        report.map((r) => ({ slot: r.slot, ...r.word })),
      );
      const allKinds = ["cv-chip", "cv-preset", "cv-random", "cv-voice-option", "cv-slot-tab"];
      check("every tab: chips, presets, 🎲, voice options and 7 tabs are present", report.length === 7 && report.every((r) => allKinds.every((k) => (r.kinds[k] || 0) > 0) && r.kinds["cv-slot-tab"] === 7), report.map((r) => ({ slot: r.slot, kinds: r.kinds })));
      check("…and swatches on the tabs that wear something", report.some((r) => (r.kinds["cv-swatch"] || 0) >= 5), report.map((r) => ({ slot: r.slot, swatches: r.kinds["cv-swatch"] || 0 })));
      check("every control is ≥ 44×44 CSS px", report.every((r) => r.small.length === 0), report.map((r) => ({ slot: r.slot, minW: r2(r.minW), minH: r2(r.minH), small: r.small })));
      check("no two controls overlap", report.every((r) => r.overlaps.length === 0), report.map((r) => ({ slot: r.slot, overlaps: r.overlaps.slice(0, 5) })));
      await tabBtn(pm, META.slotLabels.hat).tap();
    });

    await step("M2b 관리자 토글: aria-controls는 열려 있을 때만", async () => {
      const admin = () =>
        pm.evaluate(() => {
          const link = document.querySelector(".cv-admin-link");
          const controls = link.getAttribute("aria-controls");
          return {
            expanded: link.getAttribute("aria-expanded"),
            controls,
            target: controls ? !!document.getElementById(controls) : null,
            open: !!document.querySelector(".cv-admin-pop"),
          };
        });
      const closed = await admin();
      await pm.locator(".cv-admin-link").tap();
      const opened = await pollUntil(admin, (a) => a.open, 3000);
      await pm.keyboard.press("Escape"); // closes it again; no code was typed, so M5 still enters as a normal user
      const closedAgain = await pollUntil(admin, (a) => !a.open, 3000);
      check(
        "the admin toggle has aria-controls only while its popover is open (pointing at it), none while closed",
        closed.expanded === "false" && closed.controls === null && !closed.open &&
          opened.expanded === "true" && opened.controls === "cv-admin-pop" && opened.target === true &&
          closedAgain.expanded === "false" && closedAgain.controls === null && !closedAgain.open,
        { closed, opened, closedAgain },
      );
    });

    await step("M3 입장 버튼이 화면 안", async () => {
      await pm.locator(".cv-submit").scrollIntoViewIfNeeded();
      const b = await pm.locator(".cv-submit").boundingBox();
      check(".cv-submit's box is inside the 375×812 screen", !!b && b.x >= 0 && b.y >= 0 && b.x + b.width <= PHONE.width && b.y + b.height <= PHONE.height && b.height >= 44, b);
    });

    await step("M4 터치: 미리보기 가로 끌기 = 돌리기, 세로 끌기 = 시트 스크롤", async () => {
      const yaw = async () => (await preview(pm)).yaw;
      const scrollTop = () => pm.evaluate(() => document.querySelector(".cv-sheet-body").scrollTop);
      const resetScroll = () => pm.evaluate(() => (document.querySelector(".cv-sheet-body").scrollTop = 0));
      const stage = await rectOf(pm, ".cv-builder-stage");
      const prevBox = await rectOf(pm, ".cv-builder-preview");
      const y = stage.y + stage.h * 0.42;
      const hitAt = (x, y) =>
        pm.evaluate(({ x, y }) => {
          const el = document.elementFromPoint(x, y);
          return { tag: el?.tagName ?? null, inPreview: !!el?.closest(".cv-builder-preview"), button: !!el?.closest("button"), inSheet: !!el?.closest(".cv-sheet-body") };
        }, { x, y });
      const h0 = await hitAt(90, y);
      check("setup: the sideways drag starts on the preview canvas", h0.tag === "CANVAS" && h0.inPreview && !h0.button, { ...h0, y: r2(y) });
      await resetScroll();
      await pm.evaluate(() => window.__cvPreview.setYaw(0.5));
      await frames(pm, 2);
      let y0 = await yaw();
      await touch.drag(1, 90, y, 290, y);
      await frames(pm, 2);
      let y1 = await yaw();
      check("sideways touch drag (200 px) on the preview turns the figure (≈ 2.0 rad)", Math.abs(y1 - y0 - 2.0) <= 0.3, { delta: r2(y1 - y0) });

      // Up on the preview: the sheet scrolls, the figure does not turn (Ruling S22).
      await resetScroll();
      const vy0 = Math.min(prevBox.y + prevBox.h - 20, stage.y + stage.h * 0.7);
      const h1 = await hitAt(187, vy0);
      check("setup: the upward drag starts on the preview", h1.inPreview && !h1.button, { ...h1, y: r2(vy0) });
      y0 = await yaw();
      const s0 = await scrollTop();
      await touch.drag(2, 187, vy0, 187, vy0 - 180);
      await sleep(200);
      y1 = await yaw();
      const s1 = await scrollTop();
      check("upward touch drag on the preview: .cv-sheet-body scrollTop grows", s1 > s0 + 40, { before: s0, after: s1 });
      check("…and the preview yaw does not change", Math.abs(y1 - y0) < 0.005, { delta: y1 - y0 });

      // Up on the sheet itself: the sheet scrolls natively, the figure does not turn.
      await resetScroll();
      await sleep(150);
      const sheet = await rectOf(pm, ".cv-builder-panel");
      const sy0 = Math.min(PHONE.height - 140, sheet.y + 220);
      const h2 = await hitAt(187, sy0);
      check("setup: the second upward drag starts inside the sheet", h2.inSheet, { ...h2, y: r2(sy0) });
      y0 = await yaw();
      const t0 = await scrollTop();
      await touch.drag(3, 187, sy0, 187, sy0 - 220, { steps: 20, stepMs: 16 });
      await sleep(500);
      y1 = await yaw();
      const t1 = await scrollTop();
      check("upward touch drag on the sheet: .cv-sheet-body scrollTop grows", t1 > t0 + 40, { before: t0, after: t1 });
      check("…and the preview yaw does not change", Math.abs(y1 - y0) < 0.005, { delta: y1 - y0 });

      // M6 (2/3): the sheet scrolled to its end.
      await pm.evaluate(() => {
        const b = document.querySelector(".cv-sheet-body");
        b.scrollTop = b.scrollHeight;
      });
      await sleep(300);
      await shot(pm, "m-builder-02-scrolled.png");
      await resetScroll();
    });

    await step("M5 마법사 톡 → 입장 → 내 부품", async () => {
      const s = await change(pm, () => presetBtn(pm, "마법사").tap());
      check("the 마법사 card is pressed and the preview wears it", (await pressedOf(presetBtn(pm, "마법사"))) === "true" && s.parts.includes("hat__wizard"), { parts: s.parts });
      await pm.locator("input.cv-input").first().fill(NAME.M);
      await pm.locator(".cv-submit").tap();
      await pm.waitForFunction(() => typeof window.__cv?.getSessionId === "function", null, { timeout: 90000 });
      const self = await pm.evaluate(() => window.__cv.getSessionId());
      const own = await pollUntil(() => avatarOf(pm, self), (e) => !!e && e.parts.length > 0, 30000);
      const want = ["hat__wizard", "top__robe", "shoes__wizard_shoes", "item__staff"];
      check("__cvAvatars()[self].parts has hat__wizard, top__robe, shoes__wizard_shoes, item__staff", !!own && want.every((p) => own.parts.includes(p)), { parts: own?.parts });
      await sleep(1500);
      await shot(pm, "m-builder-03-world.png");
    });
  } catch (err) {
    currentStep = "fatal (phone)";
    check("phone part ran to the end", false, String(err && err.stack ? err.stack : err));
  }

  currentStep = "errors";
  check("0 console / page errors on every tab", errors.length === 0, errors);
  writeFileSync(join(EVIDENCE, "assertions-builder.json"), JSON.stringify({ url: CLIENT_URL, render: SOFTWARE ? "swiftshader" : "gpu", results, errors, emptyCaptures }, null, 2));
} finally {
  await browser.close().catch(() => {});
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} assertions passed`);
if (failed.length) {
  console.error("FAILED:\n- " + failed.map((r) => `[${r.step}] ${r.name}`).join("\n- "));
  process.exit(1);
}
console.log("E2E PASSED — 조립실 → 입장 → 원격 외형 일치·동작 클립·재접속·옛 저장값·휴대폰, 콘솔 오류 0.");
process.exit(0);
