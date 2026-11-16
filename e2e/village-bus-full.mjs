/**
 * e2e/village-bus-full.mjs — the bus takes only as many riders as it holds (bus v3, owner 2026-11-16: "적절한 인원수만 탈 수 있게
 * 하고 나머지는 탑승을 못하게"). The real capacity is 26 (10 seats + 16 standing places, shared busCabin.ts BUS_CAPACITY, checked by
 * the server's integration test with 26 clients); here the DEV server is started with CV_DEV_BUS_CAPACITY=2 so three browsers
 * show it: A and B board (B on the phone), C (PC) presses board at the door and is refused with "버스가 가득 찼어요. 다음 버스를
 * 기다려 주세요." on its screen and stays outside; A and B are in the bus, not inside each other. Then B gets off and C boards.
 *
 *   OFF=$(node -e 'const n=Date.now()+175000,s=Math.ceil(n/600000)*600000;console.log(s-n)')
 *   (cd server && CV_DEV_BUS_CAPACITY=2 CV_DEV_CLOCK_OFFSET_MS=$OFF PORT=3081 npx tsx src/index.ts)
 *   CV_CLIENT_URL=http://localhost:5681 node e2e/village-bus-full.mjs --out=<folder>
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun("village-bus-full");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });

const browser = await launchBrowser();
const A = await openPlayer(browser, run, { tag: "A-pc", device: DESKTOP });
const B = await openPlayer(browser, run, { tag: "B-phone", device: PHONE });
const C = await openPlayer(browser, run, { tag: "C-pc", device: DESKTOP });
const shot = (p, name) => p.page.screenshot({ path: join(OUT, name) });
const ride = (p) => p.page.evaluate(async () => { const m = await window.__imp("/src/game/busRide.ts"); return { slot: m.selfBusRide.slot, ahead: m.selfBusRide.ahead, right: m.selfBusRide.right }; });
const status = (p) => p.page.evaluate(async () => { const s = await window.__imp("/src/net/transitSync.ts"); return s.transitTripAt(s.transitNowMs()).status; });
async function pollUntil(fn, ms, step = 150) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(step);
  }
  return false;
}
const toDoor = async (p) => {
  await walkAndWait(p, 38.5, -0.5, 90000, 1);
  await walkAndWait(p, 36.9, -6.0, 60000, 0.4);
  // the board button is offered at the door (wait for it: a slow page takes a moment to see the stop)
  await pollUntil(async () => (await p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => t.id))).includes("village_bus_board"), 15000, 300);
  await sleep(500);
};

await run.step("join A, B (phone), C", async () => {
  await joinVillage(A, "에이");
  await joinVillage(B, "비비");
  await joinVillage(C, "씨씨");
  run.check("boarding is open", await pollUntil(async () => (await status(A)) === "boarding", 420000, 500), await status(A));
});

await run.step("A and B board: both aboard, not inside each other", async () => {
  for (const p of [A, B]) {
    await toDoor(p);
    await act(p);
    run.check(`${p.tag} boarded`, await pollUntil(async () => (await ride(p)).slot >= 0, 8000), await ride(p));
  }
  const a = await ride(A);
  const b = await ride(B);
  run.check("A and B stand a body apart (>= 0.5 m)", Math.hypot(a.ahead - b.ahead, a.right - b.right) >= 0.5, { a, b });
  await shot(B, "full-1-B-aboard-phone.png");
});

await run.step("C is refused: the bus is full (the short Korean notice on C's screen), C stays outside", async () => {
  await toDoor(C);
  await act(C);
  const said = await pollUntil(async () => (await C.page.evaluate(() => document.body.innerText)).includes("버스가 가득 찼어요. 다음 버스를 기다려 주세요."), 6000);
  run.check("C sees 버스가 가득 찼어요. 다음 버스를 기다려 주세요.", said, (await C.page.evaluate(() => document.body.innerText)).split("\n").filter((l) => l.includes("버스")).slice(0, 6));
  run.check("C is not aboard", (await ride(C)).slot === -1, await ride(C));
  await shot(C, "full-2-C-refused-pc.png");
});

await run.step("B gets off at the stop: C can board", async () => {
  await B.page.evaluate(async () => (await window.__imp("/src/net/transitSync.ts")).sendBusRide("leave"));
  run.check("B is off", await pollUntil(async () => (await ride(B)).slot === -1, 6000), await ride(B));
  await act(C);
  run.check("C boards now", await pollUntil(async () => (await ride(C)).slot >= 0, 8000), await ride(C));
  await sleep(1200);
  await shot(C, "full-3-C-aboard-pc.png");
});

await browser.close();
process.exit(run.finish({}));
