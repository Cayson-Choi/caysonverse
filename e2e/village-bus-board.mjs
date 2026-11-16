/**
 * e2e/village-bus-board.mjs — boarding opens 3 minutes before each departure (owner 2026-11-15: "버스 탑승은 출발
 * 3분전부터 탑승이 가능하도록 하자"). In the boarding window: the bus stands parked at the stop, the stop's pill says
 * "지금 탈 수 있어요", by the bus's doors E / the action button boards, in front of the shelter's bench it still sits
 * (riders wait seated), and a board press is accepted by the server. Outside it: the pill says how soon boarding opens.
 *
 * Run with the server's clock put inside a boarding window (DEV only offset), e.g. 2 min 40 s before a departure:
 *   server:  CV_DEV_CLOCK_OFFSET_MS=<offset> PORT=2871 npx tsx src/index.ts   (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:2871 npx vite --port 5471 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5471 node e2e/village-bus-board.mjs [--out=<folder>] [--phone]
 * Without the offset it checks whichever phase the real clock is in.
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { PHONE, DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const outArg = process.argv.find((a) => a.startsWith("--out="));
const phone = process.argv.includes("--phone");
const run = createRun(phone ? "village-bus-board-phone" : "village-bus-board");
const OUT = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(OUT, { recursive: true });
const tag = phone ? "phone" : "pc";

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag, device: phone ? PHONE : DESKTOP });
const shot = (name) => p.page.screenshot({ path: join(OUT, name) });
const pill = () => p.page.evaluate(() => document.querySelector(".cv-bus-hint")?.textContent ?? "");
const button = () => p.page.evaluate(() => document.querySelector(".cv-action-btn")?.textContent ?? "");
const schedule = () =>
  p.page.evaluate(async () => {
    const sync = await window.__imp("/src/net/transitSync.ts");
    const transit = await window.__imp("/shared/src/village/transit.ts");
    const now = sync.transitNowMs();
    const trip = transit.busTripAt(now);
    return { now, status: trip.status, startMs: trip.startMs, nextStartMs: trip.nextStartMs, boardingMs: transit.TRANSIT.boardingMs, boarded: sync.getTransitState().boarded };
  });

await run.step("join", async () => {
  await joinVillage(p, "버스");
  await p.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().snapshot !== null, null, { timeout: 30000 }).catch(() => {});
  run.check("the boarding window is 3 minutes", (await schedule()).boardingMs === 180_000, await schedule());
});

const s0 = await schedule();
const boarding = s0.status === "boarding";

await run.step(boarding ? "boarding window: by the bus's doors E boards" : "between buses: the pill says when boarding opens", async () => {
  // round the bus's tail over the crosswalk's kerb side (the parked bus blocks a straight walk from the plaza)
  await walkAndWait(p, 38.5, -0.5, 40000, 1);
  await walkAndWait(p, 36.9, -6.0, 30000, 0.4);
  await sleep(1500);
  run.check("standing on the pad by the doors", Math.abs((await pos(p)).x - 36.9) < 0.6, await pos(p));
  const s = await schedule();
  const text = await pill();
  const label = await button();
  await shot(`doors-${s.status}-${tag}.png`);
  if (s.status === "boarding") {
    const left = s.startMs - s.now;
    run.check("boarding is open for up to 3 minutes before the departure", left > 0 && left <= 180_000, { leftS: Math.round(left / 1000) });
    run.check("the pill says board now, by the bus", text.includes("지금 탈 수 있어요") && text.includes("버스 앞에서"), text);
    run.check("the action button boards", /버스 타기|탑승/.test(label) && !/뒤 출발|분 뒤|초 뒤/.test(label), label);
  } else {
    run.check("the pill says how soon boarding opens", /뒤부터 탈 수 있어요/.test(text), text);
    run.check("the button counts down to the bus", /뒤/.test(label), label);
  }
});

await run.step("in front of the shelter's bench the seat keeps E", async () => {
  const seat = await p.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.find((s) => s.bench === "shelter"));
  await walkAndWait(p, seat.standX, seat.standZ, 30000, 0.3);
  run.check("standing in front of the bench", Math.hypot((await pos(p)).x - seat.standX, (await pos(p)).z - seat.standZ) < 0.4, await pos(p));
  await sleep(1200);
  const label = await button();
  run.check("the action button offers 앉기 at the bench", label.includes("앉기"), { label, status: (await schedule()).status });
  run.check("the stop's pill is still shown", (await pill()).length > 0, await pill());
  await shot(`bench-${(await schedule()).status}-${tag}.png`);
});

if (boarding) {
  await run.step("board from the doors: the server accepts", async () => {
    await walkAndWait(p, 36.9, -6.0, 30000, 0.4);
    await sleep(1000);
    await act(p);
    const ok = await p.page.waitForFunction(async () => (await window.__imp("/src/net/transitSync.ts")).getTransitState().boarded, null, { timeout: 8000, polling: 200 }).then(() => true, () => false);
    run.check("boarded", ok, { pos: await pos(p), schedule: await schedule() });
    await sleep(800);
    await shot(`boarded-${tag}.png`);
    const label = await button();
    // aboard, the action is the cabin's (sit in a free seat, take hold of a pole); the ride panel has the 하차 button (bus-ride 2026-11-15)
    run.check("the action button now offers a seat or a pole inside the bus", /앉기|잡기|손잡이/.test(label), label);
    const off = await p.page.evaluate(() => [...document.querySelectorAll("[data-testid=bus-ride-hud] button")].some((b) => b.textContent.trim() === "하차"));
    run.check("the ride panel has the 하차 button (the doors are open at the stop)", off);
  });
}

const code = run.finish();
await browser.close();
process.exit(code);
