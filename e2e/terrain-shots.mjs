/**
 * e2e/terrain-shots.mjs — photo-camera shots (window.__cvShot) of the village or 케이슨랜드 for terrain / map-edge checks.
 *   CV_CLIENT_URL=http://localhost:5477 node e2e/terrain-shots.mjs --spec=<json> [--out=<dir>] [--tag=after] [--area=village|park]
 *        [--time=12:30] [--device=desktop|phone] [--perf] [--query=flora=old] [--probe=<js file, run before the shots>] [--post=<js file, run after them>]
 * spec: [{ "name": "ov_150_45", "x":..,"y":..,"z":..,"tx":..,"ty":..,"tz":..,"fov":60 }, ...]; HUD hidden.
 * A shot may override time (HH:mm) and tag, or request perf for just that view.
 * With --perf, prints the median frame time, draw calls and triangles per shot.
 */
import { readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const args = process.argv.slice(2);
const opt = (n, d) => (args.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const AREA = opt("area", "village");
const TIME = opt("time", "12:30");
const DEVICE = opt("device", "desktop");
const TAG = opt("tag", "shot");
const spec = args.some((a) => a.startsWith("--spec=")) ? JSON.parse(readFileSync(opt("spec", "spec.json"), "utf8")) : [];
const run = createRun("terrain-shots");
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const until = async (fn, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
};
async function goTo(p, x, z, tol = 1.2) {
  for (let a = 0; a < 4; a++) {
    await p.page.evaluate(
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
    await sleep(400);
    await until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 90000);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: DEVICE, device: DEVICE === "phone" ? PHONE : DESKTOP, settings: { graphics: DEVICE === "phone" ? "low" : "high" } });
try {
  await P.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent(`2026-11-16T${TIME}`)}${opt("query", "") ? `&${opt("query", "")}` : ""}`, { waitUntil: "domcontentloaded" });
  console.log("progress: entry");
  await entryReady(P);
  await P.page.locator("input.cv-input").first().fill(`지형${Math.floor(Math.random() * 900 + 100)}`);
  await press(P, P.page.locator(".cv-submit"));
  await P.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 60000 });
  await P.page.waitForFunction(() => !!window.__cvVillage && !!window.__cvThree, null, { timeout: 120000 });
  await P.page.waitForFunction(() => !document.querySelector(".cv-loading"), null, { timeout: 60000 }).catch(() => {});
  console.log("progress: in village");
  await sleep(4000);
  if (AREA === "park") {
    const g = await P.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
    await goTo(P, g.x, g.z - 0.5, 1.0);
    await act(P);
    const entered = await until(async () => (await P.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea())) === "park", 20000);
    if (!entered) throw new Error("Photo camera could not enter the park");
    await P.page.locator('[data-testid="park-loading"]').waitFor({ state: "hidden", timeout: 120000 });
    await sleep(6000);
  }
  // Nearby shops and NPCs can mount new HUD elements after a walk.
  await P.page.addStyleTag({ content: "body * {visibility:hidden!important} body canvas {visibility:visible!important}" });
  if (args.some((a) => a.startsWith("--probe="))) {
    const out = await P.page.evaluate(`(async()=>{${readFileSync(opt("probe", ""), "utf8")}})()`);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
  }
  let currentTime = TIME;
  for (const s of spec) {
    const time = s.time ?? TIME;
    if (time !== currentTime) {
      await P.page.evaluate(async (time) => {
        const { villageClock, pinFromSearch } = await window.__imp("/src/village/villageClock.ts");
        const instant = pinFromSearch("?time=2026-11-16T" + time);
        if (instant === null) throw new Error("Invalid photo time " + time);
        villageClock.pin(instant);
        (await window.__imp("/src/village/dayNightDriver.ts")).dayNight.reset();
      }, time);
      currentTime = time;
    }
    // `go: [x, z]`: walk the player there first (the lake file is asked for when the PLAYER comes near it, not the camera)
    if (s.go) await goTo(P, s.go[0], s.go[1], 2.5);
    await P.page.evaluate((s) => {
      window.__cvShot = { x: s.x, y: s.y, z: s.z, tx: s.tx, ty: s.ty, tz: s.tz, fov: s.fov ?? 60 };
      const sc = window.__cvThree().scene;
      for (const n of window.__hidden ?? []) { const o = sc.getObjectByName(n); if (o) o.visible = true; }
      window.__hidden = s.hide ?? [];
      for (const n of window.__hidden) { const o = sc.getObjectByName(n); if (o) o.visible = false; }
    }, s);
    await sleep(s.wait ?? (s === spec[0] ? 9000 : 2500));
    // A missing image must fail the photo run so the gallery cannot silently lose a comparison.
    await P.page.screenshot({ path: join(run.evidence, `${s.tag ?? TAG}_${s.name}.png`) });
    console.log(`progress: shot ${s.name}`);
    if (s.perf || args.includes("--perf")) {
      const r = await P.page.evaluate(
        () =>
          new Promise((res) => {
            const r3 = window.__cvThree().gl;
            const ts = [];
            // a frame renders several passes (shadows, post chain): count them all, not just the last
            let last = performance.now();
            let n = 0;
            const previousAutoReset = r3.info.autoReset;
            r3.info.autoReset = false; // sum every pass of the frame (shadow cascades, scene, post), not only the last
            r3.info.reset();
            const f = (t) => {
              ts.push(t - last);
              last = t;
              if (++n < 90) requestAnimationFrame(f);
              else {
                ts.sort((a, b) => a - b);
                const sample = { medianMs: Math.round(ts[45] * 10) / 10, callsPerFrame: Math.round(r3.info.render.calls / 90), trisPerFrame: Math.round(r3.info.render.triangles / 90) };
                r3.info.autoReset = previousAutoReset;
                r3.info.reset();
                res(sample);
              }
            };
            requestAnimationFrame(f);
          }),
      );
      console.log(`perf ${s.name} ${JSON.stringify(r)}`);
    }
  }
  if (args.some((a) => a.startsWith("--post="))) {
    const out = await P.page.evaluate(`(async()=>{${readFileSync(opt("post", ""), "utf8")}})()`);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 1));
  }
  if (run.errors.length) console.log(`console/page errors: ${JSON.stringify(run.errors.slice(0, 8), null, 1)}`);
} finally {
  await browser.close();
}
process.exit(0);
