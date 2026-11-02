// Shared helpers of the AI 학교 탈출 E2E scripts (Task 25): e2e/task-escape-desktop.mjs, task-escape-mobile.mjs,
// task-escape-perf.mjs. Plain Playwright against the dev stack, in the style of the other e2e/task-*.mjs scripts:
//
//   TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json ADMIN_CODE=e2e-operator CV_ESCAPE_INTRO_MS=1500 npm run dev
//   node e2e/task-escape-desktop.mjs                 # CV_CLIENT_URL=http://localhost:5173 by default
//
// The teacher key below is a TEST value: the fixture file e2e/fixtures/teacher-keys.e2e.json holds only its sha256.
// No real teacher key and no ADMIN_CODE appear in any script.
//
// Console policy (exit code 1 on anything else): the only console lines allowed are the browser's own
// "Failed to load resource" line for the two expected refusals (521 wrong class code, 401 wrong teacher key) and the
// known react-three-fiber THREE.Clock deprecation warning. Any other console error/warning or page error fails the run.
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
export const EVIDENCE = join(REPO, ".superpowers", "sdd", "evidence", "task-escape");
mkdirSync(EVIDENCE, { recursive: true });

/** TEST teacher key; its sha256 is in e2e/fixtures/teacher-keys.e2e.json (never a real key). */
export const TEACHER_KEY = "TEST-KEY2-E2E4-ONLY";
export const WRONG_KEY = "ZZZZ-ZZZZ-ZZZZ-ZZZZ";

export const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
export const DESKTOP = { viewport: { width: 1280, height: 800 } };
export const PHONE = { viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2, userAgent: IPHONE_UA };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const r2 = (n) => Math.round(n * 100) / 100;

// ───────────────────────────────── the counselling room's answers ─────────────────────────────────
// Read from the server's room file (the E2E must type the real answers); the client never imports it.
const counselSrc = readFileSync(join(REPO, "server/src/escape/rooms/counsel.ts"), "utf8");
export const CABINET = counselSrc.match(/id: "cabinet_lock"[\s\S]*?answer: "(\d{4})"/)?.[1];
/** card id → "ok" | "stop" */
export const SORT_ANSWER = Object.fromEntries([...counselSrc.matchAll(/^\s+(\w+): "(ok|stop)",\s*$/gm)].map((m) => [m[1], m[2]]));
/** Wheel indexes of the cover lock's word (동 의 먼 저). */
export const COVER_INDEXES = [1, 3, 5, 6];
export const COVER_WORD = "동의먼저";
if (!CABINET || Object.keys(SORT_ANSWER).length !== 8) throw new Error("could not read the counselling room's answers from server/src/escape/rooms/counsel.ts");

// ───────────────────────────────────── a run: checks, errors, evidence ─────────────────────────────────────

/** Console lines that are expected (the browser's resource line for 521 / 401, the known Clock warning). */
const ALLOWED_CONSOLE = [
  { name: "521 wrong class code", re: /^Failed to load resource: the server responded with a status of 521\b/ },
  { name: "401 wrong teacher key", re: /^Failed to load resource: the server responded with a status of 401\b/ },
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
     * server refuses a join (the same-nickname refusal of desktop step 3). Returns the function that ends the allowance.
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
  // The school's model files this tab fetched (name → bytes), in order: the first-load report reads them.
  const assets = [];
  page.on("response", async (r) => {
    const url = r.url();
    if (!/\/(models\/school|draco)\//.test(url)) return;
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

/** Open the entry screen and wait until the nickname box and the builder are ready. */
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

/** Type the nickname and open the destination sheet (입장하기). */
export async function openSheet(p, nick) {
  await p.page.locator("input.cv-input").first().fill(nick);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.locator("dialog.cv-dest[open]").waitFor();
  await sleep(900); // presses right after the sheet opens are ignored on purpose
}

/** Submit a class code on the open sheet (does not wait for the hall). */
export async function submitCode(p, code) {
  await p.page.locator(".cv-dest-code-input").fill(code);
  await sleep(300);
  await press(p, p.page.locator(".cv-dest-go"));
}

export const dest = (p) => p.page.evaluate(() => document.querySelector(".cv-dest-error")?.textContent ?? "");

/** Wait until the hall is on screen and its model is loaded. */
export async function inHub(p) {
  const { page } = p;
  await page.waitForFunction(() => window.__cv?.getScreen?.() === "hub", null, { timeout: 40000 });
  await page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 20000 });
  await page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  await sleep(1800);
}

/** Entry → nickname → class code → hall. */
export async function joinAsStudent(p, nick, code) {
  await toEntry(p);
  await openSheet(p, nick);
  await submitCode(p, code);
  await inHub(p);
}

/** Entry → nickname → teacher role → key → class opened → hall; returns the 6-symbol class code. */
export async function joinAsTeacher(p, nick = "김쌤", key = TEACHER_KEY) {
  await toEntry(p);
  await openSheet(p, nick);
  await p.page.locator(".cv-dest-role").click();
  await p.page.locator(".cv-dest-key-input").fill(key);
  await p.page.locator(".cv-dest-go").click();
  await inHub(p);
  return classCodeOf(p);
}

export async function classCodeOf(p) {
  const title = (await p.page.locator(".cv-hub-title").first().textContent()) ?? "";
  return (title.match(/반 ([2-9A-HJ-NP-Z]{6})/) ?? [])[1];
}

// ───────────────────────────────────────── page-state helpers ─────────────────────────────────────────

export const text = async (loc) => ((await loc.count()) ? ((await loc.first().textContent()) ?? "").trim() : "");
export const pos = (p) => p.page.evaluate(() => window.__cv.getPos());
export const esc = (p) => p.page.evaluate(() => window.__cv?.getEscape?.());
export const cls = (p) => p.page.evaluate(() => window.__cv?.getClass?.());
export const inspect = (p) => p.page.evaluate(() => window.__cv?.getInspect?.());
export const screenOf = (p) => p.page.evaluate(() => window.__cv?.getScreen?.());
export const raw = (p, type, payload) =>
  p.page.evaluate(async ([t, pl]) => (await window.__imp("/src/net/connection.ts")).sendEscape(t, pl), [type, payload]);
export const waitFlag = (p, flag, ms = 8000) =>
  p.page.waitForFunction((f) => window.__cv?.getEscape?.()?.flags.includes(f), flag, { timeout: ms }).then(() => true, () => false);
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
/** What E / the action button picks among the targets: the highest priority, then the nearest. */
const pickOf = (ts) => [...ts].sort((a, b) => b.pri - a.pri || a.dist - b.dist)[0];

/**
 * Standing spots (the room's floor, a 0.2 m grid) where target `id` would be the one E picks, nearest to the thing first and
 * at least 0.5 m apart. The client's own target function answers for a pretend pose, so the list follows the current state.
 */
export function spotsFor(p, id) {
  return p.page.evaluate(
    async ([id]) => {
      const m = await window.__imp("/src/game/interactTargets.ts");
      const out = [];
      for (let x = -6; x <= 6; x += 0.2) {
        for (let z = -4.6; z <= 4.6; z += 0.2) {
          const ts = m.getTargets({ x, z, yaw: 0, seatIndex: -1 }).map((t) => ({ id: t.id, dist: t.dist, pri: t.priority ?? 0 }));
          const pick = [...ts].sort((a, b) => b.pri - a.pri || a.dist - b.dist)[0];
          const me = ts.find((t) => t.id === id);
          if (pick?.id === id && me && me.dist >= 0.45) out.push([x, z, me.dist]);
        }
      }
      out.sort((a, b) => a[2] - b[2]);
      const spread = [];
      for (const c of out) if (spread.every((s) => Math.hypot(s[0] - c[0], s[1] - c[1]) >= 0.5)) spread.push(c);
      return spread.slice(0, 8).map((c) => [Math.round(c[0] * 100) / 100, Math.round(c[1] * 100) / 100]);
    },
    [id],
  );
}

/** Walk through candidate spots until target `id` is the one E / the button picks (priority, then nearest). */
export async function standNear(p, id, spots = []) {
  const tried = new Set();
  for (const list of [spots, null]) {
    for (const [x, z] of list ?? (await spotsFor(p, id))) {
      const key = x + "," + z;
      if (tried.has(key)) continue;
      tried.add(key);
      await walkAndWait(p, x, z, 25000, 0.35);
      if (pickOf(await targets(p))?.id === id) return true;
    }
  }
  return false;
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

// ───────────────────────────────────────── team / class helpers ─────────────────────────────────────────

/**
 * Walk onto the team rug and wait for the context button (the hall's context pass runs ~5 Hz); walks again once if it is not there.
 * Returns the position.
 */
export async function ensureOnRug(p, spot = [-8.5, 5]) {
  // The south edge of the rug first: the team sign's stand (-4.35, 5) can catch a straight click-move from a spawn that landed
  // a little further north (a player then stops at x about -3.6 and never reaches the rug).
  const start = await pos(p);
  await walkAndWait(p, -6.8, 7.8, 15000, 1.2);
  for (let attempt = 0; attempt < 3; attempt++) {
    const before = await pos(p);
    await walkAndWait(p, spot[0], spot[1], 15000, 0.8);
    await sleep(1200);
    if (await p.page.locator(".cv-action-btn").count()) break;
    const after = await pos(p);
    if (Math.hypot(after.x - before.x, after.z - before.z) < 0.5) {
      // Not moving at all (another avatar standing on the spawn point holds this one): shove it sideways with the keyboard.
      console.log(`   [retry] ${p.tag}: stuck at (${r2(after.x)}, ${r2(after.z)}) since (${r2(start.x)}, ${r2(start.z)}); nudging`);
      await p.page.screenshot({ path: join(EVIDENCE, `retry-stuck-${p.tag}.png`) }).catch(() => {});
      const key = attempt % 2 === 0 ? "KeyS" : "KeyA";
      await p.page.keyboard.down(key);
      await sleep(900);
      await p.page.keyboard.up(key);
    }
    spot = [spot[0] - 0.4 * (attempt + 1), spot[1] + 0.3];
  }
  return pos(p);
}
/** On the rug: open the team panel (E on a desktop tab, the action button on a touch tab). */
export async function openTeamPanel(p) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    if (p.touch) await p.page.locator(".cv-action-btn").tap();
    else await p.page.keyboard.press("KeyE");
    if (await p.page.locator(".cv-hub-sheet").waitFor({ state: "visible", timeout: 3000 }).then(() => true, () => false)) {
      await sleep(400);
      return;
    }
    const where = await pos(p);
    console.log(`   [retry] ${p.tag}: the team panel did not open (attempt ${attempt}); at (${r2(where.x)}, ${r2(where.z)}), button "${await text(p.page.locator(".cv-action-btn"))}"`);
    await sleep(800);
  }
  await p.page.locator(".cv-hub-sheet").waitFor({ state: "visible", timeout: 3000 });
}
export async function closeTeamPanel(p) {
  if (p.touch) await p.page.locator(".cv-hub-x").tap();
  else await p.page.getByRole("button", { name: "닫기", exact: true }).last().click();
  await sleep(300);
}
/** The leader makes a new team ("새 팀 만들기" with the panel's default name and colour). */
export async function makeTeam(p, rugSpot = [-8.5, 5]) {
  await ensureOnRug(p, rugSpot);
  await openTeamPanel(p);
  await press(p, p.page.locator(".cv-hub-make .cv-hub-btn"));
  await p.page.locator(".cv-hub-mine").waitFor({ state: "visible", timeout: 5000 });
  const name = await text(p.page.locator(".cv-hub-mine .cv-hub-team-name"));
  await closeTeamPanel(p);
  return name;
}
/** A teammate joins the team listed first in the panel (or the one named `teamName`). */
export async function joinTeam(p, teamName, rugSpot = [-8.5, 4]) {
  await ensureOnRug(p, rugSpot);
  await openTeamPanel(p);
  const row = teamName ? p.page.locator(".cv-hub-team", { hasText: teamName }) : p.page.locator(".cv-hub-teams .cv-hub-team").first();
  await press(p, row.getByRole("button", { name: "들어가기" }));
  await p.page.locator(".cv-hub-mine").waitFor({ state: "visible", timeout: 5000 });
  await closeTeamPanel(p);
}
export const teacherStart = (t) => t.page.getByRole("button", { name: "시작", exact: true }).click();

/** The counselling pad: walk both to the waiting spot (first, then second) and wait for the leader's button. */
export const PAD_A = [22, -1.7];
export const PAD_B = [22.4, -1.7];

/** Wait until the player stands in the classroom's play phase (intro done). */
export async function inPlay(p, ms = 40000) {
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "escape", null, { timeout: 30000 });
  await p.page.waitForFunction(() => window.__cv?.getEscape?.()?.phase === "play", null, { timeout: ms });
  await p.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
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
