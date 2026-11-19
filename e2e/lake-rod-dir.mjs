/**
 * e2e/lake-roddir-look.mjs - the angler's hand and arm on the rod (owner 2026-11-19: "낚시대를 잡은 손이 어색", "팔과 손이 많이 꺾여"): sits like lake-catch,
 * then close-ups of the right hand from the side, behind and in front while waiting, casting, and on a bite; a second player looks at the same angler
 * (the other player's view). Screenshots only (<out>/<tag>-*.png), plus the rod's grip / forearm angles measured in the scene.
 *   CV_CLIENT_URL=http://localhost:5621 node e2e/lake-roddir-look.mjs --out=<folder> [--device=pc|phone]
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, press, sleep, touchDown, touchUp, visibleButtons, walkAndWait, layoutReport } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
const OUT = opt("out", join(REPO, ".superpowers", "sdd", "evidence", "lake-fishing"));
const dev = opt("device", "pc");
const device = dev === "phone" ? PHONE : DESKTOP;
const time = opt("time", "2026-11-03T12:30");
/** Lake v2: keep casting until this many species were landed (the dex must list every one with its size and count). */
const SPECIES = Number(opt("species", "4"));
/** Lake v2: a frame sequence of the first lift-out (frames every ~120 ms) into <out>/<tag>-lift/. */
const FRAMES = opt("frames", "1") === "1";
/** Lake v2: first person for the casts (the catch must show in the view). */
const FIRST_PERSON = opt("fp", "0") === "1";
const ITEM = opt("item", "wand");
const caught = [];
const tag = `${dev}-${time.slice(11, 13)}`;
const run = createRun("lake-roddir-" + tag);
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


const orbitTo = (yaw, pitch, dist) =>
  p.page.evaluate(([yaw, pitch, dist]) => { const o = window.__cvOrbitLive(); o.yaw = yaw; o.pitch = pitch; o.distance = dist; }, [yaw, pitch, dist]);
/** the rod's direction (its axis in the slot frame) in the avatar's own frame, and the avatar's yaw-forward test: +z local is the way it faces */
const rodDir = () =>
  p.page.evaluate(() => {
    const g = window.__cvSelfGroup();
    let host = null;
    g.traverse((o) => { if (o.name === "handslotr" || o.name === "handslot.r.rod") { const c = o.children.find((c) => Math.abs(c.position.z - 0.025) < 1e-4 && Math.abs(c.position.x) < 1e-4); if (c && !host) host = c; } });
    if (!host) return null;
    const Q = host.getWorldQuaternion(new host.quaternion.constructor());
    const d = new host.position.constructor(-0.8, 0.6, 0).applyQuaternion(Q).normalize();
    const GQ = g.getWorldQuaternion(new host.quaternion.constructor()).invert();
    d.applyQuaternion(GQ);
    return [d.x, d.y, d.z].map((v) => Math.round(v * 100) / 100);
  });
const RES = {};
let base = 0;
const state = async (name, wait = 700) => {
  await sleep(wait);
  for (const [which, amt] of [["relax", undefined], ["norelax", 0]]) {
    await p.page.evaluate((v) => { window.__cvWristRelax = v; }, amt);
    await sleep(500);
    RES[`${name}-${which}`] = await rodDir();
    await orbitTo(base, 0.9, 4.2);
    await sleep(300);
    await shot(`${name}-${which}`);
  }
  await p.page.evaluate(() => { window.__cvWristRelax = undefined; });
  console.log("DIR", name, JSON.stringify(RES[`${name}-relax`]), JSON.stringify(RES[`${name}-norelax`]));
};
await run.step("join and walk to the pad", async () => {
  await p.page.goto(`${process.env.CV_CLIENT_URL}/`, { waitUntil: "domcontentloaded" });
  await p.page.waitForFunction(() => !!window.__imp, null, { timeout: 60000 });
  await p.page.evaluate(async (it) => {
    const mod = await window.__imp("/shared/src/appearance.ts");
    const a = { ...mod.DEFAULT_APPEARANCE, item: it === "none" ? 0 : mod.SLOT_OPTIONS.item.indexOf(it) };
    localStorage.setItem("cv.entry", JSON.stringify({ nickname: "", appearance: a }));
  }, ITEM);
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
  base = await p.page.evaluate(() => window.__cvOrbitLive().yaw);
  await state("carry-stand");
  await shot("02-rod-carried");
});

await run.step("walk the pier with the rod and sit", async () => {
  await walkAndWait(p, 108, -12, 30000, 1.5);
  await state("carry-pier");
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




await run.step("states", async () => {
  base = await p.page.evaluate(() => window.__cvOrbitLive().yaw);
  await state("seated-idle");
  await press3("던지기");
  await state("cast", 300);
  const bite = await waitPhase(["bite"], 40000);
  await state("waiting", 100);
  if (bite) {
    const bb = await buttonSoon((x) => x?.label === "당겨요!");
    if (bb) await tapButton(bb);
    await waitPhase(["fighting"], 6000);
    await state("fight", 300);
  }
});
const code = run.finish();
await browser.close();
process.exit(code);
