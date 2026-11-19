/**
 * e2e/inp-probe.mjs — INP probe (owner 2026-11-19: Vercel Toolbar "canvas — Event handlers on this element blocked UI updates for 207.7ms",
 * "span.cv-lake-text … 216ms"). Event Timing (PerformanceObserver 'event', durationThreshold 16) over the common interactions of the village:
 * canvas taps to walk (near, across the plaza, far), a tap on a bench, a camera drag, the emoji / map / menu buttons, the chat field, and the
 * lake HUD (rent the rod, walk to a chair, sit, then every big button the HUD offers: cast, strike, reel/hold, release).
 *
 * For each interaction it reports the handler's PROCESSING time (sum over the interaction's events of processingEnd - processingStart: what
 * "blocked UI updates" is) and the whole event duration (to the next paint, 8 ms steps). The run FAILS when an interaction's processing time
 * is over --max-proc (default 100 ms) or its duration is over --max-dur (default 100 ms x the throttle's slack: 100 at 1x).
 *
 *   server:  PORT=2994 npx tsx src/index.ts                                          (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2994 npx vite --port 5994 --strictPort  (in client/)
 *   CV_CLIENT_URL=http://localhost:5994 node e2e/inp-probe.mjs [--phone] [--throttle 4] [--max-proc 100] [--max-dur 100] [--only walk,hud,lake]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, cdp, createRun, launchBrowser, openPlayer, pos, press, sleep, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";

const { values: a } = parseArgs({
  options: {
    phone: { type: "boolean", default: false },
    throttle: { type: "string", default: "1" },
    "max-proc": { type: "string", default: "100" },
    "max-dur": { type: "string", default: "" },
    only: { type: "string", default: "walk,hud,lake" }, // also hudplaza | hudpark | hudlot (every cv-hud-btn)
    time: { type: "string", default: "" },
    cpu: { type: "boolean", default: false }, // lake: profile the whole step; hud*: profile each pressed button (--cpu-label narrows it)
    "cpu-label": { type: "string", default: "" },
    skyfirst: { type: "boolean", default: false }, // hud*: the first gesture of the page is a tap on empty sky
    keys: { type: "boolean", default: false }, // lake: press the keys (E / Space / WASD / arrows / Enter / Esc, an empty-space tap) instead of tapping the big buttons
    out: { type: "string", default: "" },
    label: { type: "string", default: "run" },
  },
});
const ONLY = a.only.split(",");
const MAX_PROC = Number(a["max-proc"]);
const MAX_DUR = a["max-dur"] ? Number(a["max-dur"]) : 100 * Math.max(1, Number(a.throttle)); // frame cost scales with the CPU
const run = createRun(`inp-probe-${a.phone ? "phone" : "pc"}-${a.label}`);
if (a.out) run.evidence = a.out;
mkdirSync(run.evidence, { recursive: true });
run.allow("the probe's own three import", /Multiple instances of Three\.js being imported/);

function instrument() {
  const M = (window.__inp = { events: [], labels: [] });
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) M.events.push({ name: e.name, start: e.startTime, dur: e.duration, ps: e.processingStart, pe: e.processingEnd, id: e.interactionId, tgt: (() => { try { const t = e.target; return t ? t.tagName + (typeof t.className === "string" && t.className ? "." + t.className.split(" ")[0] : "") : ""; } catch { return ""; } })() });
  }).observe({ type: "event", durationThreshold: 16, buffered: true });
  const loaf = (M.loaf = []);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        if (e.duration > 80) loaf.push({ at: e.startTime, dur: Math.round(e.duration), block: Math.round(e.blockingDuration), style: Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0), scripts: e.scripts.map((x) => ({ fn: x.sourceFunctionName || x.invoker, url: (x.sourceURL || "").split("/").pop().split("?")[0], pos: x.sourceCharPosition, dur: Math.round(x.duration), layout: Math.round(x.forcedStyleAndLayoutDuration || 0), type: x.invokerType })).sort((p, q) => q.dur - p.dur).slice(0, 4) });
    }).observe({ type: "long-animation-frame", buffered: true });
  } catch {}
  window.__inpMark = (label) => M.labels.push({ label, at: performance.now() });
  // every pointer / click listener's own time (> 8 ms), named by where it was registered: which handler is the slow one
  const slow = (M.slow = []);
  const orig = EventTarget.prototype.addEventListener;
  const wrapped = new WeakMap();
  EventTarget.prototype.addEventListener = function (type, fn, opts) {
    if ((type === "pointerup" || type === "pointerdown" || type === "click" || type === "keydown") && typeof fn === "function") {
      let w = wrapped.get(fn);
      if (!w) {
        const where = (new Error().stack || "").split(String.fromCharCode(10)).slice(2, 4).map((l) => l.trim().split("/").pop()).join(" < ");
        w = function (...args) {
          const t0 = performance.now();
          try {
            return fn.apply(this, args);
          } finally {
            const d = performance.now() - t0;
            if (d > 8) slow.push({ type, ms: Math.round(d), where, at: Math.round(t0) });
          }
        };
        wrapped.set(fn, w);
      }
      return orig.call(this, type, w, opts);
    }
    return orig.call(this, type, fn, opts);
  };
}

const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: a.phone ? "phone" : "pc", device: a.phone ? PHONE : DESKTOP });
await p.ctx.addInitScript(instrument);
const session = await cdp(p);
if (Number(a.throttle) > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: Number(a.throttle) });

const mark = (label) => p.page.evaluate((l) => window.__inpMark(l), label);
const vp = p.page.viewportSize();
/** A pointer tap at a screen point on the canvas: down, ~90 ms, up (a hand's tap). */
async function tapAt(x, y) {
  if (p.touch) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await sleep(90);
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.page.mouse.move(x, y);
    await p.page.mouse.down();
    await sleep(90);
    await p.page.mouse.up();
  }
}
/** The screen point of a world point (the game's camera), or null when it is behind the camera / off screen. */
const project = (x, y, z) =>
  p.page.evaluate(async ([x, y, z]) => {
    const T = await window.__imp("/node_modules/.vite/deps/three.js");
    const { camera } = window.__cvThree();
    camera.updateMatrixWorld();
    const v = new T.Vector3(x, y, z).project(camera);
    if (v.z > 1 || Math.abs(v.x) > 0.95 || Math.abs(v.y) > 0.95) return null;
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }, [x, y, z]);
const groundAhead = async (dist, side = 0) => {
  const at = await pos(p);
  const o = await p.page.evaluate(() => window.__cv.getOrbit());
  // the camera looks along -(sin yaw, cos yaw) from behind the avatar
  const fx = -Math.sin(o.yaw);
  const fz = -Math.cos(o.yaw);
  return project(at.x + fx * dist - fz * side, 0.05, at.z + fz * dist + fx * side);
};
async function walkTapSteps() {
  for (const [label, dist, side] of [["tap near", 4, 0], ["tap mid", 9, 3], ["tap far", 18, -5], ["tap near 2", 5, 2]]) {
    const pt = await groundAhead(dist, side);
    if (!pt) continue;
    await mark(label);
    await tapAt(pt.x, pt.y);
    await sleep(1500);
  }
}
async function dragCamera() {
  await mark("camera drag");
  const x0 = vp.width / 2;
  const y0 = vp.height * 0.45;
  if (p.touch) {
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: x0, y: y0 }] });
    for (let s = 1; s <= 20; s++) await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: x0 + s * 6, y: y0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    await p.page.mouse.move(x0, y0);
    await p.page.mouse.down();
    for (let s = 1; s <= 20; s++) await p.page.mouse.move(x0 + s * 6, y0);
    await p.page.mouse.up();
  }
  await sleep(1200);
}
async function hudButtons() {
  for (const [label, sel] of [
    ["emoji button", '.cv-emoji-btn'],
    ["map open", '[aria-label^="지도"]'],
    ["map close", '[aria-label^="지도"]'],
    ["menu open", '[aria-label^="메뉴"]'],
    ["menu close", '[aria-label^="메뉴"]'],
  ]) {
    const loc = p.page.locator(sel).first();
    if (!(await loc.count())) continue;
    await mark(label);
    await (p.touch ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 })).catch(() => {});
    await sleep(2200);
  }
  // the chat field: opened by Enter on a PC, by its button on a phone
  await mark("chat open");
  if (p.touch) await p.page.locator(".cv-chat-toggle").first().tap({ timeout: 5000 }).catch(() => {});
  else await p.page.keyboard.press("Enter");
  await sleep(1500);
  await mark("chat close");
  await p.page.keyboard.press("Escape");
  await sleep(1000);
}
async function benchTap() {
  const seat = await p.page.evaluate(async () => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const P = window.__cv.getPos();
    const near = am.VILLAGE_ACTIVE_MAP.seats.filter((s) => s.kind !== "fishing_chair").map((s) => ({ x: s.x, y: s.y ?? 0.5, z: s.z, d: Math.hypot(s.x - P.x, s.z - P.z) })).sort((u, v) => u.d - v.d)[0];
    return near;
  });
  if (!seat) return;
  await walkAndWait(p, seat.x + 3, seat.z + 3, 40000, 2);
  const pt = await project(seat.x, seat.y + 0.4, seat.z);
  if (!pt) return;
  await mark("tap a seat");
  await tapAt(pt.x, pt.y);
  await sleep(3500);
}
/** At the pier, before renting: the keys and an empty-space tap (the owner's "body" INP: a keydown / pointer on the page itself). */
async function pierKeys() {
  const k = async (label, fn) => {
    await mark(`key: ${label}`);
    await fn();
    await sleep(900);
  };
  const kb = p.page.keyboard;
  if (!p.touch) {
    for (const code of ["KeyW", "KeyA", "KeyS", "KeyD", "ArrowUp", "ArrowLeft"]) {
      await k(`${code} down`, () => kb.down(code));
      await sleep(500);
      await k(`${code} up`, () => kb.up(code));
    }
    await k("Space", () => kb.press("Space"));
    await k("E (nothing to do)", () => kb.press("KeyE"));
    await k("Enter (chat open)", () => kb.press("Enter"));
    await k("Escape (chat close)", () => kb.press("Escape"));
    await k("Escape (menu open)", () => kb.press("Escape"));
    await k("Escape (menu close)", () => kb.press("Escape"));
  }
  const pt = await groundAhead(30, 0).catch(() => null);
  await k("tap empty space (sky)", () => tapAt(vp.width / 2, vp.height * 0.12));
  if (pt) await k("tap water / far ground", () => tapAt(pt.x, pt.y));
}
async function lake() {
  for (const [x, z] of [[0, 14], [40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 60000, 2);
  await walkAndWait(p, 102, -14.6, 30000, 1);
  await sleep(800);
  const press1 = async (label) => {
    const btn = await waitButton(p, label, 15000);
    if (!btn) return null;
    await mark(`lake: ${label}${a.keys && !p.touch ? " (E key)" : ""}`);
    const cx = btn.x + btn.w / 2;
    const cy = btn.y + btn.h / 2;
    if (a.keys && !p.touch) await p.page.keyboard.press("KeyE");
    else await tapAt(cx, cy);
    return btn;
  };
  await press1("낚싯대 빌리기");
  await sleep(2000);
  await walkAndWait(p, 108, -12, 30000, 1.5);
  const goal = await p.page.evaluate(async (i) => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const tap = await window.__imp("/src/game/seatTap.ts");
    const chair = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS[i];
    const seats = am.VILLAGE_ACTIVE_MAP.seats;
    const idx = seats.findIndex((s) => s.lake === "fishing_chair" && s.spot === chair.spot);
    const g = tap.seatApproachGoal(seats, idx, am.VILLAGE_ACTIVE_MAP.geometry.obstacles, am.VILLAGE_ACTIVE_MAP.bounds);
    return { g, sx: chair.standX, sz: chair.standZ };
  }, 4);
  await walkAndWait(p, goal.sx, goal.sz, 30000, 1);
  await walkAndWait(p, goal.g.x, goal.g.z, 15000, 0.5);
  await sleep(800);
  await press1("앉아서 낚시");
  await sleep(2500);
  // every enabled big button the HUD offers, for ~70 s: cast, strike, reel (a hold), release ...
  const seen = new Set();
  const t0 = Date.now();
  while (Date.now() - t0 < 70000) {
    const btn = await bigButton(p);
    if (btn && !btn.disabled) {
      const key = `${btn.label}`;
      await mark(`lake: ${key}`);
      seen.add(key);
      const cx = btn.x + btn.w / 2;
      const cy = btn.y + btn.h / 2;
      const isHold = btn.tone && (await p.page.evaluate(() => document.querySelector("[data-lake-btn]")?.classList.contains("is-hold")));
      if (a.keys && !p.touch) {
        const code = seen.size % 2 ? "Space" : "KeyE"; // both are the fishing key
        if (isHold) {
          await p.page.keyboard.down(code);
          await sleep(1500);
          await p.page.keyboard.up(code);
        } else await p.page.keyboard.press(code);
      } else if (isHold) {
        // a hold: press, keep it ~1.5 s, let go
        if (p.touch) {
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cx, y: cy }] });
          await sleep(1500);
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        } else {
          await p.page.mouse.move(cx, cy);
          await p.page.mouse.down();
          await sleep(1500);
          await p.page.mouse.up();
        }
      } else await tapAt(cx, cy);
      await sleep(1200);
    } else await sleep(400);
  }
  console.log("lake buttons pressed:", [...seen].join(" | "));
  // sit down again / stand: the stand-up and return buttons
  for (const sel of ["button.cv-lake-stand:not([data-lake-return])", "[data-lake-return]"]) {
    const loc = p.page.locator(sel).first();
    if (await loc.count()) {
      await mark(`lake: ${sel.includes("return") ? "반납하기" : "일어나기"}`);
      await press(p, loc);
      await sleep(2000);
    }
  }
  if (a.keys) await pierKeys(); // back on the pier, rod returned: the keys that walk, chat, menu, and empty-space taps
}

await run.step("join", async () => {
  await joinVillage(p, "inp", a.time || undefined);
  await sleep(6000);
});
if (ONLY.includes("walk")) {
  await run.step("walk taps, a seat, the camera", async () => {
    await walkTapSteps();
    await benchTap();
    await dragCamera();
  });
}
if (ONLY.includes("hud")) await run.step("hud buttons", hudButtons);
if (ONLY.includes("lake")) {
  if (a.cpu) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 500 });
    await session.send("Profiler.start");
  }
  await run.step("lake hud", lake);
  if (a.cpu) {
    const { profile } = await session.send("Profiler.stop");
    writeFileSync(join(run.evidence, "lake.cpuprofile"), JSON.stringify(profile));
  }
}


// ───────────── every cv-hud-btn: open, then close (--only hudplaza | hudpark | hudlot; --time 2026-11-03T21:00 for the star finder at night) ─────────────
/** All visible, enabled HUD buttons right now (the emoji fan's six only exist while the fan is open and are skipped). */
const hudList = () =>
  p.page.evaluate(() =>
    [...document.querySelectorAll("button.cv-hud-btn")]
      .filter((b) => b.getBoundingClientRect().width > 0 && !b.disabled && !b.classList.contains("cv-emoji-fan-btn"))
      .map((b) => ({ label: b.getAttribute("aria-label") })),
  );
async function clickHud(label, tag) {
  const loc = p.page.locator(`button.cv-hud-btn[aria-label="${label}"]`).first();
  if (!(await loc.count())) return false;
  const prof = a.cpu && (a["cpu-label"] ? label.includes(a["cpu-label"]) : true);
  if (prof) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 200 });
    await session.send("Profiler.start");
  }
  await mark(`${tag}: ${label}`);
  await (p.touch ? loc.tap({ timeout: 5000 }) : loc.click({ timeout: 5000 })).catch(() => {});
  if (prof) {
    await sleep(600);
    const { profile } = await session.send("Profiler.stop");
    writeFileSync(join(run.evidence, `hud-${tag}-${label.replace(/[^w가-힣]/g, "_")}.cpuprofile`), JSON.stringify(profile));
  }
  await sleep(1800);
  return true;
}
/** A tap on empty space (the sky): the very first gesture of the page on a phone, then the second. */
async function skyTap(tag) {
  const prof = a.cpu && a["cpu-label"] === "sky";
  if (prof) {
    await session.send("Profiler.enable");
    await session.send("Profiler.setSamplingInterval", { interval: 200 });
    await session.send("Profiler.start");
  }
  await mark(`${tag}: tap empty sky`);
  await tapAt(vp.width / 2, vp.height * 0.1);
  await sleep(1800);
  if (prof) {
    const { profile } = await session.send("Profiler.stop");
    writeFileSync(join(run.evidence, `hud-${tag}-sky.cpuprofile`), JSON.stringify(profile));
  }
}
async function allHud(tag) {
  if (a.skyfirst) await skyTap(tag);
  const list = await hudList();
  console.log(`[${tag}] hud buttons:`, list.map((b) => b.label).join(" | "));
  for (const b of list) {
    const open = b.label;
    await clickHud(open, tag);
    const now = await hudList();
    const closer = now.find((x) => /닫기/.test(x.label ?? "") && (x.label ?? "").slice(0, 3) === open.slice(0, 3));
    if (closer) await clickHud(closer.label, `${tag} close`);
    else if (/지도|1인칭/.test(open)) await clickHud(open, `${tag} back`);
    else if (/메뉴/.test(open)) {
      await mark(`${tag}: menu Esc`);
      await p.page.keyboard.press("Escape");
      await sleep(1500);
    }
    await p.page.keyboard.press("Escape").catch(() => {});
    await sleep(600);
  }
}
async function walkTo(x, z) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(async ([x, z]) => {
      const plan = await window.__imp("/src/game/clickPlan.ts");
      const move = await window.__imp("/src/game/clickMove.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const P = window.__cv.getPos();
      const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
      move.setClickTarget(x, z, 0, via ?? undefined);
    }, [x, z]);
    await sleep(500);
    const t0 = Date.now();
    while (Date.now() - t0 < 90000 && (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) !== null) await sleep(300);
    await sleep(1200);
    if (await p.page.locator(".cv-action-btn").count()) return;
  }
}
async function pressAction() {
  if (p.touch) await p.page.locator(".cv-action-btn").tap({ timeout: 5000 });
  else await p.page.keyboard.press("KeyE");
}
async function parkTrip() {
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await walkTo(g.x, g.z - 0.5);
  await pressAction();
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "park", null, { timeout: 20000 });
  await p.page.waitForFunction(() => !document.querySelector("[data-testid=park-loading]"), null, { timeout: 120000 }).catch(() => {});
  await sleep(2500);
}
async function lotTrip(unit) {
  const info = await p.page.evaluate(async (u) => {
    const L = await window.__imp("/shared/src/village/villageLots.ts");
    const r = L.LOT_ROOMS.find((x) => x.unit.id === u);
    return { pad: L.lotDoorPoint(r.lot, r.door).pad };
  }, unit);
  await walkTo(info.pad.x, info.pad.z);
  await pressAction();
  await p.page.waitForFunction(() => !!window.__cvLotRoom, null, { timeout: 90000 });
  await sleep(4000);
}
if (ONLY.some((o) => o.startsWith("hud")))
  // the join warm-up (shader compiles, atlases, the lake file) is over before the presses are measured: no long frame for 5 s (max 4 min)
  await p.page.waitForFunction(() => { const l = window.__inp.loaf; const last = l[l.length - 1]; return performance.now() > 15000 && (!last || performance.now() - (last.at + last.dur) > 5000); }, null, { timeout: 240000, polling: 500 }).catch(() => console.log("warm-up did not go quiet in 4 min"));
if (ONLY.includes("hudplaza")) await run.step("hud: plaza", () => allHud(a.time ? "night" : "plaza"));
if (ONLY.includes("hudpark")) await run.step("hud: park", async () => { await parkTrip(); await allHud("park"); });
if (ONLY.includes("hudlot")) await run.step("hud: lot interior", async () => { await lotTrip("lot_chapel_nave"); await allHud("lot"); });

// ───────────── the report ─────────────
const data = await p.page.evaluate(() => window.__inp);
const rows = [];
data.labels.forEach((l, i) => {
  const until = i + 1 < data.labels.length ? data.labels[i + 1].at : Infinity;
  // a hud-button row counts the press itself (pointer / mouse / touch / click events until the next mark), not the Esc / key noise after it
  const hudRow = /^(plaza|park|lot|night)( back| close)?: /.test(l.label) && !/Esc$/.test(l.label);
  const evs = data.events.filter((e) => e.start >= l.at - 5 && e.start < until && e.id > 0 && (!hudRow || !/^key/.test(e.name)));
  const byId = new Map();
  for (const e of evs) {
    const o = byId.get(e.id) ?? { proc: 0, dur: 0, names: [] };
    o.proc += Math.max(0, e.pe - e.ps);
    o.dur = Math.max(o.dur, e.dur);
    o.names.push(`${e.name}:${Math.round(e.pe - e.ps)}/${e.dur}`);
    byId.set(e.id, o);
  }
  let worst = { proc: 0, dur: 0, names: [] };
  for (const o of byId.values()) if (o.proc > worst.proc || (o.proc === worst.proc && o.dur > worst.dur)) worst = o;
  rows.push({ label: l.label, n: byId.size, proc: Math.round(worst.proc * 10) / 10, dur: worst.dur, names: worst.names.join(" ") });
});
for (const f of (data.loaf ?? []).slice(0, 60)) console.log(`LoAF @${Math.round(f.at)} ${f.dur}ms blocking ${f.block}: ${f.scripts.map((x) => `${x.fn || "?"}@${x.url}:${x.pos} ${x.dur}ms${x.layout ? ` layout ${x.layout}` : ""}`).join(" | ")}`);
console.log("slow listeners:", JSON.stringify((data.slow ?? []).slice(0, 40)));
console.log(`\ninteraction                         n   proc ms   dur ms   (event: processing/duration)   [throttle ${a.throttle}x, ${a.phone ? "phone" : "pc"}]`);
for (const r of rows) console.log(`${r.label.padEnd(34)} ${String(r.n).padStart(2)} ${String(r.proc).padStart(9)} ${String(r.dur).padStart(8)}   ${r.names}`);
// the handler's processing time is the hard rule per interaction; the event duration (to the next paint: the page's frame time, which a
// busy machine stretches) is held to MAX_DUR at the median and to 3 x MAX_DUR for every single interaction
for (const r of rows) {
  run.check(`${r.label}: processing under ${MAX_PROC} ms`, r.proc < MAX_PROC, { proc: r.proc, dur: r.dur, names: r.names });
  run.check(`${r.label}: event duration under ${3 * MAX_DUR} ms`, r.n === 0 || r.dur < 3 * MAX_DUR, { proc: r.proc, dur: r.dur });
}
const durs = rows.filter((r) => r.n > 0).map((r) => r.dur).sort((x, y) => x - y);
run.check(`median event duration under ${MAX_DUR} ms`, durs.length === 0 || durs[Math.floor(durs.length / 2)] < MAX_DUR, { median: durs[Math.floor(durs.length / 2)], max: durs[durs.length - 1] });
writeFileSync(join(run.evidence, `inp-${a.phone ? "phone" : "pc"}-${a.label}-t${a.throttle}.json`), JSON.stringify({ throttle: a.throttle, rows, events: data.events, loaf: data.loaf, labels: data.labels }, null, 1));
const code = run.finish({ rows: rows.length });
await b.close();
process.exit(code);
