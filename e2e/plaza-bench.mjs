/**
 * e2e/plaza-bench.mjs — 광장 벤치 16자리 모두 앉기 (2026-11-16 hotfix: "광장에 있는 벤치에 앉기가 안되는데").
 *
 * 분수 둘레 벤치 8개(자리 0..15, 등받이가 있어 앞에서만 앉음)마다, 자리 하나하나에 대해:
 *   1. 앞에서 그 자리 판자를 누르기(PC 클릭 / 폰 톡), 2. 옆(벤치 끝 바깥)에서 판자, 2b. 5.5 m 뒤에서 등받이,
 *   2c. 5.5 m 뒤에서 살 틈 → 모두 그 자리 앞까지 걸어가 서서 자리를 바라보고(자동으로 앉지 않음, 발주자 2026-11-17
 *      "의자를 찍으면 자동 앉기는 빼줘"), 48 px 이상인 "앉기" 버튼이 뜨고, 그 버튼을 누르면 그 자리에 앉음
 *   3. 그 자리 앞에 서서 E(PC) / 동그란 행동 버튼(폰) → 버튼이 "앉기"이고 그 자리에 앉음
 *   4. 등받이 뒤에 서면 "앉기"가 뜨지 않고, 억지로 보낸 Sit도 서버가 받지 않음
 *
 *   npm run dev   (다른 창에서; 다른 포트면 CV_CLIENT_URL=http://localhost:<port>)
 *   node e2e/plaza-bench.mjs [--phone] [--seats=0,1,2]
 */
import { CLIENT_URL, DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, waitIdle, walkTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const seatsArg = process.argv.find((a) => a.startsWith("--seats="));
const ONLY = seatsArg ? seatsArg.slice("--seats=".length).split(",").map(Number) : null;
const run = createRun(phone ? "plaza-bench-phone" : "plaza-bench-desktop");

/** The way round the plaza: a circle outside the benches (they stand at 11 m, their boxes reach ~11.8 m). */
const RING = 13.6;

const seatIndex = async (p) => (await pos(p)).seatIndex;

/** Click-walk to (x, z) and wait for the walk to end. */
async function walk(p, x, z) {
  await walkTo(p, x, z);
  await sleep(300);
  await waitIdle(p, 25000);
  await sleep(250);
}

/** Benches stand at 11 m, one per 45 degrees from 22.5; the gaps between them are at 0, 45, 90... degrees. */
const GAP = Math.PI / 4;
const nearestGap = (a) => Math.round(a / GAP) * GAP;
const ringAt = (a) => [RING * Math.sin(a), RING * Math.cos(a)];

/**
 * Walk to (x, z) round the plaza (the fountain and the benches are in the way of a straight line): out through the
 * nearest gap between two benches to the ring outside them, along the ring, and in through the gap nearest the target
 * when it lies inside the ring of benches.
 */
async function goTo(p, x, z) {
  const at = await pos(p);
  if (Math.hypot(at.x - x, at.z - z) < 0.3) return;
  const inside = (px, pz) => Math.hypot(px, pz) < 11.9;
  let a0 = Math.atan2(at.x, at.z);
  if (inside(at.x, at.z)) a0 = nearestGap(a0);
  const a1raw = Math.atan2(x, z);
  const a1 = inside(x, z) ? nearestGap(a1raw) : a1raw;
  let d = a1 - a0;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  const steps = Math.ceil(Math.abs(d) / (Math.PI / 8));
  await walk(p, ...ringAt(a0));
  for (let k = 1; k <= steps; k++) await walk(p, ...ringAt(a0 + (d * k) / steps));
  await walk(p, x, z);
  return pos(p);
}

/** Screen point of a world point under the game camera, and whether it is on the screen. */
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

/** Wait until seated (or the time is up); returns the seat index (-1 standing). */
async function waitSeated(p, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await seatIndex(p);
    if (s >= 0) return s;
    await sleep(200);
  }
  return seatIndex(p);
}

/** A picture once the sitter has glided onto the seat (the seat is the server's at once; the body settles over a second). */
async function settledShot(p, file) {
  await sleep(1800);
  await run.shot(p, file);
}

async function standUp(p) {
  if ((await seatIndex(p)) < 0) return;
  await act(p);
  for (let k = 0; k < 30 && (await seatIndex(p)) >= 0; k++) await sleep(150);
  await sleep(900);
}

/** The context button's text now (or "" when there is none). */
const actionText = (p) => p.page.evaluate(() => [...document.querySelectorAll(".cv-action-btn")].map((e) => e.textContent.trim()).join("|"));

/**
 * The plaza bench (parts_props.py `bench`): five seat slats at -0.22..0.22 from its middle (front edge 0.2625), 0.40..0.445 up,
 * and three backrest slats 0.30 m behind the middle at 0.56, 0.68 and 0.80 m up, 0.085 m tall each (3.5 cm gaps).
 */
const BENCH_HALF_DEPTH = 0.2625;
const BACKREST_FROM_MIDDLE = 0.31;
const BACKREST_SLAT_Y = 0.72;
/** A point between the board and the backrest, above the slats: from behind, the ray goes on through the gaps to the floor. */
const GAP_FROM_MIDDLE = 0.09;
const GAP_Y = 0.72;

/** Press the context button itself (a click on a PC, a tap on a phone): what a visitor does after walking to a seat. */
async function pressButton(p) {
  const btn = p.page.locator(".cv-action-btn");
  await btn.waitFor({ state: "visible", timeout: 5000 });
  if (p.touch) await btn.tap();
  else await btn.click();
}

/**
 * Click (tap) on seat `s`: on its board (between its front edge and the backrest, at the seat's height), or — `part:
 * "back"` — on its backrest, which is what a visitor sees of a bench that faces away (the spawn sees the benches' backs), or
 * `"gap"` — between its slats, the floor seen through them.
 *
 * Owner 2026-11-17 ("의자를 찍으면 자동 앉기는 빼줘"): the click walks to the seat's approach and stops there, standing and turned
 * toward the seat, with "앉기" offered (a 48 px button or more); pressing it sits on that very seat.
 */
async function clickSeat(p, s, label, part = "board") {
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const fe = s.frontEdge ?? 0.26;
  const back = part === "back" ? fe + BENCH_HALF_DEPTH + BACKREST_FROM_MIDDLE : part === "gap" ? fe + BENCH_HALF_DEPTH + GAP_FROM_MIDDLE : fe + 0.12;
  const y = part === "back" ? BACKREST_SLAT_Y : part === "gap" ? GAP_Y : (s.seatY ?? 0.445) + 0.01;
  const what = `${p.touch ? "tap" : "click"} on the ${part === "back" ? "backrest" : part === "gap" ? "bench (between its slats)" : "board"}`;
  await turnCameraTo(p, s.x, s.z);
  await sleep(500);
  let pick = null;
  // a crown overhead (the plaza's zelkovas, the cherries) can hide the bench from this side: turn the view a little and try again
  for (let k = 0; k < 4; k++) {
    const pt = await project(p, s.x - fx * back, y, s.z - fz * back);
    if (!pt.on) return run.check(`${label}: seat on screen to ${p.touch ? "tap" : "click"}`, false, pt);
    await press(p, pt.x, pt.y);
    await sleep(400);
    pick = await p.page.evaluate(() => {
      const c = window.__cvClickPick?.();
      return c && { y: c.pick ? Math.round(c.pick.y * 100) / 100 : null, name: c.pick?.name ?? null, ok: c.plan?.ok ?? null, reason: c.plan?.reason ?? null, sitOn: c.sitOn ?? null };
    });
    if (!(pick && pick.sitOn === null && pick.y !== null && pick.y > 1.3)) break;
    pick.retried = k + 1;
    await p.page.keyboard.down(k % 2 ? "KeyC" : "KeyZ");
    await sleep(260 * (k + 1));
    await p.page.keyboard.up(k % 2 ? "KeyC" : "KeyZ");
    await sleep(400);
  }
  run.check(`${label}: the ${what} is a click on seat ${s.i}`, pick?.sitOn === s.i, pick);
  await waitIdle(p, 20000);
  await sleep(1000);
  const at = await pos(p);
  const want = Math.atan2(s.x - at.x, s.z - at.z);
  const turn = Math.abs(Math.atan2(Math.sin(want - at.yaw), Math.cos(want - at.yaw)));
  const button = await p.page.evaluate(() => {
    const e = document.querySelector(".cv-action-btn");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
  });
  run.check(`${label}: walked to the seat's approach and stands there (no sitting on a ${p.touch ? "tap" : "click"})`, at.seatIndex === -1 && Math.hypot(at.x - s.standX, at.z - s.standZ) < 0.8, { at, stand: [s.standX, s.standZ] });
  run.check(`${label}: turned to face the seat`, turn < 0.35, { turn: Math.round(turn * 100) / 100 });
  run.check(`${label}: 앉기 offered, a button 48 px or more`, !!button && button.text.includes("앉기") && button.h >= 48 && button.w >= 48, button);
  await pressButton(p).catch(() => {});
  const got = await waitSeated(p, 6000);
  return run.check(`${label}: the 앉기 button sits on seat ${s.i}`, got === s.i, { got });
}

const b = await launchBrowser();
const p = await openPlayer(b, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP });
await run.step("join", async () => {
  const j = await joinVillage(p, "벤치");
  run.check("in the village", !!j.nick, j);
});
const seats = await p.page.evaluate(async () =>
  (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.slice(0, 16).map((s, i) => ({ ...s, i })),
);
run.check("seats 0..15 are the plaza's", seats.every((s) => s.bench.startsWith("plaza_")), seats.map((s) => s.bench));

for (const s of seats) {
  if (ONLY && !ONLY.includes(s.i)) continue;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  // the bench's centre and its axis (local x)
  const bench = seats.find((o) => o.bench === s.bench && o.i !== s.i);
  const cx = (s.x + bench.x) / 2;
  const cz = (s.z + bench.z) / 2;
  const along = { x: Math.sign((s.x - cx) * Math.cos(s.yaw) - (s.z - cz) * Math.sin(s.yaw)) * Math.cos(s.yaw), z: -Math.sign((s.x - cx) * Math.cos(s.yaw) - (s.z - cz) * Math.sin(s.yaw)) * Math.sin(s.yaw) };
  await run.step(`seat ${s.i} (${s.id})`, async () => {
    // 1. from the front, a click (tap) on the board
    await goTo(p, s.x + fx * 2.0, s.z + fz * 2.0);
    if (await clickSeat(p, s, "front")) await settledShot(p, `seat${String(s.i).padStart(2, "0")}-front.png`);
    await standUp(p);
    // 2. from the side, beyond the bench's end
    await goTo(p, cx + along.x * 1.9 + fx * 0.2, cz + along.z * 1.9 + fz * 0.2);
    await clickSeat(p, s, "side");
    await standUp(p);
    // 2b. from well behind (the bench faces away, as the spawn sees it), a click (tap) on its backrest
    await goTo(p, cx - fx * 5.5 + along.x * 0.6, cz - fz * 5.5 + along.z * 0.6);
    if (await clickSeat(p, s, "far behind", "back")) await settledShot(p, `seat${String(s.i).padStart(2, "0")}-from-behind.png`);
    await standUp(p);
    // 2c. from behind again, a click (tap) that goes through the gaps between the slats to the floor under the bench
    await goTo(p, cx - fx * 5.5, cz - fz * 5.5);
    await clickSeat(p, s, "far behind", "gap");
    await standUp(p);
    // 3. at its approach spot, E (PC) / the round button (phone)
    await goTo(p, s.standX, s.standZ);
    await sleep(700);
    const label = await actionText(p);
    run.check("front: the button offers 앉기", label.includes("앉기"), label);
    await act(p).catch(() => {});
    const got = await waitSeated(p, 6000);
    run.check(`front: ${p.touch ? "the button" : "E"} sits on seat ${s.i}`, got === s.i, { got, at: await pos(p) });
    await standUp(p);
    // 4. behind the backrest: nothing offered, and a forced Sit is refused by the server
    await goTo(p, cx - fx * 1.25, cz - fz * 1.25);
    await sleep(700);
    const behind = await actionText(p);
    run.check("behind: no 앉기", !behind.includes("앉기"), { behind, at: await pos(p) });
    await p.page.evaluate((i) => window.__cv.sit(i), s.i);
    await sleep(1200);
    run.check("behind: a forced Sit is refused", (await seatIndex(p)) === -1);
    await standUp(p);
  });
}

await b.close();
process.exit(run.finish({ client: CLIENT_URL, phone }));
