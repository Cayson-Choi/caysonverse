/**
 * e2e/sfx-live.mjs -- the plaza fountain's water in the real game (PC): it runs when you stand at the basin, fades with the
 * distance, stops with the menu's 소리 switch, and is gone when you are 33 m away or inside the memorial hall.
 *   CV_CLIENT_URL=http://localhost:5971 node e2e/sfx-live.mjs
 * (Reads the DEV probe window.__cvSfx that land/AreaSfx.tsx publishes: the fountain's target gain and whether its nodes exist.)
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { enterHall, joinVillage, leaveHall } from "./lib/village.mjs";

const run = createRun("sfx-live");
mkdirSync(run.evidence, { recursive: true });
const browser = await launchBrowser();
const probe = (p) => p.page.evaluate(() => ({ running: window.__cvSfx?.fountainRunning?.() ?? null, target: window.__cvSfx?.fountainTarget?.() ?? null }));
const setMuted = (p, muted) => p.page.evaluate(async (m) => (await window.__imp("/src/stores/soundStore.ts")).useSoundStore.setState({ muted: m }), muted);
const until = async (fn, ms = 8000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(200);
  }
  return false;
};
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "low" } });
  await run.step("1. at the basin the water runs", async () => {
    await joinVillage(A, "분수");
    await A.page.mouse.click(640, 400); // a gesture: the audio context may run
    await walkAndWait(A, 0, 7.5, 30000, 1.5);
    const near = await until(async () => (await probe(A)).running === true && (await probe(A)).target > 0.2, 12000);
    run.check("the fountain's nodes exist and its level is up near the basin", near, await probe(A));
  });
  await run.step("2. the level falls with the distance", async () => {
    const a = (await probe(A)).target;
    await walkAndWait(A, 0, 18, 30000, 1.5);
    await sleep(500);
    const b = (await probe(A)).target;
    run.check("quieter at ~18 m than at the basin, still audible", b < a && b > 0, { at: await pos(A), basin: a, far: b });
  });
  await run.step("3. the menu's 소리 switch silences it, and it comes back", async () => {
    await setMuted(A, true);
    await sleep(600);
    run.check("target 0 with 소리 off", (await probe(A)).target === 0, await probe(A));
    await setMuted(A, false);
    await sleep(600);
    run.check("back with 소리 on", (await probe(A)).target > 0, await probe(A));
  });
  await run.step("4. far away (33 m): the nodes are freed after a few seconds", async () => {
    // round the basin's collider, along the door route (village.mjs DOOR_ROUTE): (-20, 5) -> (-14, -20) -> (0, -33)
    for (const [x, z] of [[-20, 5], [-14, -20], [0, -33]]) await walkAndWait(A, x, z, 40000, 2);
    const gone = await until(async () => (await probe(A)).running === false, 12000);
    run.check("silent and freed 33 m off", gone && (await probe(A)).target === 0, { ...(await probe(A)), at: await pos(A) });
  });
  await run.step("5. inside the memorial hall there is no fountain", async () => {
    await enterHall(A);
    await sleep(1500);
    const p = await probe(A);
    run.check("no fountain in the hall", p.running === false || p.running === null, p);
    await leaveHall(A);
  });
} finally {
  await browser.close();
}
process.exit(run.finish());
