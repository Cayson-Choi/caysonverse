// Shared helpers of the 케이슨 마을 E2E scripts (e2e/village-*.mjs and the camera / click / remote / chat scripts). Plain
// Playwright against the dev stack, in the style of the other e2e scripts:
//
//   server:  PORT=2811 npx tsx src/index.ts                                       (in server/)
//   client:  VITE_SERVER_URL=http://localhost:2811 npx vite --port 5411 --strictPort   (in client/)
//   CV_CLIENT_URL=http://localhost:5411 node e2e/village-desktop.mjs               # CV_CLIENT_URL defaults to http://localhost:5173
//
// Console policy (exit code 1 on anything else): the only console lines allowed are the known react-three-fiber
// THREE.Clock deprecation warning. Any other console error/warning or page error fails the run.
//
// Page code reaches the app's modules through `window.__imp(path)`: it imports the SAME module instance the app
// loaded (Vite appends ?t=… versions; a plain import("/src/…") would create a second copy with its own state).

import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO = resolve(HERE, "..", "..");
export const CLIENT_URL = process.env.CV_CLIENT_URL || "http://localhost:5173";
export const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "village");
mkdirSync(EVIDENCE, { recursive: true });

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const DESKTOP = { viewport: { width: 1280, height: 800 } };
export const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const r2 = (n) => Math.round(n * 100) / 100;

// ───────────────────────────────────── a run: checks, errors, evidence ─────────────────────────────────────

/** Console lines that are expected (the known Clock warning). */
const ALLOWED_CONSOLE = [
  { name: "THREE.Clock deprecation", re: /THREE\.Clock/ },
];

export function createRun(name) {
  const results = [];
  const errors = [];
  const allowed = {};
  /** Temporary allowances (see run.allow). */
  const extraAllowed = [];
  let currentStep = "setup";
  const run = {
    name,
    results,
    errors,
    allowed,
    evidence: join(EVIDENCE, name),
    check(label, ok, detail) {
      const row = { step: currentStep, name: label, ok: !!ok, detail: detail === undefined ? null : detail };
      results.push(row);
      const text = detail === undefined ? "" : "  " + (typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400);
      console.log(`${ok ? "PASS" : "FAIL"}  [${currentStep}] ${label}${text}`);
      return !!ok;
    },
    async step(title, fn) {
      currentStep = title;
      console.log(`\n── ${title}`);
      try {
        await fn();
      } catch (err) {
        run.check("step ran to the end", false, String(err && err.stack ? err.stack : err).slice(0, 900));
      }
    },
    /**
     * Allow one more console line for a while: the Colyseus SDK logs "Room connection was closed unexpectedly (4002)" when the
     * server refuses a join. Returns the function that ends the allowance.
     */
    allow(label, re) {
      const entry = { name: label, re };
      extraAllowed.push(entry);
      return () => extraAllowed.splice(extraAllowed.indexOf(entry), 1);
    },
    /** Console + page error watcher for one page. */
    watch(page, tag) {
      page.on("pageerror", (e) => errors.push(`[${tag}] pageerror: ${e.message}`));
      page.on("console", (m) => {
        const type = m.type();
        if (type !== "error" && type !== "warning") return;
        const text = m.text();
        const hit = [...ALLOWED_CONSOLE, ...extraAllowed].find((a) => a.re.test(text));
        if (hit) {
          allowed[hit.name] = (allowed[hit.name] ?? 0) + 1;
          return;
        }
        errors.push(`[${tag}] console.${type}: ${text.slice(0, 300)}`);
      });
    },
    /** Screenshot into the evidence folder (never fails the run). */
    async shot(player, file) {
      const page = player.page ?? player;
      mkdirSync(run.evidence, { recursive: true });
      await page.screenshot({ path: join(run.evidence, file) }).catch(() => {});
    },
    /** Write the evidence JSON, print the totals, return the exit code. */
    finish(extra = {}) {
      mkdirSync(run.evidence, { recursive: true });
      const failed = results.filter((r) => !r.ok).length;
      if (errors.length) results.push({ step: "end", name: "no unexpected console/page errors", ok: false, detail: errors.slice(0, 12) });
      else results.push({ step: "end", name: "no unexpected console/page errors", ok: true, detail: { allowedConsole: allowed } });
      console.log(errors.length ? `FAIL  [end] no unexpected console/page errors` : `PASS  [end] no unexpected console/page errors  ${JSON.stringify(allowed)}`);
      for (const e of errors.slice(0, 12)) console.log("   " + e);
      writeFileSync(join(run.evidence, `assertions-${name}.json`), JSON.stringify({ results, errors, allowedConsole: allowed, ...extra }, null, 2));
      const bad = results.filter((r) => !r.ok).length;
      console.log(`\n${results.length - bad}/${results.length} passed${failed !== bad ? " (console errors counted)" : ""}; unexpected console/page errors: ${errors.length}`);
      return bad === 0 ? 0 : 1;
    },
  };
  return run;
}

/** Same launch as the other e2e scripts: the real GPU (ANGLE/D3D11 on Windows) by default; CV_E2E_RENDER=software forces SwiftShader. */
export async function launchBrowser() {
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

// ───────────────────────────────────────── players (tabs) ─────────────────────────────────────────

/**
 * A new tab in its own browser context: the module-instance importer and the settings seed (coach marks off; `graphics` and
 * the like through `settings`) are installed before any page script runs.
 */
export async function openPlayer(browser, run, { tag, device = DESKTOP, settings = {}, acceptDownloads = false }) {
  const ctx = await browser.newContext({ ...device, acceptDownloads });
  await ctx.addInitScript(() => {
    window.__imp = (p) => {
      const u = performance.getEntriesByType("resource").map((r) => r.name).find((n) => n.split("?")[0].endsWith(p));
      return import(/* @vite-ignore */ u ?? p);
    };
  });
  await ctx.addInitScript((extra) => {
    try {
      if (!localStorage.getItem("cv-settings-v1")) localStorage.setItem("cv-settings-v1", JSON.stringify({ coachDone: true, ...extra }));
    } catch {}
  }, settings);
  const page = await ctx.newPage();
  run.watch(page, tag);
  const touch = !!device.hasTouch;
  // The model files this tab fetched (name → bytes), in order: the first-load report reads them.
  const assets = [];
  page.on("response", async (r) => {
    const url = r.url();
    if (!/\/(models\/village|draco)\//.test(url)) return;
    let bytes = 0;
    try {
      bytes = (await r.body()).length;
    } catch {}
    assets.push({ url: url.replace(/^https?:\/\/[^/]+/, "").split("?")[0], bytes, status: r.status() });
  });
  return { tag, page, ctx, touch, name: tag, assets };
}

/** `click` on a desktop tab, `tap` on a touch tab. */
export const press = (p, locator) => (p.touch ? locator.tap() : locator.click());

/** Open the entry screen (the builder) and wait until the nickname box and the builder are ready. A reload keeps the query. */
export async function toEntry(p, url = CLIENT_URL + "/") {
  await p.page.goto(url, { waitUntil: "domcontentloaded" });
  await entryReady(p);
}
/** The entry screen is on (after a goto or a reload): the nickname box and the builder are ready. */
export async function entryReady(p) {
  await p.page.locator("input.cv-input").first().waitFor({ state: "visible", timeout: 30000 });
  await p.page.waitForFunction(() => !document.querySelector(".cv-builder-hint.is-loading"), null, { timeout: 30000 }).catch(() => {});
  await sleep(700);
}

// ───────────────────────────────────────── page-state helpers ─────────────────────────────────────────

export const text = async (loc) => ((await loc.count()) ? ((await loc.first().textContent()) ?? "").trim() : "");
export const pos = (p) => p.page.evaluate(() => window.__cv.getPos());
export const screenOf = (p) => p.page.evaluate(() => window.__cv?.getScreen?.());
export const vis = (p, sel, ms = 8000) => p.page.locator(sel).first().waitFor({ state: "visible", timeout: ms }).then(() => true, () => false);
export const gone = (p, sel, ms = 8000) => p.page.waitForFunction((s) => !document.querySelector(s), sel, { timeout: ms }).then(() => true, () => false);
export const topOverlay = (p) => p.page.evaluate(async () => (await window.__imp("/src/ui/overlayStack.ts")).topOverlay()?.id ?? null);

/** The interact targets near the player (what E / the action button picks from), nearest first as the client sorts them. */
export const targets = (p) =>
  p.page.evaluate(async () => {
    const m = await window.__imp("/src/game/interactTargets.ts");
    return m.getTargets(window.__cv.getPos()).map((t) => ({ id: t.id, label: t.label, hold: !!t.hold, dist: Math.round(t.dist * 100) / 100, pri: t.priority ?? 0 }));
  });

export const walkTo = (p, x, z) => p.page.evaluate(async ([x, z]) => (await window.__imp("/src/game/clickMove.ts")).setClickTarget(x, z), [x, z]);
const clickTarget = (p) => p.page.evaluate(() => window.__cvClickTarget());
export async function waitIdle(p, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await clickTarget(p)) === null) return true;
    await sleep(150);
  }
  return false;
}
/** Click-move to (x, z), retrying a few times; returns the final position. */
export async function walkAndWait(p, x, z, ms = 30000, tol = 0.8) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await walkTo(p, x, z);
    await sleep(400);
    await waitIdle(p, ms);
    await sleep(400);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
    await sleep(1000);
  }
  return pos(p);
}
/** Turn the camera (Z / C keys) until it looks from behind the avatar toward (tx, tz). */
export async function turnCameraTo(p, tx, tz) {
  for (let k = 0; k < 14; k++) {
    const o = await p.page.evaluate(() => window.__cv.getOrbit());
    const at = await pos(p);
    const want = Math.atan2(-(tx - at.x), -(tz - at.z));
    let diff = want - o.yaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    if (Math.abs(diff) < 0.12) return;
    const key = diff > 0 ? "KeyZ" : "KeyC";
    await p.page.keyboard.down(key);
    await sleep(Math.min(900, 120 + Math.abs(diff) * 380));
    await p.page.keyboard.up(key);
    await sleep(150);
  }
}

/** Button-size / spacing / on-screen rules (the controls plan's: 48×48, 8 px, inside the viewport) over every visible button. */
export function visibleButtons(p, scopeSel) {
  return p.page.evaluate((scope) => {
    const root = scope ? document.querySelector(scope) : document;
    if (!root) return [];
    const out = [];
    for (const el of root.querySelectorAll("button, [role=button], .cv-wheel-btn")) {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden" || cs.pointerEvents === "none") continue;
      let op = 1;
      for (let n = el; n && n !== document.documentElement; n = n.parentElement) op *= parseFloat(getComputedStyle(n).opacity);
      if (op < 0.05) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      // Not reachable by a finger when something else (a veil, a sheet) is on top of the button's centre.
      const top = document.elementFromPoint(Math.min(innerWidth - 1, Math.max(0, r.x + r.width / 2)), Math.min(innerHeight - 1, Math.max(0, r.y + r.height / 2)));
      if (!top || !(el.contains(top) || top.contains(el))) continue;
      const br = cs.borderTopLeftRadius;
      const round = br.endsWith("%") ? parseFloat(br) >= 50 : parseFloat(br) >= Math.min(r.width, r.height) / 2 - 0.5;
      out.push({ name: (el.getAttribute("aria-label") || el.textContent.trim().slice(0, 14) || el.className).toString().slice(0, 40), cls: String(el.className).slice(0, 40), x: r.x, y: r.y, w: r.width, h: r.height, round });
    }
    return out;
  }, scopeSel ?? null);
}

// ───────────────────────────────────────── touch (CDP) and layout rules ─────────────────────────────────────────

/** The tab's CDP session (touch events with real timing; Playwright's touchscreen can only tap). */
export async function cdp(p) {
  if (!p.cdpSession) p.cdpSession = await p.ctx.newCDPSession(p.page);
  return p.cdpSession;
}
const touchPoint = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
export async function touchDown(p, x, y) {
  await (await cdp(p)).send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: touchPoint(x, y) });
}
export async function touchMoveTo(p, x, y) {
  await (await cdp(p)).send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: touchPoint(x, y) });
}
export async function touchUp(p) {
  await (await cdp(p)).send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}
/** Press a finger on (x, y), hold it `ms` (calling `during` once half-way), lift it. */
export async function touchHold(p, x, y, ms, during) {
  await touchDown(p, x, y);
  await sleep(ms / 2);
  if (during) await during();
  await sleep(ms / 2);
  await touchUp(p);
}
/** Centre of an element's box. */
export async function centreOf(p, selector) {
  const b = await p.page.locator(selector).first().boundingBox();
  return b ? { x: b.x + b.width / 2, y: b.y + b.height / 2, box: b } : null;
}

/** Distance between two boxes (0 = touching or overlapping); a round button counts as its circle. */
function gapOf(a, b) {
  const cx = (e) => e.x + e.w / 2;
  const cy = (e) => e.y + e.h / 2;
  if (a.round && b.round) return Math.max(0, Math.hypot(cx(a) - cx(b), cy(a) - cy(b)) - (a.w + b.w) / 2);
  if (a.round || b.round) {
    const [c, box] = a.round ? [a, b] : [b, a];
    const px = Math.min(box.x + box.w, Math.max(box.x, cx(c)));
    const py = Math.min(box.y + box.h, Math.max(box.y, cy(c)));
    return Math.max(0, Math.hypot(cx(c) - px, cy(c) - py) - c.w / 2);
  }
  const dx = Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w));
  const dy = Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h));
  return Math.hypot(dx, dy);
}

/** The controls plan's touch rules over a list of `visibleButtons`: ≥ 48×48, gaps ≥ 8 px, inside the viewport. */
export function layoutReport(els, viewport) {
  const small = els.filter((e) => e.w < 48 - 1e-3 || e.h < 48 - 1e-3).map((e) => `${e.name} ${r2(e.w)}×${r2(e.h)}`);
  const outside = els.filter((e) => e.x < -0.01 || e.y < -0.01 || e.x + e.w > viewport.width + 0.01 || e.y + e.h > viewport.height + 0.01).map((e) => e.name);
  const tight = [];
  for (let i = 0; i < els.length; i++)
    for (let j = i + 1; j < els.length; j++) {
      const g = gapOf(els[i], els[j]);
      if (g < 8 - 0.01) tight.push(`${els[i].name} | ${els[j].name} gap ${r2(g)}`);
    }
  return { count: els.length, small, outside, tight, ok: small.length === 0 && outside.length === 0 && tight.length === 0 };
}
