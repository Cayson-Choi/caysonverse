/**
 * e2e/lake-fishing.mjs - the fishing lake's client flow against a MOCKED server (chunk E): the page plays D2's rules through the DEV
 * hooks (lib/lakeMock.mjs). One angler walks to the rental pad, rents the rod, walks along the pier, sits at a fishing chair, casts, waits,
 * sees the nibble and the bite, pulls, lands a small fish (the card), then a big one (the hold and the net), and gets up. Every phase
 * checks the one big button's words and tone (design 12.7: no "당겨요!" while waiting); screenshots of each.
 *
 *   CV_CLIENT_URL=http://localhost:5571 node e2e/lake-fishing.mjs --out=<folder> [--device=pc|phone] [--time=2026-11-03T12:30]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, press, sleep, touchDown, touchUp, visibleButtons, walkAndWait, layoutReport } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, installMock, setMock, waitButton } from "./lib/lakeMock.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-fishing"));
const dev = opt("device", "pc");
const device = dev === "phone" ? PHONE : DESKTOP;
const time = opt("time", "2026-11-03T12:30");
const tag = `${dev}-${time.slice(11, 13)}`;
const run = createRun("lake-fishing-" + tag);
run.evidence = OUT;
mkdirSync(OUT, { recursive: true });
run.allow("D3D X3595 (village shaders, baseline)", /X3595/);

const browser = await launchBrowser();
const p = await openPlayer(browser, run, { tag: "A", device });
const touch = !!device.hasTouch;
const SPOT = 4; // P05: the pier, north side
const shot = (name) => run.shot(p, `${tag}-${name}.png`);
const press3 = async (label) => {
  const b = await waitButton(p, label, 15000);
  if (!b) return null;
  if (touch) await p.page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
  else await p.page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
  return b;
};
const view = () => p.page.evaluate(() => window.__cvMock.log.slice(-1)[0]);
const sent = () => p.page.evaluate(() => window.__cvLake.sent.map((s) => s.type));

await run.step("join and walk to the pad", async () => {
  await joinVillage(p, "낚", time);
  await installMock(p);
  for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
  await walkAndWait(p, 102, -14.6, 20000, 1);
  await sleep(800);
  const b = await bigButton(p);
  run.check("the big button offers to rent the rod", b?.label === "낚싯대 빌리기", b);
  if (touch) run.check("touch button is at least 76 px round", b && b.w >= 76 && Math.abs(b.w - b.h) < 1, b && [b.w, b.h]);
  await shot("01-rent");
});

await run.step("rent the rod", async () => {
  await press3("낚싯대 빌리기");
  await sleep(600);
  run.check("FishingRentRod was sent", (await sent()).includes("FishingRentRod"), await sent());
  const b = await bigButton(p);
  run.check("after renting, the big button is gone (returning is a small button, not the thumb's)", b === null, b);
  run.check("the small 반납하기 button is there instead", (await p.page.locator("[data-lake-return]").count()) === 1);
  await sleep(2500);
  await shot("02-rod-carried");
});

await run.step("walk the pier with the rod and sit", async () => {
  await walkAndWait(p, 108, -12, 30000, 1.5);
  const chair = await p.page.evaluate(async (i) => {
    const c = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS[i];
    return { x: c.x, z: c.z, sx: c.standX, sz: c.standZ, yaw: c.yaw, spot: c.spot };
  }, SPOT);
  // the way a player comes: a tap on the chair walks to its own approach spot (seatTap.ts), from where it is offered
  const goal = await p.page.evaluate(async (i) => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const tap = await window.__imp("/src/game/seatTap.ts");
    const chair = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS[i];
    const seats = am.VILLAGE_ACTIVE_MAP.seats;
    const idx = seats.findIndex((s) => s.kind === "fishing_chair" && s.spot === chair.spot);
    const hit = tap.seatUnderTap(seats, chair.x - Math.sin(chair.yaw) * 0.4, 0.4, chair.z - Math.cos(chair.yaw) * 0.4);
    const g = tap.seatApproachGoal(seats, idx, am.VILLAGE_ACTIVE_MAP.geometry.obstacles, am.VILLAGE_ACTIVE_MAP.bounds);
    return { idx, hit, g };
  }, SPOT);
  run.check("a tap on the chair picks that chair and has an approach spot", goal.hit === goal.idx && !!goal.g, goal);
  await walkAndWait(p, chair.sx, chair.sz, 30000, 1);
  const at = await walkAndWait(p, goal.g.x, goal.g.z, 15000, 0.5);
  run.check("at the approach spot beside the chair", Math.hypot(at.x - goal.g.x, at.z - goal.g.z) < 0.5, [at, chair, goal.g]);
  await sleep(900);
  await shot("03-near-chair");
  const b = await press3("앉아서 낚시");
  run.check("the big button offers to sit", !!b, b);
  await sleep(2500);
  const types = await sent();
  run.check("FishingSit was sent", types.includes("FishingSit"), types);
  const sat = await pos(p);
  run.check("seated (confirmed seat index)", sat.seatIndex >= 0, sat);
  await shot("04-seated");
});

await run.step("cast, wait, nibble, bite", async () => {
  run.check("button says 던지기 when ready", (await bigButton(p))?.label === "던지기", await bigButton(p));
  await press3("던지기");
  const cb = (await waitButton(p, "던지는 중…", 2500)) ?? (await waitButton(p, "찌가 서요…", 3000));
  run.check("while the line is out the button is off and says so", !!cb && cb.disabled, cb);
  await shot("05-casting");
  let b = await waitButton(p, "기다리는 중…", 8000);
  run.check("waiting: the button is off and says so (never 당겨요)", !!b && b.disabled && b.tone === "wait", b);
  await shot("07-waiting");
  b = await waitButton(p, "살짝… 아직!", 12000);
  run.check("nibble: soft button", !!b && b.tone === "soft", b);
  await shot("08-nibble");
  await press3("살짝… 아직!"); // too early: no penalty
  await sleep(300);
  run.check("a press at the nibble sent no strike", !(await sent()).includes("FishingStrike"), await sent());
  b = await waitButton(p, "당겨요!", 12000);
  run.check("bite: red pulsing button", !!b && b.tone === "alert", b);
  await shot("09-bite");
});

await run.step("pull and land a small fish", async () => {
  await press3("당겨요!");
  await sleep(500);
  await shot("10-hooked");
  await sleep(1200);
  await shot("11-lifting");
  const card = await p.page.waitForSelector("[data-lake-card]", { timeout: 6000 }).then(() => true, () => false);
  run.check("the catch card shows", card);
  const text = await p.page.locator("[data-lake-card]").first().textContent().catch(() => "");
  run.check("the card names the fish and the length", /붕어 24cm/.test(text ?? ""), text);
  await shot("12-card");
  await sleep(3800);
  run.check("back to 던지기 after the release", (await bigButton(p))?.label === "던지기", await bigButton(p));
});

await run.step("a big fish: hold and net", async () => {
  await setMock(p, { kind: 5, cm: 72, sig: 3, netted: true, waitMs: 2000, nibbleMs: 1200, holdNeedMs: 2400 });
  await press3("던지기");
  const b = await waitButton(p, "당겨요!", 15000);
  run.check("a drag bite also turns the button red", !!b && b.tone === "alert", b);
  await shot("13-bite-drag");
  await press3("당겨요!");
  const hb = await waitButton(p, "꾹 누르고 있어요", 4000);
  run.check("a big fish asks to be held", !!hb, hb);
  await shot("14-fight-before");
  if (hb) {
    const cx = hb.x + hb.w / 2;
    const cy = hb.y + hb.h / 2;
    if (touch) await touchDown(p, cx, cy);
    else {
      await p.page.mouse.move(cx, cy);
      await p.page.mouse.down();
    }
    await sleep(1300);
    await shot("15-fighting");
    run.check("the hold was sent", (await p.page.evaluate(() => window.__cvLake.sent.filter((s) => s.type === "FishingHold" && s.payload.down).length)) >= 1);
    await sleep(2200);
    if (touch) await touchUp(p);
    else await p.page.mouse.up();
  }
  await sleep(900);
  await shot("16-netting");
  const card = await p.page.waitForSelector("[data-lake-card]", { timeout: 8000 }).then(() => true, () => false);
  run.check("the big catch card shows", card);
  const text = await p.page.locator("[data-lake-card]").first().textContent().catch(() => "");
  run.check("it says 잉어 72cm and the 대물 badge", /잉어 72cm/.test(text ?? "") && /대물/.test(text ?? ""), text);
  await shot("17-big-card");
});

await run.step("the dex and standing up", async () => {
  await press(p, p.page.locator(".cv-lake-dexbtn").first());
  await sleep(400);
  await shot("18-dex");
  const got = await p.page.locator(".cv-lake-dex-item.is-got").count();
  run.check("the dex lists the two species caught", got === 2, got);
  await press(p, p.page.locator(".cv-lake-dex-head button"));
  await sleep(300);
  await press(p, p.page.locator(".cv-lake-stand"));
  await sleep(2500);
  const at = await pos(p);
  run.check("stood up", at.seatIndex < 0, at);
  await shot("19-stood");
  if (touch) {
    const els = await visibleButtons(p);
    const rep = layoutReport(els, device.viewport);
    run.check("touch layout: no button overlaps or leaves the screen", rep.outside.length === 0 && rep.tight.length === 0, rep);
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
