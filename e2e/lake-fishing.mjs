/**
 * e2e/lake-fishing.mjs - the fishing lake against the REAL server (F, 2026-11-16; chunk E's first version played the server with a
 * mock). One angler walks to the rental pad, rents the rod, walks along the pier, sits at a fishing chair, casts, waits, sees the
 * nibble and the bite, pulls, lands a small fish (the card), then fishes on until a big one comes (the hold and the net), and gets
 * up. Every phase checks the one big button's words and tone (design 12.7: no "당겨요!" while waiting) and that the screen's phase
 * is the server's (Player.fishPhase); screenshots of each.
 *
 * The server must run with CV_FISHING_FORCE_KIND=cycle (dev only: the species go round 붕어, 블루길, 피라미, 떡붕어, 배스, 잉어, ...),
 * so a big fish (잉어: always netted) comes within six casts.
 *
 *   CV_CLIENT_URL=http://localhost:5621 node e2e/lake-fishing.mjs --out=<folder> [--device=pc|phone] [--time=2026-11-03T12:30]
 */
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, press, sleep, touchDown, touchUp, visibleButtons, walkAndWait, layoutReport } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";

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
const tapButton = async (b) => {
  if (touch) await p.page.touchscreen.tap(b.x + b.w / 2, b.y + b.h / 2);
  else await p.page.mouse.click(b.x + b.w / 2, b.y + b.h / 2);
};
const press3 = async (label, ms = 15000) => {
  const b = await waitButton(p, label, ms);
  if (!b) return null;
  await tapButton(b);
  return b;
};
/** My schema fields as the server set them (Player.rod, fishSpot, fishPhase, ...) and the phase's name. */
const view = () =>
  p.page.evaluate(async () => {
    const net = await window.__imp("/src/lake/lakeNet.ts");
    const proto = await window.__imp("/src/lake/lakeProtocol.ts");
    const v = proto.emptyFishView();
    net.readFishView(net.selfId(), v);
    return { ...v, name: proto.phaseName(v.phase) };
  });
/** The big button once it shows what `ok` wants (the HUD polls the schema: give it a moment), or the last one seen. */
const buttonSoon = async (ok, ms = 700) => {
  const t0 = Date.now();
  let b = await bigButton(p);
  while (!ok(b) && Date.now() - t0 < ms) {
    await sleep(40);
    b = await bigButton(p);
  }
  return b;
};
const waitPhase = async (names, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await view();
    if (names.includes(v.name)) return v;
    await sleep(80);
  }
  return null;
};

await run.step("join and walk to the pad", async () => {
  await joinVillage(p, "낚", time);
  for (const [x, z] of [[40, 0], [80, -9], [100, -12]]) await walkAndWait(p, x, z, 40000, 2);
  await walkAndWait(p, 102, -14.6, 20000, 1);
  await sleep(800);
  const b = await bigButton(p);
  run.check("the big button offers to rent the rod", b?.label === "낚싯대 빌리기", b);
  if (touch) run.check("touch button is at least 76 px round", b && b.w >= 76 && Math.abs(b.w - b.h) < 1, b && [b.w, b.h]);
  await shot("01-rent");
});

await run.step("rent the rod (the server's Player.rod)", async () => {
  await press3("낚싯대 빌리기");
  await sleep(900);
  const v = await view();
  run.check("the server gave the rod: rod 1, carry", v.rod === 1 && v.name === "carry", v);
  const b = await bigButton(p);
  run.check("after renting, the big button is gone (returning is a small button, not the thumb's)", b === null, b);
  run.check("the small 반납하기 button is there instead", (await p.page.locator("[data-lake-return]").count()) === 1);
  await sleep(2500);
  await shot("02-rod-carried");
});

await run.step("walk the pier with the rod and sit", async () => {
  await walkAndWait(p, 108, -12, 30000, 1.5);
  const goal = await p.page.evaluate(async (i) => {
    const am = await window.__imp("/src/game/activeMap.ts");
    const tap = await window.__imp("/src/game/seatTap.ts");
    const chair = (await window.__imp("/src/lake/lakeNearby.ts")).FISHING_CHAIRS[i];
    const seats = am.VILLAGE_ACTIVE_MAP.seats;
    const idx = seats.findIndex((s) => s.lake === "fishing_chair" && s.spot === chair.spot);
    const hit = tap.seatUnderTap(seats, chair.x - Math.sin(chair.yaw) * 0.4, 0.4, chair.z - Math.cos(chair.yaw) * 0.4);
    const g = tap.seatApproachGoal(seats, idx, am.VILLAGE_ACTIVE_MAP.geometry.obstacles, am.VILLAGE_ACTIVE_MAP.bounds);
    return { idx, hit, g, sx: chair.standX, sz: chair.standZ };
  }, SPOT);
  run.check("a tap on the chair picks that chair and has an approach spot", goal.hit === goal.idx && !!goal.g, goal);
  await walkAndWait(p, goal.sx, goal.sz, 30000, 1);
  const at = await walkAndWait(p, goal.g.x, goal.g.z, 15000, 0.5);
  run.check("at the approach spot beside the chair", Math.hypot(at.x - goal.g.x, at.z - goal.g.z) < 0.5, [at, goal.g]);
  await sleep(900);
  await shot("03-near-chair");
  const b = await press3("앉아서 낚시");
  run.check("the big button offers to sit", !!b, b);
  await sleep(2500);
  const sat = await pos(p);
  run.check("seated on the chair's seat (LAKE_SEAT_BASE + spot)", sat.seatIndex === goal.idx, [sat.seatIndex, goal.idx]);
  const v = await view();
  run.check("the server says ready at spot P05", v.name === "ready" && v.spot === SPOT, v);
  await shot("04-seated");
});

/** One cast to its end. Returns "small" | "big" | "missed". Screenshots the first time of each moment. */
const seen = new Set();
const once = async (key, name) => {
  if (seen.has(key)) return;
  seen.add(key);
  await shot(name);
};
async function oneCast(n) {
  run.check(`cast ${n}: the button says 던지기 when ready`, (await bigButton(p))?.label === "던지기", await bigButton(p));
  await press3("던지기");
  const flying = await waitPhase(["casting", "settling"], 2500);
  run.check(`cast ${n}: the server is casting`, !!flying, flying);
  const cb = await buttonSoon((b) => !!b && b.disabled);
  run.check(`cast ${n}: while the line flies the button is off`, !!cb && cb.disabled, cb);
  await once("cast", "05-casting");
  const w = await waitPhase(["waiting"], 6000);
  const wb = await buttonSoon((b) => b?.label === "기다리는 중…");
  run.check(`cast ${n}: waiting — the button is off and says so (never 당겨요)`, !!w && !!wb && wb.disabled && wb.tone === "wait" && wb.label === "기다리는 중…", wb);
  await once("wait", "07-waiting");
  // the nibble (a drag may have none), then the bite
  const nb = await waitPhase(["nibble", "bite"], 22000);
  run.check(`cast ${n}: a nibble or a bite came`, !!nb, nb);
  if (nb?.name === "nibble") {
    const b = await buttonSoon((x) => x?.label === "살짝… 아직!" || x?.label === "당겨요!");
    run.check(`cast ${n}: nibble — soft button 살짝… 아직! (or already the bite)`, (b?.label === "살짝… 아직!" && b.tone === "soft") || b?.label === "당겨요!", b);
    await once("nibble", "08-nibble");
    if (b?.label === "살짝… 아직!") await tapButton(b); // too early: no penalty, no strike sent
    await sleep(150);
    const still = await view();
    run.check(`cast ${n}: a press at the nibble changes nothing`, ["nibble", "bite"].includes(still.name), still);
  }
  const bite = await waitPhase(["bite"], 6000);
  const bb = await buttonSoon((x) => x?.label === "당겨요!");
  run.check(`cast ${n}: bite — red 당겨요!`, !!bite && bb?.label === "당겨요!" && bb.tone === "alert", { bite, bb });
  await once("bite-" + (bite?.sig ?? 0), `09-bite-sig${bite?.sig ?? 0}`);
  if (bb) await tapButton(bb);
  const after = await waitPhase(["hooked", "lifting", "fighting", "missed"], 3000);
  run.check(`cast ${n}: the pull hooked the fish`, !!after && after.name !== "missed", after);
  if (!after || after.name === "missed") {
    await waitPhase(["ready"], 4000);
    return "missed";
  }
  await sleep(250);
  await once("hooked", "10-hooked");
  const next = await waitPhase(["lifting", "fighting"], 2000);
  if (next?.name === "fighting") {
    const hb = await waitButton(p, "꾹 누르고 있어요", 3000);
    run.check(`cast ${n}: a big fish asks to be held`, !!hb, hb);
    await shot("14-fight-before");
    if (hb) {
      const cx = hb.x + hb.w / 2;
      const cy = hb.y + hb.h / 2;
      if (touch) await touchDown(p, cx, cy);
      else {
        await p.page.mouse.move(cx, cy);
        await p.page.mouse.down();
      }
      await sleep(1200);
      await shot("15-fighting");
      const netting = await waitPhase(["netting", "landed"], 9000);
      if (touch) await touchUp(p);
      else await p.page.mouse.up();
      run.check(`cast ${n}: holding brought the fish to the net`, !!netting, netting);
      await sleep(700);
      await shot("16-netting");
    }
  } else {
    await sleep(600);
    await once("lifting", "11-lifting");
  }
  const landed = await waitPhase(["landed"], 4000);
  run.check(`cast ${n}: landed`, !!landed, landed);
  const card = await p.page.waitForSelector("[data-lake-card]", { timeout: 4000 }).then(() => true, () => false);
  const text = await p.page.locator("[data-lake-card]").first().textContent().catch(() => "");
  const label = await p.page.evaluate(async (k) => (await window.__imp("/src/lake/lakeProtocol.ts")).species(k)?.label ?? "?", landed?.kind ?? 0);
  run.check(`cast ${n}: the card names the server's fish and length`, card && (text ?? "").includes(`${label} ${landed?.cm}cm`), { text, landed, label });
  await sleep(500);
  await shot(next?.name === "fighting" ? "17-big-card" : "12-card");
  await sleep(1300);
  await once("show-" + (next?.name === "fighting" ? "big" : "small"), next?.name === "fighting" ? "17b-big-show" : "12b-show");
  const back = await waitPhase(["ready"], 6000);
  run.check(`cast ${n}: back to ready after the release`, !!back, back);
  await sleep(400);
  return next?.name === "fighting" ? "big" : "small";
}

await run.step("cast until a small and a big fish (the server's cycle of species)", async () => {
  const got = new Set();
  for (let n = 1; n <= 8 && !(got.has("small") && got.has("big")); n++) got.add(await oneCast(n));
  run.check("a small fish and a big fish were landed", got.has("small") && got.has("big"), [...got]);
});

await run.step("the dex, the board and standing up", async () => {
  await press(p, p.page.locator(".cv-lake-dexbtn").first());
  await sleep(800);
  await shot("18-dex");
  const got = await p.page.locator(".cv-lake-dex-item.is-got").count();
  run.check("the dex lists the species caught", got >= 2, got);
  const board = (await p.page.locator("[data-lake-board]").textContent().catch(() => "")) ?? "";
  run.check("the board (오늘의 대어) is shown", board.includes("오늘의 대어"), board);
  await press(p, p.page.locator(".cv-lake-dex-head button"));
  await sleep(300);
  await press(p, p.page.locator(".cv-lake-stand"));
  await sleep(2500);
  const at = await pos(p);
  run.check("stood up", at.seatIndex < 0, at);
  const v = await view();
  run.check("the server took the line in: carry", v.name === "carry" && v.spot === -1, v);
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
