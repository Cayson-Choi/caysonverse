/**
 * e2e/lake-fight.mjs - the big fish's fight (owner 2026-11-19: "당기세요 놓으세요를 시키는대로 하면 낚이도록"): a scripted angler against the
 * REAL server, which must run with CV_FISHING_FORCE_KIND=carp (every fish is a big 잉어, so every cast is a fight).
 *   --mode=follow  does what the prompt says (holds on "당기세요", lets go on "놓아주세요"): lands the fish
 *   --mode=hold    holds all the time: the line snaps ("끊어졌어요")
 *   --mode=none    never pulls: the fish escapes
 *   --mode=through the key is already down when the fight starts (pressed to strike and never let go): it counts as a pull (the distance
 *                  rises) until the first "놓아주세요" (then, still holding, the line snaps)
 * Screenshots of the prompt (PC / phone) go to <out>/<tag>-<mode>-*.png.
 *   CV_CLIENT_URL=http://localhost:5621 node e2e/lake-fight.mjs --out=<folder> [--device=pc|phone] [--mode=follow]
 */
import { join } from "node:path";
import { mkdirSync, writeFileSync } from "node:fs";
import { DESKTOP, PHONE, REPO, createRun, launchBrowser, openPlayer, pos, press, sleep, touchDown, touchUp, visibleButtons, walkAndWait, layoutReport } from "./lib/common.mjs";
import { joinVillage } from "./lib/village.mjs";
import { bigButton, waitButton } from "./lib/lakeMock.mjs";
import { installPhaseLog, phaseMark, startFightAngler, startFightAnglerInPage, waitSeen } from "./lib/lakeFight.mjs";

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
const run = createRun("lake-fight-" + tag);
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
    // the modules once (window.__imp scans the resource timings on every call: slow on a throttled page)
    const m = (window.__cvMods ??= { net: await window.__imp("/src/lake/lakeNet.ts"), proto: await window.__imp("/src/lake/lakeProtocol.ts") });
    const { net, proto } = m;
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
/** CV_E2E_CPU=4 (a throttled page): every wait is that many times longer */
const K = Math.max(1, Number(process.env.CV_E2E_CPU) || 1);
const waitPhase = async (names, ms) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms * K) {
    const v = await view();
    if (names.includes(v.name)) return v;
    await sleep(80);
  }
  return null;
};

await run.step("join and walk to the pad", async () => {
  await joinVillage(p, "낚", time);
  await installPhaseLog(p);
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


const MODE = opt("mode", "follow");
const INPUT = opt("input", touch ? "touch" : "mouse"); // key | mouse | touch
const CASTS = Number(opt("casts", "1"));
const promptNow = () =>
  p.page.evaluate(() => {
    const el = document.querySelector("[data-fight-cmd]");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cmd: el.getAttribute("data-fight-cmd"), tension: Number(el.getAttribute("data-fight-tension")), progress: Number(el.getAttribute("data-fight-progress")), text: el.textContent, stage: el.getAttribute("data-fight-stage"), box: { x: r.x, y: r.y, w: r.width, h: r.height }, vw: innerWidth, vh: innerHeight };
  });
const noticeText = () => p.page.evaluate(() => document.querySelector(".cv-lake-caption")?.textContent ?? "");

await run.step(`fight (${MODE}): the whole fight, scripted`, async () => {
  for (let n = 1; n <= CASTS; n++) {
    await press3("던지기");
    const bite = await waitPhase(["bite"], 40000);
    run.check(`cast ${n}: a bite comes`, !!bite, bite);
    if (!bite) continue;
    // the in-page angler is set up before the strike (its setup eats the first stage's grace on a slow page)
    const pageAngler = MODE !== "through" && opt("angler", "pointer") === "page" ? await startFightAnglerInPage(p, { mode: MODE }) : null;
    if (MODE === "through" && INPUT === "key") {
      await p.page.keyboard.down("Space"); // the strike by key, and the key stays down
    } else {
      const bb = await buttonSoon((x) => x?.label === "당겨요!");
      if (bb) await tapButton(bb);
    }
    const fight = await waitPhase(["fighting"], 6000);
    run.check(`cast ${n}: a big fish starts the fight`, !!fight, fight);
    if (!fight) {
      if (MODE === "through") await p.page.keyboard.up("Space");
      continue;
    }
    const fightMark = await phaseMark(p);
    const angler = MODE === "through" ? null : pageAngler ? pageAngler : startFightAngler(p, { touch, mode: MODE, input: INPUT });
    const seen = { panel: false, cmds: [], maxTension: 0, maxProgress: 0, shots: new Set(), first: null, minProgress: 100 };
    let end = null;
    let note = "";
    const t0 = Date.now();
    while (Date.now() - t0 < 60000) {
      const v = await view();
      if (v.name !== "fighting") {
        // the phase that ended the fight can be gone between two polls (missed lasts a moment): the phase log has it
        end = (await waitSeen(p, ["lifting", "landed", "missed"], 500, fightMark))?.name ?? v.name;
        if (v.name === "missed") await sleep(250); // the personal message with the reason follows the phase by a moment
        note = await noticeText();
        break;
      }
      const pr = await promptNow();
      if (pr) {
        seen.panel = (await p.page.evaluate(() => !!document.querySelector(".cv-fight"))) || seen.panel;
        seen.first ??= pr;
        if (seen.cmds[seen.cmds.length - 1] !== pr.cmd) seen.cmds.push(pr.cmd);
        seen.maxTension = Math.max(seen.maxTension, pr.tension);
        seen.maxProgress = Math.max(seen.maxProgress, pr.progress);
        seen.minProgress = Math.min(seen.minProgress, pr.progress);
        if (!seen.shots.has(pr.cmd) && Date.now() - t0 > 700) {
          seen.shots.add(pr.cmd);
          await shot(`${MODE}-prompt-${pr.cmd}`);
        }
      }
      await sleep(80);
    }
    if (typeof angler?.log === "function") console.log("LAGS", JSON.stringify(await angler.log()));
    if (angler) await angler.stop();
    else await p.page.keyboard.up("Space");
    console.log("END", end, JSON.stringify(note));
    end = end ?? (await view()).name;
    const landed = end === "lifting" || end === "landed";
    run.check(`cast ${n}: the big BUTTON is the prompt (it carries the command, big and in view) (${INPUT})`, !!seen.first && seen.first.box.w >= (touch ? 70 : 150) && seen.first.box.x >= 0 && seen.first.box.x + seen.first.box.w <= seen.first.vw && seen.first.box.y >= 0 && seen.first.box.y + seen.first.box.h <= seen.first.vh && /당기세요|놓아주세요/.test(seen.first.text), seen.first);
    run.check(`cast ${n}: no panel covers the view (no .cv-fight)`, seen.panel === false, seen.panel);
    if (MODE === "follow") {
      run.check(`cast ${n} (follow): the fish is landed`, landed, { end, seen: { ...seen, shots: [...seen.shots] } });
      run.check(`cast ${n} (follow): the prompt alternated (pull, run, pull, run, pull at least) and the line never snapped`, seen.cmds.length >= 5 && seen.maxTension < 100, seen.cmds);
    } else if (MODE === "hold") {
      run.check(`cast ${n} (hold): the line snapped, the fish is lost (not landed)`, !landed && end === "missed", { end, seen: { ...seen, shots: [...seen.shots] } });
      run.check(`cast ${n} (hold): the tension showed it (reached 40 % at least in the samples before the snap)`, seen.maxTension >= 40, seen.maxTension);
      run.check(`cast ${n} (hold): the words say the line broke`, /끊어/.test(note), note);
    } else if (MODE === "none") {
      run.check(`cast ${n} (none): the fish escaped (not landed)`, !landed && end === "missed", { end, seen: { ...seen, shots: [...seen.shots] } });
      run.check(`cast ${n} (none): the distance fell toward 0`, seen.minProgress < seen.first.progress, seen);
      run.check(`cast ${n} (none): the words say it escaped`, /도망/.test(note), note);
    } else {
      // a key already down when the fight starts counts as pulling the first stage (the old bug: it was never sent)
      run.check(`cast ${n} (through): the held key pulled: the distance rose above where the fight began`, seen.maxProgress > seen.first.progress + 3, { first: seen.first.progress, max: seen.maxProgress });
    }
    await waitPhase(["ready"], 12000);
    await sleep(500);
  }
});

const code = run.finish();
await browser.close();
process.exit(code);
