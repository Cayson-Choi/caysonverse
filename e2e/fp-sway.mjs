/**
 * e2e/fp-sway.mjs — measures the first-person camera's per-step sway while walking (owner 2026-11-20: "1인칭 뷰로 걸어갈때 걸음에 따라서
 * 화면이 너무 흔들거린다"). Records the camera (position, yaw / pitch / roll, fov) and the body per rendered frame, and reports each
 * component's oscillation (peak-to-peak and dominant frequency after removing the walk's own trend).
 *
 *   CV_CLIENT_URL=http://localhost:5531 node e2e/fp-sway.mjs [--phone] [--tag=before|after] [--off]
 * `--off` = DEV `__cvFpBodyOff` (the eye at the pose's estimate, as before the true-first-person body).
 * Output: D:\ClaudeCode\tmpshots\fpsway\<tag>-<pc|phone>.json (CV_FPSWAY_OUT to change).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkTo, waitIdle } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const off = process.argv.includes("--off");
const tagArg = process.argv.find((a) => a.startsWith("--tag="));
const tag = tagArg ? tagArg.slice(6) : "run";
const OUT = process.env.CV_FPSWAY_OUT || "D:/ClaudeCode/tmpshots/fpsway";
mkdirSync(OUT, { recursive: true });
const run = createRun("fp-sway");

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
await joinVillage(A, "Sw");
const page = A.page;

await page.evaluate(() => {
  window.__swayStart = () => {
    const { camera, gl } = window.__cvThree();
    window.__sway = { rows: [], on: true };
    let last = -1;
    const tick = () => {
      if (!window.__sway.on) return;
      const f = gl.info.render.frame;
      if (f !== last) {
        last = f;
        const e = new camera.rotation.constructor().setFromQuaternion(camera.quaternion, "YXZ");
        const p = window.__cv.getPos();
        window.__sway.rows.push([performance.now(), camera.position.x, camera.position.y, camera.position.z, e.y, e.x, e.z, camera.fov, p.x, p.z]);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  window.__swayStop = () => ((window.__sway.on = false), window.__sway.rows);
});
if (off) await page.evaluate(() => (window.__cvFpBodyOff = true));
if (process.argv.includes("--steady-off")) await page.evaluate(async () => ((await window.__imp("/src/game/fpBody.ts")).fpBody.steadyOff = true));
// first person, looking along -z (yaw 0: forward = (-sin, -cos))
await page.evaluate(async () => {
  const vs = await window.__imp("/src/game/viewState.ts");
  vs.enterFp(0);
  vs.viewState.fpYaw = 0;
  vs.viewState.fpPitch = 0;
});
await sleep(1500);

const results = {};
async function scenario(name, how) {
  const at = await page.evaluate(() => window.__cv.getPos());
  await page.evaluate(() => window.__swayStart());
  await how();
  const rows = await page.evaluate(() => window.__swayStop());
  results[name] = { start: at, rows };
  console.log(name, "frames", rows.length, "secs", ((rows.at(-1)[0] - rows[0][0]) / 1000).toFixed(1));
}
const hold = async (keys, ms) => {
  for (const k of keys) await page.keyboard.down(k);
  await sleep(ms);
  for (const k of keys.slice().reverse()) await page.keyboard.up(k);
  await sleep(400);
};
// the plaza: walk toward -z then back to +z (flat), keys on a PC, a click-move on a phone
const click = async (x, z) => {
  await walkTo(A, x, z);
  await sleep(500);
  await waitIdle(A, 20000);
};
await hold(["KeyW"], 2500); await hold(["KeyS"], 2500); // warm-up: shaders, first frames
await scenario("idle", () => sleep(10000)); // standing still 10 s (owner 2026-11-21: no bobbing at rest)
if (!phone) {
  await scenario("walk", () => hold(["KeyW"], 5000));
  await scenario("run", () => hold(["ShiftLeft", "KeyS"], 4000));
} else {
  const p0 = await page.evaluate(() => window.__cv.getPos());
  await scenario("walk", () => click(p0.x, p0.z - 8));
  await scenario("run", () => click(p0.x, p0.z));
}
writeFileSync(join(OUT, `${tag}-${phone ? "phone" : "pc"}.json`), JSON.stringify(results));
await b.close();
