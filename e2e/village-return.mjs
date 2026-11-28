/**
 * e2e/village-return.mjs — leaving a building on a slow phone: the village comes back fast, and no blank world is ever shown
 * (perf/100 + perf/return, 2026-11-28).
 *
 * History: on a 4x-throttled phone the village was dressed ~6 times a second after the memorial hall and never drawn (fixed in
 * fix/perf-100: game/keptMemo.ts, useTransitBoarded); then it came back only after 5-19 s, the light tier having let its files go
 * in the hall, and meanwhile the player stood on empty grey ground (owner: no friction for first-time players).
 *
 * Each exit (the memorial hall, house 1) is timed from the exit press: when the area is the village again, when the village model
 * is drawn (window.__cvVillage), and — sampled every 50 ms in the page — how long the village area showed with the village not
 * drawn and nothing covering it (no door curtain, house cover or "마을로 나가는 중…" screen): the BLANK time. A frame strip of each
 * exit (a screenshot every ~0.6 s for --strip s) goes to the evidence folder (or --out).
 *
 * Checks (phone 375x812, light tier, CPU 4x slower): drawn within --within s of the press; blank time <= 150 ms; the village
 * dressed at most once per way out (keptMemo: never per render).
 *
 *   CV_CLIENT_URL=http://localhost:5625 node e2e/village-return.mjs [--device phone|pc] [--throttle 4] [--within 30]
 *        [--exits hall,house] [--strip 12] [--out <dir>] [--label x]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, cdp, createRun, launchBrowser, openPlayer, press, sleep, walkAndWait } from "./lib/common.mjs";
import { DOOR_ROUTE, act, joinVillage } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: {
    device: { type: "string", default: "phone" },
    throttle: { type: "string" },
    within: { type: "string", default: "30" },
    exits: { type: "string", default: "hall,house" },
    strip: { type: "string", default: "18" },
    out: { type: "string" },
    label: { type: "string", default: "run" },
    /** a CPU profile of each way out (from the press until the village is drawn), saved beside the strip */
    profile: { type: "boolean", default: false },
  },
});
const PHONE_DEV = args.device === "phone";
const THROTTLE = Number(args.throttle ?? (PHONE_DEV ? 4 : 1));
const run = createRun(`village-return-${args.device}`);
if (args.out) run.evidence = args.out;
mkdirSync(run.evidence, { recursive: true });

/** In the page from the start: every 50 ms, whether the village area shows with the village undrawn and nothing over it. */
function watcher() {
  const W = (window.__ret = { on: false, t0: 0, samples: [] });
  const covered = () => {
    for (const sel of [".cv-door-fade", ".cv-house-cover", ".cv-aload", ".cv-veg-veil", ".cv-loader"]) {
      const e = document.querySelector(sel);
      if (!e) continue;
      if (parseFloat(getComputedStyle(e).opacity || "1") > 0.5) return true;
    }
    return false;
  };
  setInterval(async () => {
    if (!W.on) return;
    let area = null;
    try {
      area = (await window.__imp("/src/village/villageArea.ts")).localArea();
    } catch {}
    W.samples.push({ t: performance.now() - W.t0, area, drawn: !!window.__cvVillage, covered: covered() });
  }, 50);
}

const b = await launchBrowser();
const results = {};
try {
  const p = await openPlayer(b, run, { tag: "R", device: PHONE_DEV ? PHONE : DESKTOP, settings: PHONE_DEV ? { graphics: "low" } : {} });
  await p.ctx.addInitScript(watcher);
  const session = await cdp(p);
  if (THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const prepares = () => p.page.evaluate(() => window.__cvVillagePrepares?.() ?? null);
  const areaNow = () => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
  const waitArea = async (a, ms = 30000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if ((await areaNow()) === a) return;
      await sleep(150);
    }
    throw new Error(`never reached area ${a} (now ${await areaNow()})`);
  };
  const waitDrawn = () => p.page.waitForFunction(() => !!window.__cvVillage, null, { timeout: 180000 });
  await joinVillage(p, "Rt");
  await waitDrawn();
  await sleep(4000);
  run.check("village drawn on arrival", await p.page.evaluate(() => !!window.__cvVillage));

  /** Press the way out (the caller stands on the exit pad), time it, take the strip. */
  async function exitAndTime(name) {
    const before = await prepares();
    await p.page.evaluate(() => {
      window.__ret.samples = [];
      window.__ret.t0 = performance.now();
      window.__ret.on = true;
    });
    if (args.profile) {
      await session.send("Profiler.enable");
      await session.send("Profiler.setSamplingInterval", { interval: 1000 });
      await session.send("Profiler.start");
    }
    // the frame strip: the page's own compositor frames (a screencast: no screenshot stalls the throttled page), one kept every
    // 400 ms of wall time, from the press for --strip s
    const shots = [];
    let lastKept = -Infinity;
    let tPress = Infinity;
    const onFrame = (f) => {
      session.send("Page.screencastFrameAck", { sessionId: f.sessionId }).catch(() => {});
      const at = Date.now() - tPress;
      if (at < 0 || at - lastKept < 400 || at > Number(args.strip) * 1000) return;
      lastKept = at;
      const file = join(run.evidence, `${args.label}-${name}-${String(shots.length).padStart(2, "0")}.jpg`);
      writeFileSync(file, Buffer.from(f.data, "base64"));
      shots.push({ at, file });
    };
    session.on("Page.screencastFrame", onFrame);
    await session.send("Page.startScreencast", { format: "jpeg", quality: 60, everyNthFrame: 1 });
    tPress = Date.now();
    await act(p);
    await sleep(Number(args.strip) * 1000);
    await session.send("Page.stopScreencast").catch(() => {});
    session.off("Page.screencastFrame", onFrame);
    await waitArea("village", Number(args.within) * 1000);
    let drawn = await p.page.evaluate(() => !!window.__cvVillage);
    while (!drawn && Date.now() - tPress < Number(args.within) * 1000) {
      await sleep(250);
      drawn = await p.page.evaluate(() => !!window.__cvVillage);
    }
    if (args.profile) writeFileSync(join(run.evidence, `${args.label}-${name}.cpuprofile`), JSON.stringify((await session.send("Profiler.stop")).profile));
    await sleep(2500);
    const samples = await p.page.evaluate(() => {
      window.__ret.on = false;
      return window.__ret.samples;
    });
    const firstVillage = samples.find((s) => s.area === "village");
    const firstDrawn = samples.find((s) => s.area === "village" && s.drawn);
    const firstClear = samples.find((s) => s.area === "village" && s.drawn && !s.covered);
    // blank: the village area on screen, the village not drawn, nothing over it — time-weighted (a busy main thread samples late:
    // each sample's state holds until the next one)
    let blank = 0;
    for (let i = 0; i < samples.length; i++) {
      const s = samples[i];
      const next = samples[i + 1]?.t ?? s.t + 50;
      if (s.area === "village" && !s.drawn && !s.covered) blank += next - s.t;
    }
    blank = Math.round(blank);
    writeFileSync(join(run.evidence, `${args.label}-${name}-samples.json`), JSON.stringify(samples));
    const after = await prepares();
    // when the village model's file was in again (villagePreload.ts marks every load of village.glb), from the press
    const modelIn = await p.page.evaluate(() => {
      const t0 = window.__ret.t0;
      const m = performance.getEntriesByName("cv:village-model-in").filter((e) => e.startTime > t0 - 30000).pop();
      return m ? m.startTime - t0 : null;
    });
    const r = {
      modelInS: modelIn === null ? null : +(modelIn / 1000).toFixed(2),
      areaVillageS: firstVillage ? +(firstVillage.t / 1000).toFixed(2) : null,
      drawnS: firstDrawn ? +(firstDrawn.t / 1000).toFixed(2) : null,
      uncoveredS: firstClear ? +(firstClear.t / 1000).toFixed(2) : null,
      blankMs: blank,
      prepares: before !== null && after !== null ? after - before : null,
      shots: shots.length,
      shotsAt: shots.map((s) => +(s.at / 1000).toFixed(1)),
    };
    results[name] = r;
    console.log(`${name}: ${JSON.stringify(r)}`);
    run.check(`${name}: village drawn again within ${args.within} s of the press`, drawn && r.drawnS !== null && r.drawnS <= Number(args.within), `${r.drawnS} s`);
    run.check(`${name}: no blank world (village area, village not drawn, nothing over it) <= 150 ms`, blank <= 150, `${blank} ms`);
    run.check(`${name}: the village dressed at most once on the way out`, r.prepares !== null && r.prepares <= 1, `prepares +${r.prepares}`);
    await sleep(1500);
  }

  for (const name of args.exits.split(",")) {
    await run.step(`out of the ${name}`, async () => {
      if (name === "hall") {
        for (const [x, z] of DOOR_ROUTE) await walkAndWait(p, x, z, 40000, 1.2);
        await act(p);
        await waitArea("hall");
        await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
        await sleep(2000);
        // a visit: into the room and back to the door (the way out is offered at the arrival already: no sign of leaving)
        for (const [x, z] of [[300, -3.8], [303.3, -3.8], [303.3, 0.5], [300, 1.5]]) await walkAndWait(p, x, z, 20000, 0.5);
        await walkAndWait(p, 300, 4.6, 15000, 0.5); // the door pad, out of the desk guide's reach
        await sleep(1500); // standing at the door a moment, as a player reads the button
        await sleep(400);
        await exitAndTime("hall");
      } else if (name === "house") {
        for (const [x, z] of [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]]) await walkAndWait(p, x, z, 40000, 1.2);
        await act(p);
        await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
        for (const c of "1004") await press(p, p.page.locator(`.cv-keypad button[data-key="${c}"]`));
        await press(p, p.page.locator('.cv-keypad button[data-key="ok"]'));
        await waitArea("house:house_1:1");
        await sleep(2000);
        await walkAndWait(p, 365.3, -4.9, 20000, 0.8); // into the room
        await sleep(1000);
        const pad = await p.page.evaluate(async () => (await window.__imp("/village/houseAreas.ts")).HOUSE_PLACES[1].exitPad);
        await walkAndWait(p, pad.x, pad.z, 20000, 0.5);
        // the door checks the synced position
        await p.page.waitForFunction(
          async ({ x, z, radius }) => {
            const room = (await window.__imp("/src/net/connection.ts")).getRoom();
            const me = room?.state?.players?.get(room.sessionId);
            return !!me && Math.hypot(me.x - x, me.z - z) <= radius;
          },
          pad,
          { polling: 250, timeout: 10000 },
        );
        await sleep(1500);
        await exitAndTime("house");
      }
    });
  }
} catch (err) {
  run.check("step ran to the end", false, String(err?.stack ?? err).slice(0, 900));
}
console.log(JSON.stringify(results));
const code = run.finish({ results });
await b.close();
process.exit(code);
