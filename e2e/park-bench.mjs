/**
 * e2e/park-bench.mjs — 케이슨랜드 벤치 17개, 34자리 모두 앉기 / 일어서기 (2026-11-22: "의자는 모두 앉을 수 있게").
 *
 * 자리마다:
 *   1. 2 m 앞에서 그 자리 판자를 누르기(PC 클릭 / 폰 톡) → 자리 앞까지 걸어가 서고(자동으로 앉지 않음), 48 px 이상 "앉기" 버튼 →
 *      버튼을 누르면 바로 그 자리에 앉음 (옆 사람 B가 그 자리에 앉은 것을 봄: 첫 자리만)
 *   2. 일어서기 → 자리 앞(등받이 뒤가 아님), 어떤 충돌 상자에도 걸리지 않는 곳에 서고, 거기서 다시 걸어 나갈 수 있음
 *   3. 선 자리에서 E(PC) / 동그란 버튼(폰) → 같은 자리에 다시 앉음
 *   4. 등받이 뒤에 서면 "앉기"가 뜨지 않고, 억지로 보낸 Sit도 서버가 받지 않음
 *
 *   CV_CLIENT_URL=http://localhost:5581 node e2e/park-bench.mjs [--phone] [--benches=1,9] [--out=dir]
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { CLIENT_URL, DESKTOP, PHONE, SLOW, createRun, entryReady, launchBrowser, openPlayer, press, sleep, pos, turnCameraTo } from "./lib/common.mjs";
import { act } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const arg = (k, d) => process.argv.find((a) => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? d;
const ONLY = arg("benches", null)?.split(",").map(Number) ?? null;
const OUT = arg("out", "D:/ClaudeCode/tmpshots/vegpath/park-bench");
mkdirSync(OUT, { recursive: true });
const run = createRun(`park-bench-${phone ? "phone" : "pc"}`);

async function until(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(120);
  }
  return false;
}
const idle = (p, ms = 120000) => until(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, ms);
/** The planned walk (the game's own way round the colliders) to a free spot; the final position. */
async function goTo(p, x, z, tol = 0.6) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 8, slack: 60, margin: 60 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(150);
    await idle(p);
    await sleep(100);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
const seatIndex = async (p) => (await pos(p)).seatIndex;
async function waitSeated(p, ms = 8000) {
  await until(async () => (await seatIndex(p)) >= 0, ms);
  return seatIndex(p);
}
async function standUp(p) {
  if ((await seatIndex(p)) < 0) return;
  await act(p).catch(() => {});
  await until(async () => (await seatIndex(p)) < 0, 6000);
  await sleep(900);
}
const button = (p) =>
  p.page.evaluate(() => {
    const e = document.querySelector(".cv-action-btn");
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { text: e.textContent.trim(), w: Math.round(r.width), h: Math.round(r.height) };
  });
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
const blockedAt = (p, x, z) =>
  p.page.evaluate(async ([x, z]) => {
    const C = await window.__imp("/shared/src/collision.ts");
    const P = await window.__imp("/village/parkArea.ts");
    return C.isBlocked(x, z, 0.4, P.parkGeometry.obstacles, 0);
  }, [x, z]);

async function enter(p, nick) {
  await p.page.goto(`${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(`${nick}${Math.floor(Math.random() * 900 + 100)}`);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 * SLOW });
  await p.page.waitForFunction(() => !!window.__cv?.getPos, null, { timeout: 30000 * SLOW });
  await sleep(12000);
  await until(async () => await p.page.evaluate(() => !!window.__cvLots?.()?.ready), 120000 * SLOW);
  await sleep(3000);
  const g = await p.page.evaluate(async () => (await window.__imp("/village/parkArea.ts")).parkGateDoor().pad);
  await goTo(p, g.x, g.z - 0.5, 1.0);
  await act(p);
  const inPark = await until(async () => (await areaOf(p)) === "park", 30000 * SLOW);
  await sleep(12000);
  return inPark;
}

const b = await launchBrowser();
const b2 = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "phone" : "pc", device: phone ? PHONE : DESKTOP, settings: { graphics: phone ? "low" : "high" } });
const B = await openPlayer(b2, run, { tag: "watcher", device: DESKTOP, settings: { graphics: "low" } });
await run.step("join, into the park", async () => {
  run.check("A in the park", await enter(A, "Pb"));
  run.check("B in the park", await enter(B, "Pw"));
  // (a body is solid to other visitors: the watcher steps off the arrival spot, mid-promenade between two rows of benches)
  await goTo(B, 40, -165);
});

const seats = await A.page.evaluate(async () =>
  (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s, i) => ({ ...s, i })).filter((s) => s.area === "park"),
);
run.check("34 park seats, two per bench", seats.length === 34 && new Set(seats.map((s) => s.bench)).size === 17, seats.length);
let watched = false;

for (const s of seats) {
  const n = Number(s.bench.slice("park_bench_".length));
  if (ONLY && !ONLY.includes(n)) continue;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  await run.step(`seat ${s.i} (${s.id})`, async () => {
    // 1. from the front, a click (tap) on the board
    await goTo(A, s.x + fx * 2.0, s.z + fz * 2.0);
    await turnCameraTo(A, s.x, s.z);
    await sleep(500);
    const pt = await project(A, s.x - fx * (s.frontEdge + 0.15), s.seatY + 0.01, s.z - fz * (s.frontEdge + 0.15));
    run.check("front: the board is on the screen", pt.on, pt);
    if (A.touch) await A.page.touchscreen.tap(pt.x, pt.y);
    else await A.page.mouse.click(pt.x, pt.y);
    await sleep(400);
    const pick = await A.page.evaluate(() => {
      const c = window.__cvClickPick?.();
      return c && { ok: c.plan?.ok ?? null, reason: c.plan?.reason ?? null, sitOn: c.sitOn ?? null };
    });
    run.check(`front: the ${A.touch ? "tap" : "click"} on the board is a click on seat ${s.i}`, pick?.sitOn === s.i, pick);
    await idle(A, 20000);
    await sleep(1000);
    const at = await pos(A);
    const want = Math.atan2(s.x - at.x, s.z - at.z);
    const turn = Math.abs(Math.atan2(Math.sin(want - at.yaw), Math.cos(want - at.yaw)));
    run.check("front: walked to the approach and stands there (no sitting on a click)", at.seatIndex === -1 && Math.hypot(at.x - s.standX, at.z - s.standZ) < 0.8, { at, stand: [s.standX, s.standZ] });
    run.check("front: turned to face the seat", turn < 0.35, { turn: Math.round(turn * 100) / 100 });
    const btn = await button(A);
    run.check("front: 앉기 offered, a button 48 px or more", !!btn && btn.text.includes("앉기") && btn.h >= 48 && btn.w >= 48, btn);
    const el = A.page.locator(".cv-action-btn");
    await (A.touch ? el.tap() : el.click()).catch(() => {});
    const got = await waitSeated(A);
    run.check(`front: the 앉기 button sits on seat ${s.i}`, got === s.i, { got });
    await sleep(1800);
    const sat = await pos(A);
    run.check("seated on the spot of the seat, facing away from the backrest", Math.hypot(sat.x - s.x, sat.z - s.z) < 0.05 && Math.abs(Math.atan2(Math.sin(sat.yaw - s.yaw), Math.cos(sat.yaw - s.yaw))) < 0.05, sat);
    if (n === 1 || n === 9 || n === 17) await A.page.screenshot({ path: join(OUT, `${A.tag}-seat${s.i}.png`) });
    if (!watched) {
      watched = true;
      const seen = await until(async () => await B.page.evaluate((i) => (window.__cv.getRemotes?.() ?? []).some((r) => r.seatIndex === i), s.i), 8000);
      run.check("the other visitor sees A seated on that seat", seen);
    }
    // 2. stand up: in front of the seat, clear of every collider, and able to walk on
    await standUp(A);
    const up = await pos(A);
    const ahead = (up.x - s.x) * fx + (up.z - s.z) * fz;
    run.check("stands up in front of the seat, near its stand spot", up.seatIndex === -1 && ahead > 0.05 && Math.hypot(up.x - s.standX, up.z - s.standZ) < 0.9, { up, stand: [s.standX, s.standZ] });
    run.check("the stand spot is clear of every park collider", !(await blockedAt(A, up.x, up.z)), up);
    // 3. at the stand spot: E / the round button sits on the same seat
    await sleep(500);
    const label = await button(A);
    run.check("at the stand spot the button offers 앉기", !!label && label.text.includes("앉기"), label);
    await act(A).catch(() => {});
    const again = await waitSeated(A, 6000);
    run.check(`${A.touch ? "the button" : "E"} sits on seat ${s.i}`, again === s.i, { again });
    await standUp(A);
    const out = await goTo(A, s.standX + fx * 1.5, s.standZ + fz * 1.5);
    run.check("walks away from the stand spot", Math.hypot(out.x - (s.standX + fx * 1.5), out.z - (s.standZ + fz * 1.5)) < 0.6, out);
    // 4. behind the backrest: nothing offered, and a forced Sit is refused by the server
    await goTo(A, s.x - fx * 1.75, s.z - fz * 1.75);
    await sleep(700);
    const behind = await button(A);
    const here = await pos(A);
    run.check("behind the backrest: stands there, no 앉기", (here.x - s.x) * fx + (here.z - s.z) * fz < -1.2 && !(behind?.text ?? "").includes("앉기"), { behind, here });
    await A.page.evaluate((i) => window.__cv.sit(i), s.i);
    await sleep(1200);
    run.check("behind: a forced Sit is refused", (await seatIndex(A)) === -1);
    await standUp(A);
  });
}

await b.close();
await b2.close();
process.exit(run.finish({ client: CLIENT_URL, phone }));
