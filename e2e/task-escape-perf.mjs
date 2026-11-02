// AI 학교 탈출 1단계 Task 25 — performance probe: a phone-sized tab (375×812, touch), "low" graphics, CDP CPU throttling 4×,
// measured for 20 s: rAF intervals (`__cv.getFrameStats`: mean, p95, max) and the name tag cost (`__cv.getNametagCostMs`).
//
//   node e2e/task-escape-perf.mjs --mode counsel          # the student alone inside the counselling room
//   node e2e/task-escape-perf.mjs --mode hub              # the student in the central hall (own class, no bots)
//   node e2e/task-escape-perf.mjs --mode hub --code ABC123   # the student joins an EXISTING class (the load-test bots' class, Task 26 Step 2)
//
//   TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json ADMIN_CODE=e2e-operator CV_ESCAPE_INTRO_MS=1500 npm run dev
//
// counsel: a second student G walks in with the measured student S (a team needs two to enter), then G's tab closes, so S stands
// alone in the room, as the plan says. hub: without --code the script opens its own class and S stands in the empty hall (a
// REFERENCE number); with --code S joins that class and the number is the hall with whatever bots stand there (`remotes` is reported).
// Pass: mean frame interval ≤ 33 ms and name tag cost mean < 1.0 ms. Headless numbers are a reference only: the 30 fps verdict is
// the owner's real phone (Task 27). The other tabs are shrunk to 160×160 while S is measured, so they do not take the GPU.
//
// Knobs: --ms / CV_PERF_MS (window, default 20000), --throttle / CV_PERF_THROTTLE (CPU slowdown, default 4; 1 = none),
// --graphics (low | high, default low); --code is for hub mode only, CV_CLIENT_URL, CV_CHROME_PATH, CV_E2E_RENDER=software.
// Evidence → .superpowers/sdd/evidence/task-escape/perf/ (perf-<mode>.json, perf-<mode>.png). Exit code 0 = gates passed, no console/page error.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  EVIDENCE, PAD_A, PAD_B, PHONE, cdp, createRun, esc, inPlay, joinAsStudent, joinAsTeacher, joinTeam, launchBrowser, makeTeam, openPlayer, r2,
  sleep, teacherStart, walkAndWait, screenOf,
} from "./lib/escape.mjs";

const { values: args } = parseArgs({
  options: { mode: { type: "string", default: "counsel" }, code: { type: "string" }, ms: { type: "string" }, throttle: { type: "string" }, graphics: { type: "string", default: "low" } },
});
if (args.mode !== "counsel" && args.mode !== "hub") {
  console.error("usage: node e2e/task-escape-perf.mjs --mode counsel|hub [--code <class code>] [--ms 20000] [--throttle 4] [--graphics low|high]");
  process.exit(2);
}
const MS = Number(args.ms ?? process.env.CV_PERF_MS ?? 20000);
const THROTTLE = Number(args.throttle ?? process.env.CV_PERF_THROTTLE ?? 4);
const GATE = { meanFrameMs: 33, nametagMs: 1.0 };

const run = createRun(`perf-${args.mode}`);
run.evidence = join(EVIDENCE, "perf");
mkdirSync(run.evidence, { recursive: true });
const { check } = run;

/** Measure S for MS under the CPU throttle while the camera turns (Z held), and return the numbers. */
async function measure(S, label) {
  const session = await cdp(S);
  await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  await S.page.keyboard.down("KeyZ"); // the camera turns, so every view direction is sampled
  await sleep(2500); // warm up under the throttle
  const costs = [];
  const t0 = Date.now();
  while (Date.now() - t0 < MS) {
    costs.push(await S.page.evaluate(() => window.__cv.getNametagCostMs()));
    await sleep(500);
  }
  const frames = await S.page.evaluate((w) => window.__cv.getFrameStats(w), MS);
  const render = await S.page.evaluate(() => window.__cvRenderInfo?.() ?? null);
  const remotes = await S.page.evaluate(() => window.__cv.getRemotes().length);
  await run.shot(S, `perf-${args.mode}.png`);
  await S.page.keyboard.up("KeyZ");
  await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
  const nametagMean = costs.reduce((a, b) => a + b, 0) / Math.max(1, costs.length);
  return {
    label,
    throttle: THROTTLE,
    windowMs: MS,
    frames: frames.frames,
    meanMs: r2(frames.meanMs),
    fps: r2(1000 / Math.max(frames.meanMs, 0.001)),
    p95Ms: r2(frames.p95Ms),
    maxMs: r2(frames.maxMs),
    nametagMeanMs: Math.round(nametagMean * 1000) / 1000,
    nametagMaxMs: Math.round(Math.max(0, ...costs) * 1000) / 1000,
    nametagSamples: costs.length,
    remotes,
    drawCalls: render?.calls ?? null,
    triangles: render?.triangles ?? null,
  };
}

const browser = await launchBrowser();
let numbers = null;
try {
  const settings = { graphics: args.graphics };
  const small = (p) => p.page.setViewportSize({ width: 160, height: 160 }).catch(() => {});

  await run.step(`set up (${args.mode})`, async () => {
    const S = await openPlayer(browser, run, { tag: "S", device: PHONE, settings });
    let T = null;
    let code = args.mode === "counsel" ? undefined : args.code; // counsel needs its own class (the teacher starts it)
    if (!code) {
      T = await openPlayer(browser, run, { tag: "T" });
      code = await joinAsTeacher(T);
    }
    check("a class code to join", /^[2-9A-HJ-NP-Z]{6}$/.test(code ?? ""), code);
    await joinAsStudent(S, `측정${String(Date.now() % 1000).padStart(3, "0")}`, code);
    const stored = await S.page.evaluate(() => JSON.parse(localStorage.getItem("cv-settings-v1") ?? "{}"));
    check(`the measured tab runs with graphics "${args.graphics}"`, stored.graphics === args.graphics, stored);

    if (args.mode === "counsel") {
      const G = await openPlayer(browser, run, { tag: "G" });
      await joinAsStudent(G, "동행", code);
      const name = await makeTeam(S, [-8.5, 5]);
      await joinTeam(G, name, [-8.5, 4]);
      await teacherStart(T);
      await walkAndWait(S, PAD_A[0], PAD_A[1], 40000, 1.0);
      await walkAndWait(G, PAD_B[0], PAD_B[1], 40000, 1.0);
      await S.page.waitForFunction(() => /입장/.test(document.querySelector(".cv-action-btn")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
      await S.page.locator(".cv-action-btn").tap();
      await Promise.all([inPlay(S), inPlay(G)]);
      await sleep(1500);
      await G.ctx.close(); // S stays alone in the room
      check("S is alone in the classroom (solo)", await S.page.waitForFunction(() => window.__cv?.getEscape?.()?.solo === true, null, { timeout: 10000 }).then(() => true, () => false));
      if (T) await small(T);
      await sleep(1500);
      check("the measured screen is the classroom", (await screenOf(S)) === "escape" && (await esc(S))?.phase === "play");
      numbers = await measure(S, "phone 375×812, counselling room, alone");
    } else {
      if (T) await small(T);
      await walkAndWait(S, 0, 2, 30000, 1.5);
      await sleep(1500);
      check("the measured screen is the hall", (await screenOf(S)) === "hub");
      numbers = await measure(S, args.code ? "phone 375×812, central hall of the given class" : "phone 375×812, central hall, own class (no bots)");
    }
  });

  await run.step("gates", async () => {
    console.log(JSON.stringify(numbers));
    check(`mean frame interval ≤ ${GATE.meanFrameMs} ms (headless reference; ${numbers.fps} fps, p95 ${numbers.p95Ms} ms, max ${numbers.maxMs} ms)`, numbers.meanMs <= GATE.meanFrameMs && numbers.frames > 20, { meanMs: numbers.meanMs, frames: numbers.frames });
    check(`name tag cost mean < ${GATE.nametagMs} ms (${numbers.nametagSamples} samples, max ${numbers.nametagMaxMs} ms)`, numbers.nametagMeanMs < GATE.nametagMs && numbers.nametagSamples >= 10, numbers.nametagMeanMs);
    if (args.mode === "hub") console.log(`   remotes in view: ${numbers.remotes}${numbers.remotes < 90 ? " (fewer than the 100 bots of the plan: a reference number)" : ""}`);
  });
} finally {
  writeFileSync(join(run.evidence, `perf-${args.mode}.json`), JSON.stringify({ mode: args.mode, gate: GATE, numbers }, null, 2));
  const exit = run.finish({ numbers, gate: GATE });
  await browser.close();
  process.exit(exit);
}
