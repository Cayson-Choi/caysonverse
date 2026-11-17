/**
 * e2e/seat-tap-stand.mjs — 의자를 찍으면 걸어가서 서기만 (발주자 2026-11-17: "그리고 의자를 찍으면 자동 앉기는 빼줘").
 *
 * Every kind of seat the village has, on a PC (click) or a phone (--phone, tap): from a few metres in front of it, a click (tap)
 * on its board walks to its approach and STOPS there — standing, turned toward the seat, never sitting by itself — with the
 * "앉기" button offered (48 px or more); pressing that button sits on that very seat; the button again stands up.
 *   - the plaza (a backed bench), the café terrace (a marked chair), a house's porch bench, the lake (a fishing chair, a shore
 *     bench, a picnic board), the memorial hall (an armchair, a sofa, a letter chair, a backless bench);
 *   - a click on the open ground still just walks there.
 * (The houses' interiors are closed on release: VillageKeypad HOUSE_INTERIORS_OPEN false. The bus's seats are sat on with the
 * button only — no tap on a seat sits there: e2e/village-bus-cabin.mjs.)
 *
 *   npm run dev   (or CV_CLIENT_URL=http://localhost:<port>)
 *   node e2e/seat-tap-stand.mjs [--phone] [--out=<folder>] [--ids=<seat id>,...]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, waitIdle } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "seat-tap-stand-phone" : "seat-tap-stand-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

/** The seats tried, by id (VILLAGE_SEATS), in walking order: village first, then the hall. */
const idsArg = process.argv.find((a) => a.startsWith("--ids="));
const ONLY = idsArg ? idsArg.slice("--ids=".length).split(",") : null;
const VILLAGE_IDS = ["plaza_4:0.58", "cafe_terrace_9", "house_2_porch", "lake:bench_2_1", "lake:chair_P02", "lake:picnic_1_w_1:a"];
const HALL_IDS = ["armchair_0", "sofa_a1", "letter_s1", "bench_w2_s0:front"];

const seatIndex = async (p) => (await pos(p)).seatIndex;
const area = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());

/** Walk to (x, z) the way the game would (its own detour search round the colliders), and wait for the walk to end. */
async function goTo(p, x, z) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const ok = await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const map = am.getActiveMap();
        const via = plan.findDetour(P.x, P.z, x, z, map.geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
        return via !== null;
      },
      [x, z],
    );
    await sleep(300);
    await waitIdle(p, 60000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < 0.6) return at;
    if (!ok) await sleep(500);
  }
  return pos(p);
}

const project = (p, x, y, z) =>
  p.page.evaluate(
    ([x, y, z]) => {
      const { camera, gl } = window.__cvThree();
      camera.updateMatrixWorld();
      const v = camera.position.clone().set(x, y, z).project(camera);
      const r = gl.domElement.getBoundingClientRect();
      return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, on: v.z < 1 && Math.abs(v.x) < 0.9 && Math.abs(v.y) < 0.85 };
    },
    [x, y, z],
  );

async function press(p, x, y) {
  if (p.touch) await p.page.touchscreen.tap(x, y);
  else await p.page.mouse.click(x, y);
}

async function pressButton(p) {
  const btn = p.page.locator(".cv-action-btn");
  await btn.waitFor({ state: "visible", timeout: 5000 });
  if (p.touch) await btn.tap();
  else await btn.click();
}

const button = (p) =>
  p.page.evaluate(() => {
    const e = document.querySelector(".cv-action-btn");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
  });

async function waitFor(p, fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}

/** From in front of seat `s`: click (tap) its board, check the walk and the stop, then 앉기, then stand up. */
async function trySeat(p, s, tag) {
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  // a viewpoint ~2.6 m in front (or as near as the colliders let the walk get)
  // the café's terrace from the south-west: the bus parks at its stop on the road north of it, and is solid (owner 2026-11-15)
  if (s.bench.startsWith("cafe_terrace_")) for (const [x, z] of [[24, -26], [37, -24]]) await goTo(p, x, z);
  // (a terrace chair's front is between tables: nearer, then the approach itself, when the walk cannot get that far)
  for (const d of [2.0, 1.2, 0]) {
    const at = await goTo(p, s.standX + fx * d, s.standZ + fz * d);
    if (Math.hypot(at.x - (s.standX + fx * d), at.z - (s.standZ + fz * d)) < 0.6) break;
  }
  await turnCameraTo(p, s.x, s.z);
  await sleep(600);
  const back = (s.frontEdge ?? 0.2) + 0.12;
  let pick = null;
  for (let k = 0; k < 4; k++) {
    let pt = await project(p, s.x - fx * back, (s.seatY ?? 0.45) + 0.01, s.z - fz * back);
    // a narrow phone view indoors: turn until the seat is in it (the screen's left: Z turns the view left)
    for (let t = 0; t < 12 && !pt.on; t++) {
      const key = pt.x < 0 ? "KeyZ" : "KeyC";
      await p.page.keyboard.down(key);
      await sleep(150);
      await p.page.keyboard.up(key);
      await sleep(250);
      pt = await project(p, s.x - fx * back, (s.seatY ?? 0.45) + 0.01, s.z - fz * back);
    }
    if (!pt.on) {
      run.check(`${tag}: the seat is on screen`, false, pt);
      return;
    }
    await press(p, pt.x, pt.y);
    await sleep(400);
    pick = await p.page.evaluate(() => {
      const c = window.__cvClickPick?.();
      return c && { y: c.pick ? Math.round(c.pick.y * 100) / 100 : null, name: c.pick?.name ?? null, ok: c.plan?.ok ?? null, reason: c.plan?.reason ?? null, sitOn: c.sitOn ?? null };
    });
    if (pick?.sitOn === s.i) break;
    // something in the way from this side (a crown overhead, a table's top): turn the view a little and try again
    pick = { ...pick, retried: k + 1 };
    await p.page.keyboard.down(k % 2 ? "KeyC" : "KeyZ");
    await sleep(240 * (k + 1));
    await p.page.keyboard.up(k % 2 ? "KeyC" : "KeyZ");
    await sleep(400);
  }
  run.check(`${tag}: the ${p.touch ? "tap" : "click"} is on that seat`, pick?.sitOn === s.i, pick);
  await waitIdle(p, 20000);
  await sleep(1200);
  const at = await pos(p);
  const want = Math.atan2(s.x - at.x, s.z - at.z);
  const turn = Math.abs(Math.atan2(Math.sin(want - at.yaw), Math.cos(want - at.yaw)));
  const b = await button(p);
  run.check(`${tag}: walked to the seat's approach and stands there — not seated`, at.seatIndex === -1 && Math.hypot(at.x - s.standX, at.z - s.standZ) < 0.8, { at, stand: [s.standX, s.standZ] });
  run.check(`${tag}: turned to face the seat`, turn < 0.35, { turn: Math.round(turn * 100) / 100 });
  run.check(`${tag}: 앉기 offered, 48 px or more`, !!b && b.text.includes("앉기") && b.w >= 48 && b.h >= 48, b);
  await run.shot(p, `${tag}-1-standing.png`);
  await pressButton(p).catch(() => {});
  const sat = await waitFor(p, async () => (await seatIndex(p)) === s.i, 6000);
  run.check(`${tag}: the 앉기 button sits on that seat`, sat, { seat: await seatIndex(p) });
  await sleep(1800);
  await run.shot(p, `${tag}-2-seated.png`);
  await pressButton(p).catch(() => {});
  await waitFor(p, async () => (await seatIndex(p)) === -1, 5000);
  await sleep(1000);
}

const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
await run.step("join", async () => {
  const j = await joinVillage(p, "자리");
  run.check("in the village", !!j.nick, j);
});
const seats = await p.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s, i) => ({ ...s, i })));
const byId = (id) => seats.find((s) => s.id === id);

await run.step("the open ground still walks", async () => {
  const at = await pos(p);
  const goal = { x: at.x - 2, z: at.z + 2 };
  await turnCameraTo(p, goal.x, goal.z);
  const pt = await project(p, goal.x, 0, goal.z);
  await press(p, pt.x, pt.y);
  await sleep(400);
  await waitIdle(p, 15000);
  const after = await pos(p);
  run.check("a click on the ground walks there (no seat)", Math.hypot(after.x - at.x, after.z - at.z) > 1 && after.seatIndex === -1, { from: at, to: after });
});

for (const id of VILLAGE_IDS) {
  if (ONLY && !ONLY.includes(id)) continue;
  const s = byId(id);
  await run.step(`village: ${id}`, async () => {
    if (!s) return run.check(`seat ${id} exists`, false);
    await trySeat(p, s, id.replace(/[:.]/g, "_"));
  });
}

if (!ONLY || HALL_IDS.some((id) => ONLY.includes(id))) await run.step("into the memorial hall", async () => {
  await goTo(p, 0, -46);
  await goTo(p, 0, -50.8);
  await act(p);
  await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
  await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 });
  await sleep(2500);
  run.check("inside the hall", (await area(p)) === "hall");
});
for (const id of HALL_IDS) {
  if (ONLY && !ONLY.includes(id)) continue;
  const s = byId(id);
  await run.step(`hall: ${id}`, async () => {
    if (!s) return run.check(`seat ${id} exists`, false);
    await trySeat(p, s, id.replace(/[:.]/g, "_"));
  });
}

await b.close();
process.exit(run.finish({ client: CLIENT_URL, phone }));
