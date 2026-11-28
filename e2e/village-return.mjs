/**
 * e2e/village-return.mjs — the village comes back after the memorial hall on a slow phone (perf/100, 2026-11-28).
 *
 * Found by e2e/perf-routes.mjs (phone, 4x CPU): after leaving the hall the village was dressed again ~6 times a second and never
 * drawn — React threw the village's mount render away at every bus snapshot (useTransitState re-rendered LocalPlayer and the
 * doors 4 times a second) and the dressing (prepareVillage) was redone on each try. The player stood in an empty grey world
 * with 250-1300 ms frames. Fixes: game/keptMemo.ts (the dressing kept across thrown-away renders) and useTransitBoarded
 * (net/transitSync.ts: only a change of "aboard" re-renders).
 *
 * Checks (phone 375x812, light tier, CPU 4x slower): the village is drawn again within --within s of the hall's exit, and it was
 * dressed at most twice in the whole visit (the arrival and the way back out). Screenshot of the way back out in the evidence.
 *
 *   CV_CLIENT_URL=http://localhost:5625 node e2e/village-return.mjs [--device phone|pc] [--throttle 4] [--within 30]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { DESKTOP, PHONE, cdp, createRun, launchBrowser, openPlayer, sleep } from "./lib/common.mjs";
import { enterHall, joinVillage, leaveHall } from "./lib/village.mjs";

const { values: args } = parseArgs({
  options: { device: { type: "string", default: "phone" }, throttle: { type: "string" }, within: { type: "string", default: "30" } },
});
const PHONE_DEV = args.device === "phone";
const THROTTLE = Number(args.throttle ?? (PHONE_DEV ? 4 : 1));
const run = createRun(`village-return-${args.device}`);
const b = await launchBrowser();
try {
  const p = await openPlayer(b, run, { tag: "R", device: PHONE_DEV ? PHONE : DESKTOP, settings: PHONE_DEV ? { graphics: "low" } : {} });
  const session = await cdp(p);
  if (THROTTLE > 1) await session.send("Emulation.setCPUThrottlingRate", { rate: THROTTLE });
  const state = () => p.page.evaluate(() => ({ drawn: !!window.__cvVillage, prepares: window.__cvVillagePrepares?.() ?? null }));
  await joinVillage(p, "Rt");
  await p.page.waitForFunction(() => !!window.__cvVillage, null, { timeout: 120000 });
  await sleep(4000);
  run.check("village drawn on arrival", (await state()).drawn);
  await enterHall(p);
  await leaveHall(p);
  const t0 = Date.now();
  let s = await state();
  while (!s.drawn && Date.now() - t0 < Number(args.within) * 1000) {
    await sleep(500);
    s = await state();
  }
  const secs = +((Date.now() - t0) / 1000).toFixed(1);
  await sleep(3000);
  mkdirSync(run.evidence, { recursive: true });
  await p.page.screenshot({ path: join(run.evidence, `village-return-${args.device}.png`) }).catch(() => {});
  const end = await state();
  run.check(`village drawn again within ${args.within} s of the hall's exit`, s.drawn, `${secs} s`);
  run.check("village dressed at most twice (arrival, way back out)", end.prepares !== null && end.prepares <= 2, `prepares ${end.prepares}`);
} catch (err) {
  run.check("step ran to the end", false, String(err?.stack ?? err).slice(0, 900));
}
const code = run.finish();
await b.close();
process.exit(code);
