/**
 * e2e/village-bus-outside.mjs — the bus seen from outside at the stop (bus v3 evidence, owner 2026-11-16: the night shot looking
 * into the bus, where poles, the ceiling rail and the window frames cut the view; and the front sign "케이슨 마을" that a bar
 * crossed). One player (PC 1280x800, or --phone) on the pavement by the parked bus, a rider (B) aboard standing in the aisle so
 * the cabin has someone in it; screenshots: looking into the side windows (the owner's angle), the kerb-side sign, and the front
 * sign from the stop's pad, low and close. --time picks the hour (night default: the owner's screenshot).
 *
 *   OFF=$(node -e 'const n=Date.now()+175000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=3081 npx tsx src/index.ts)
 *   CV_CLIENT_URL=http://localhost:5681 node e2e/village-bus-outside.mjs --out=<folder> [--phone] [--time=2026-11-03T21:30] [--tag=after]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, turnCameraTo, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage, setOrbit } from "./lib/village.mjs";

const arg = (n, d) => (process.argv.find((a) => a.startsWith(`--${n}=`)) ?? `--${n}=${d}`).slice(n.length + 3);
const phone = process.argv.includes("--phone");
const TIME = arg("time", "2026-11-03T21:30");
const TAG = arg("tag", "after");
const run = createRun("village-bus-outside");
const OUT = arg("out", run.evidence);
mkdirSync(OUT, { recursive: true });
const dev = phone ? "phone" : "pc";

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: `A-${dev}`, device: phone ? PHONE : DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-pc", device: DESKTOP });
const shot = (name) => A.page.screenshot({ path: join(OUT, `${TAG}-${dev}-${name}.png`) });
/** A bus-local point (m ahead of the parked bus's middle, m towards its doors) in the world. */
const world = (p, ahead, right) =>
  p.page.evaluate(async ([a, r]) => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const b = sync.getTransitRenderPose();
    const fx = Math.sin(b.yaw);
    const fz = Math.cos(b.yaw);
    return { x: b.x + fx * a - fz * r, z: b.z + fz * a + fx * r };
  }, [ahead, right]);
async function pollUntil(fn, ms, step = 200) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}

await run.step("join; B boards and stands in the aisle", async () => {
  await joinVillage(A, "구경", TIME);
  await joinVillage(B, "탑승", TIME);
  await pollUntil(async () => (await B.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; })) === "boarding", 120000, 500);
  await walkAndWait(B, 38.5, -0.5, 40000, 1);
  await walkAndWait(B, 36.9, -6.0, 30000, 0.4);
  await sleep(600);
  await act(B);
  run.check("B aboard", await pollUntil(async () => (await B.page.evaluate(async () => (await window.__imp("/src/game/busRide.ts")).selfBusRide.slot)) >= 0, 8000), null);
});

await run.step("A on the pavement looking into the side windows (the owner's angle), then the signs", async () => {
  await walkAndWait(A, 38.5, -0.5, 40000, 1);
  const side = await world(A, 0.6, 3.3);
  await walkAndWait(A, side.x, side.z, 30000, 0.6);
  await setOrbit(A, 5, 0.15);
  const look = await world(A, -0.4, 0);
  await turnCameraTo(A, look.x, look.z);
  await sleep(1500);
  await shot("1-side-windows");
  const sign = await world(A, 2.4, 0.5);
  await turnCameraTo(A, sign.x, sign.z);
  await setOrbit(A, 3.4, -0.05);
  await sleep(1200);
  await shot("2-kerb-sign");
  // the front sign: from the pad ahead of the bus, a little to the kerb side, close and looking up
  const front = await world(A, 7.0, 2.2);
  await walkAndWait(A, front.x, front.z, 30000, 0.6);
  const nose = await world(A, 4.5, 0);
  await turnCameraTo(A, nose.x, nose.z);
  await setOrbit(A, 3.2, -0.25);
  await sleep(1500);
  await shot("3-front-sign");
});

await browser.close();
process.exit(run.finish({ TAG, TIME }));
