/**
 * e2e/lake-catch.mjs - lake v2's catch on screen (owner 2026-11-16: "끌어당겨서 올라오는 모습까지 리얼하게"): sits like
 * lake-fishing.mjs, then for each cast records the reel-in, the lift-out, the hand / net, the show and the release as a frame
 * sequence (<out>/<tag>-c<n>/fNN.jpg) and probes the scene: the fish model must be in the world, visible, near the angler's hands
 * in the show pose, and the line must end at its mouth while it is on it. --fp=1 does it in first person (the fish in the view).
 * Lines below are lake-fishing.mjs's setup.
 *
 * (lake-fishing.mjs - the fishing lake against the REAL server (F, 2026-11-16; chunk E's first version played the server with a
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
const caught = [];
const tag = `${dev}-${time.slice(11, 13)}`;
const run = createRun("lake-catch-" + tag + (opt("fp", "0") === "1" ? "-fp" : ""));
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


const CASTS = Number(opt("casts", "3"));
const probe = () =>
  p.page.evaluate(async () => {
    const t = window.__cvThree?.();
    if (!t) return null;
    const net = await window.__imp("/src/lake/lakeNet.ts");
    const hooks = await window.__imp("/src/lake/fishHooks.ts");
    const out = { fish: [], hook: hooks.hookPointOf(net.selfId()) };
    t.scene.traverse((o) => {
      if (/^fish_[a-z_]+$/.test(o.name) && o.parent && o.parent.type === "Group") {
        let vis = true;
        for (let u = o; u; u = u.parent) if (!u.visible) vis = false;
        const w = o.getWorldPosition(new o.position.constructor());
        // where it is on the screen (NDC; on screen when |x|, |y| < 1 and in front of the camera)
        const n = w.clone().project(t.camera);
        out.fish.push({
          name: o.name,
          vis,
          x: +w.x.toFixed(2),
          y: +w.y.toFixed(2),
          z: +w.z.toFixed(2),
          s: +o.parent.scale.x.toFixed(3),
          // which way its back points (owner 2026-11-18: held up belly-up): the fish's +Y (back) and +Z (nose) in the world
          up: +new o.position.constructor(0, 1, 0).applyQuaternion(o.getWorldQuaternion(new o.quaternion.constructor())).y.toFixed(2),
          onScreen: Math.abs(n.x) < 0.95 && Math.abs(n.y) < 0.95 && n.z < 1,
        });
      }
      // the hands (third person: the fish shown must be in them, the 2026-11-17 live bug had it floating by the shoulder)
      if (/^handslot.?[lr]$/.test(o.name) && !out.hands?.some((h) => h.uuid === o.uuid)) {
        const w = o.getWorldPosition(new o.position.constructor());
        (out.hands ??= []).push({ uuid: o.uuid, x: +w.x.toFixed(2), y: +w.y.toFixed(2), z: +w.z.toFixed(2) });
      }
    });
    const cam = t.camera.position;
    out.cam = { x: +cam.x.toFixed(2), y: +cam.y.toFixed(2), z: +cam.z.toFixed(2) };
    return out;
  });

/** n frames, or with `untilShown` until the show (landed) was seen for 6 frames or the catch is over (at most 160 frames): a fixed
 *  count ended inside the lift on a slow machine and never saw the fish shown (the check then proved nothing). */
async function frames(dir, n, gap, untilShown = false) {
  mkdirSync(dir, { recursive: true });
  const probes = [];
  let shownFrames = 0;
  for (let k = 0; k < (untilShown ? 160 : n); k++) {
    const v = await view();
    probes.push({ k, phase: v.name, probe: await probe() });
    // a screenshot is the slow part (a loaded machine took seconds: the short landed phase slipped between two frames and the
    // show was never sampled): shoot every third frame, and the landed ones; the probes (cheap) are taken every time
    if (v.name === "landed" || k % 3 === 0 || !untilShown) await p.page.screenshot({ path: join(dir, `f${String(k).padStart(3, "0")}.jpg`), type: "jpeg", quality: 70 });
    if (untilShown) {
      if (v.name === "landed") shownFrames++;
      if (shownFrames >= 6 || ["releasing", "ready", "missed"].includes(v.name)) break;
    }
    if (gap) await sleep(gap);
  }
  return probes;
}

await run.step("casts: the catch from the strike to the release", async () => {
  if (FIRST_PERSON) {
    await p.page.keyboard.press("KeyV");
    await sleep(900);
    const mode = await p.page.evaluate(async () => (await window.__imp("/src/game/viewState.ts")).viewState.mode);
    run.check("first person while fishing", mode === "fp", mode);
  }
  for (let n = 1; n <= CASTS; n++) {
    await press3("던지기");
    const bite = await waitPhase(["bite"], 30000);
    if (!bite) continue;
    const bb = await buttonSoon((x) => x?.label === "당겨요!");
    if (bb) await tapButton(bb);
    const after = await waitPhase(["hooked", "lifting", "fighting"], 3000);
    if (!after) continue;
    const big = (await waitPhase(["lifting", "fighting"], 2000))?.name === "fighting";
    let probes = [];
    if (big) {
      const hb = await waitButton(p, "꾹 누르고 있어요", 3000);
      if (hb) {
        const cx = hb.x + hb.w / 2;
        const cy = hb.y + hb.h / 2;
        if (touch) await touchDown(p, cx, cy);
        else {
          await p.page.mouse.move(cx, cy);
          await p.page.mouse.down();
        }
        probes = await frames(join(OUT, `${tag}-c${n}-fight`), 10, 250);
        await waitPhase(["lifting", "landed"], 9000);
        if (touch) await touchUp(p);
        else await p.page.mouse.up();
      }
    }
    probes = probes.concat(await frames(join(OUT, `${tag}-c${n}`), 0, 0, true));
    const shown = probes.filter((x) => ["landed"].includes(x.phase));
    const visibleShow = shown.filter((x) => x.probe?.fish.some((f) => f.vis));
    run.check(`cast ${n}: the fish is drawn (visible) while it is shown`, shown.length > 0 && visibleShow.length === shown.length, shown.slice(0, 3));
    // hotfix 2026-11-17 (live: "손에 아무것도 표시가 안돼"): drawn, on the screen, big enough to read, and (third person) in the hands
    const shownFish = shown.map((x) => ({ k: x.k, f: x.probe?.fish.find((f) => f.vis), hands: x.probe?.hands ?? [] }));
    run.check(`cast ${n}: the fish shown is on the screen`, shownFish.length > 0 && shownFish.every((x) => x.f?.onScreen), shownFish.slice(0, 2));
    run.check(`cast ${n}: the fish shown is drawn at least 0.5 m long (readable beside the chibi)`, shownFish.length > 0 && shownFish.every((x) => (x.f?.s ?? 0) >= 0.5), shownFish.map((x) => x.f?.s));
    // owner 2026-11-18: "뒤집힌 게 아니고 안 뒤집힌 상태로": while shown the fish's back is up (settled frames; the flapping rolls it a little)
    // (the first shown frames are the ease from the hanging hold into the show: judged on the last ones)
    const upShown = shown.slice(-4).map((x) => x.probe?.fish.find((f) => f.vis)?.up);
    run.check(`cast ${n}: the fish shown has its back up (not belly-up)`, upShown.length > 0 && upShown.at(-1) > 0.85 && upShown.every((u) => u !== undefined && u > 0.3), upShown);
    if (!FIRST_PERSON) {
      const gap = (x) => Math.min(...x.hands.map((h) => Math.hypot(h.x - x.f.x, h.y - x.f.y, h.z - x.f.z)));
      // from the third shown frame (the first ones are the 0.35 s ease from the one-hand hold into the arms)
      const settled = shownFish.slice(-3); // (the ease from the hanging hold takes ~0.45 s: judged on the last frames)
      run.check(`cast ${n}: the fish shown is held in the hands (a hand within 0.4 m of it, once settled)`, settled.length > 0 && settled.every((x) => x.f && x.hands.length > 0 && gap(x) < 0.4), shownFish.map((x) => x.f && x.hands.length ? +gap(x).toFixed(2) : null));
      const lifted = probes.filter((x) => x.phase === "lifting" && x.probe?.fish.some((f) => f.vis && f.onScreen && f.y > 0.2));
      run.check(`cast ${n}: the fish is seen coming up out of the water on the line (on screen, above the water)`, lifted.length > 0, lifted.length);
    }
    const onLine = probes.filter((x) => ["lifting"].includes(x.phase) && x.probe?.hook);
    run.check(`cast ${n}: the line ends at the fish while it is lifted`, big || onLine.length > 0, probes.filter((x) => x.phase === "lifting").slice(0, 3));
    writeFileSync(join(OUT, `${tag}-c${n}-probes.json`), JSON.stringify(probes, null, 1));
    await waitPhase(["ready"], 8000);
    await sleep(500);
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
