/**
 * e2e/park-loading.mjs — the "케이슨랜드로 가는 중…" screen (owner 2026-11-20: the park's loading looked frozen), PC or phone (--phone).
 * A fresh account walks to the park gate and presses 들어가기; this watches the full-screen loading screen from the press until it is gone:
 *   - it is up at once (before the park is in), shows the spinner, a title, a stage line and a bar, and it ends with the park drawn;
 *   - its spinner is a CSS animation on transform/opacity (compositor): a 2 s main-thread block while it is up must not stop it
 *     (CDP screencast frames keep changing during the block);
 *   - going back out ("나가기") shows "마을로 돌아가는 중…" until the village is back.
 *   CV_CLIENT_URL=http://localhost:5947 node e2e/park-loading.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "park-loading-phone" : "park-loading-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });
const NOON = "2026-11-03T12:30";

async function until(fn, ms, step = 100) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const areaOf = () => A.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const ctarget = () => A.page.evaluate(() => window.__cvClickTarget?.() ?? null);

const overlay = () =>
  A.page.evaluate(() => {
    const el = document.querySelector(".cv-aload");
    if (!el) return null;
    const fill = el.querySelector(".cv-aload-fill");
    return {
      id: el.getAttribute("data-testid"),
      stage: el.getAttribute("data-stage"),
      closing: el.getAttribute("data-closing"),
      title: el.querySelector(".cv-aload-title")?.textContent,
      sub: el.querySelector(".cv-aload-sub")?.textContent,
      fill: fill ? fill.style.transform : null,
      orbits: el.querySelectorAll(".cv-aload-orbit").length,
      anims: el.getAnimations({ subtree: true }).filter((a) => a.playState === "running").length,
    };
  });

/** Poll the overlay until it is gone; keep the distinct (stage, sub, title) rows and the time of each; shoot a few frames on the way. */
async function watchUntilGone(label, shotEvery = 700, cap = 120000) {
  const rows = [];
  let last = "";
  let shots = 0;
  let lastShot = 0;
  const t0 = Date.now();
  while (Date.now() - t0 < cap) {
    const o = await overlay();
    const t = Date.now() - t0;
    if (!o) {
      if (rows.length) break;
    } else {
      const key = `${o.id}|${o.stage}|${o.sub}|${o.closing}`;
      if (key !== last) {
        rows.push({ t, ...o });
        last = key;
      }
      if (t - lastShot >= shotEvery && shots < 14) {
        lastShot = t;
        await A.page.screenshot({ path: join(run.evidence, `${label}-${String(shots++).padStart(2, "0")}-${Math.round(t)}ms.png`) });
      }
    }
    await sleep(60);
  }
  return rows;
}

async function walkTo(x, z) {
  let ok = false;
  for (let attempt = 0; attempt < 4 && !ok; attempt++) {
    await A.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(500);
    await until(async () => (await ctarget()) === null, 90000, 150);
    await sleep(600);
    ok = await until(async () => (await A.page.locator(".cv-action-btn").count()) > 0, 4000, 150);
  }
  return ok;
}

await run.step("join", async () => {
  await A.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(NOON)}`, { waitUntil: "domcontentloaded" });
  await entryReady(A);
  await A.page.locator("input.cv-input").first().fill(`Pl${Math.floor(Math.random() * 9000 + 1000)}`);
  await press(A, A.page.locator(".cv-submit"));
  await A.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await A.page.waitForFunction(() => !!window.__cv?.getPos && !!window.__cvBgm, null, { timeout: 30000 * SLOW });
  await sleep(2500);
});

await run.step("to the gate", async () => {
  const g = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  run.check("the gate offers an action button", await walkTo(g.x, g.z - 0.5));
});

await run.step("press 들어가기: the loading screen", async () => {
  // screencast (compositor frames) + a 2 s main-thread block while the screen is up
  const cdp = await A.page.context().newCDPSession(A.page);
  const frames = [];
  cdp.on("Page.screencastFrame", (f) => {
    frames.push({ t: Date.now(), h: createHash("md5").update(f.data).digest("hex") });
    cdp.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 40, everyNthFrame: 1, maxWidth: 400, maxHeight: 400 });
  await A.page.evaluate(() => {
    window.__blockWin = null;
    const id = setInterval(() => {
      if (document.querySelector(".cv-aload") && (window.__seenAt ??= Date.now()) && Date.now() - window.__seenAt > 900) {
        clearInterval(id);
        const s = Date.now();
        while (Date.now() - s < 2000);
        window.__blockWin = { s, e: Date.now() };
      }
    }, 10);
  });
  const t0 = Date.now();
  await act(A);
  const rows = await watchUntilGone("enter");
  const stages = [...new Set(rows.map((r) => r.stage))];
  run.check("the loading screen was up from the press", rows.length > 0 && rows[0].stage === "door", { first: rows[0]?.stage });
  run.check("it names the park and has a stage line", rows.some((r) => r.title === "케이슨랜드로 가는 중…" && !!r.sub), rows.map((r) => `${r.t}:${r.stage}:${r.sub}`));
  run.check("the spinner turns (5 running CSS animations)", rows.some((r) => r.orbits === 5 && r.anims >= 5), rows[0]);
  run.check("it ends with the park in", (await areaOf()) === "park" && !(await overlay()), { stages, total: Date.now() - t0 });
  const win = await A.page.evaluate(() => window.__blockWin);
  await cdp.send("Page.stopScreencast");
  if (win) {
    const during = frames.filter((f) => f.t >= win.s + 150 && f.t <= win.e);
    const distinct = new Set(during.map((f) => f.h)).size;
    run.check("during a 2 s main-thread block the compositor still animates the spinner", distinct >= 3, { frames: during.length, distinct });
  } else run.check("the 2 s block ran while the screen was up", false);
  writeFileSync(join(run.evidence, "enter-rows.json"), JSON.stringify(rows, null, 1));
  await sleep(1500);
  await A.page.screenshot({ path: join(run.evidence, "park-arrived.png") });
});

await run.step("press 나가기: back to the village", async () => {
  const ex = await A.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).PARK_EXIT_PAD);
  run.check("the exit offers an action button", await walkTo(ex.x, ex.z));
  await act(A);
  const rows = await watchUntilGone("leave");
  run.check("the way back shows 마을로 돌아가는 중…", rows.some((r) => r.title === "마을로 돌아가는 중…"), rows.map((r) => `${r.t}:${r.stage}:${r.sub}`));
  run.check("and ends in the village", (await areaOf()) === "village");
  writeFileSync(join(run.evidence, "leave-rows.json"), JSON.stringify(rows, null, 1));
});

const code = run.finish({});
await b.close();
process.exit(code);
