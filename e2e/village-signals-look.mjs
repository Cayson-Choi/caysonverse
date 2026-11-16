/**
 * e2e/village-signals-look.mjs — the crosswalk signals in the running game (A4): samples the lamp materials of the real scene
 * every 100 ms over a full cycle (no instant with the vehicle head green/amber AND the pedestrian figure walking; all-red
 * clearance present; blinking while flashing) and takes screenshots of each phase at both crossings.
 *
 *   (cd server && PORT=3101 npx tsx src/index.ts)
 *   (cd client && VITE_SERVER_URL=http://localhost:3101 npx vite --port 5701 --strictPort)
 *   CV_CLIENT_URL=http://localhost:5701 node e2e/village-signals-look.mjs --out=<folder> [--phone]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const run = createRun(phone ? "village-signals-look-phone" : "village-signals-look");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const browser = await launchBrowser();
const P = await openPlayer(browser, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
const SPOTS = [
  // ped: from the plaza side, facing the outer pole's pedestrian head; veh: down the road from the approach, facing its vehicle head
  { id: "bus-ped", stand: [28.5, -0.1], look: [37.5, 3.8] },
  { id: "bus-veh", stand: [36, 12], look: [37.5, 3.8] },
  { id: "north-ped", stand: [-1, -28.5], look: [2.9, -37.55] },
  { id: "north-veh", stand: [11, -36], look: [2.9, -37.55] },
];
const PHASES = [
  { name: "1-green-ped-red", at: 10 },
  { name: "2-amber", at: 27 },
  { name: "3-allred-clearance", at: 30 },
  { name: "4-walk", at: 36 },
  { name: "5-flashing", at: 44 },
  { name: "6-allred-before-green", at: 49 },
];
await run.step("join", async () => {
  await joinVillage(P, "신호");
  await P.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null, null, { timeout: 30000 });
});
const phase = () => P.page.evaluate(async () => ((await window.__imp("/src/net/transitSync.ts")).transitNowMs() % 50000) / 1000);
if (!process.argv.includes("--nosample")) await run.step("lamp materials over a full cycle (real scene, every ~100 ms)", async () => {
  const rows = await P.page.evaluate(async () => {
    const { scene } = window.__cvThree();
    const m = {};
    scene.traverse((o) => { const x = o.material; if (x && /^M_(lens_(red|amber|green)|ped_(stop|walk))$/.test(x.name)) m[x.name] = x; });
    const sync = await window.__imp("/src/net/transitSync.ts");
    const out = [];
    const t0 = performance.now();
    while (performance.now() - t0 < 101000) {
      const on = (n) => (m[n] && m[n].emissiveIntensity > 0.3 ? 1 : 0);
      out.push([+((sync.transitNowMs() % 50000) / 1000).toFixed(2), on("M_lens_red"), on("M_lens_amber"), on("M_lens_green"), on("M_ped_stop"), on("M_ped_walk")]);
      await new Promise((r) => setTimeout(r, 100));
    }
    return { found: Object.keys(m), out };
  });
  writeFileSync(join(OUT, "lamp-samples.json"), JSON.stringify(rows));
  run.check("all five lamp materials found", rows.found.length === 5, rows.found);
  let both = 0, noneVeh = 0, walkNotRed = 0, clearA = 0, clearB = 0, blinkOn = 0, blinkOff = 0, pedBoth = 0;
  for (const [t, r, a, g, ps, pw] of rows.out) {
    if ((g || a) && pw) both++;
    if (pw && !r) walkNotRed++;
    if (ps && pw) pedBoth++;
    if (!r && !a && !g) noneVeh++;
    if (t >= 29.3 && t < 30.7 && r && ps && !pw) clearA++;
    if (t >= 48.3 && t < 49.7 && r && ps && !pw) clearB++;
    if (t >= 43.2 && t < 47.8) (pw ? blinkOn++ : blinkOff++);
  }
  run.check("never a vehicle green/amber with the walking figure lit", both === 0, both);
  run.check("never the walking figure lit while the vehicle head is not red", walkNotRed === 0, walkNotRed);
  run.check("never both pedestrian figures lit", pedBoth === 0, pedBoth);
  run.check("vehicle head always lights exactly one lens", noneVeh === 0, noneVeh);
  run.check("all-red clearance after the amber seen (red car + red figure ~29-31)", clearA > 5, clearA);
  run.check("all-red clearance before the green seen (~48-50)", clearB > 5, clearB);
  run.check("the walking figure blinks while flashing (on and off both seen)", blinkOn > 5 && blinkOff > 5, { blinkOn, blinkOff });
});
for (const sp of SPOTS) {
  await run.step(`crossing ${sp.id}: screenshots of each phase`, async () => {
    const at = await walkAndWait(P, sp.stand[0], sp.stand[1], 120000, 1.5);
    run.check("avatar near the crossing", Math.hypot(at.x - sp.look[0], at.z - sp.look[1]) < 16, at);
    await turnCameraTo(P, sp.look[0], sp.look[1]);
    for (const ph of PHASES) {
      for (let i = 0; i < 700; i++) {
        const t = await phase();
        if (t >= ph.at && t < ph.at + 1.2) break;
        await sleep(100);
      }
      const t = await phase();
      await P.page.screenshot({ path: join(OUT, `${phone ? "phone" : "pc"}-${sp.id}-${ph.name}.png`) });
      console.log(`shot ${sp.id} ${ph.name} at phase ${t.toFixed(1)} s`);
    }
  });
}
await browser.close();
const bad = run.results.filter((r) => !r.ok).length;
console.log(`\n${run.results.length - bad}/${run.results.length} PASS`, run.errors.length ? run.errors : "");
process.exit(bad ? 1 : 0);
