/**
 * e2e/seat-front.mjs — 등받이 있는 자리는 앞에서 앉고, 일어나면 앞에 선다 (발주자 2026-11-17: "식탁이나 의자가 너무 붙어서 앉고 일어날
 * 의자 뒤로 갑자기 일어서고 이런 건 없어야 해 실제처럼 의자 앞에 가서 앉고 일어서면 의자 앞에 서고 이래야 돼 등받이 있는 의자의 경우에는").
 *
 * A on a PC (or a phone with --phone), B on a PC:
 *   1. the plaza bench: A walks to its front, 앉기 (E / the button), 일어서기 → A stands on its stand point, in front of it;
 *   2. the same bench with B standing on that stand point: A gets up beside B (front-left / front-right / further forward), in front
 *      of the bench, a body clear of B — never behind the backrest;
 *   3. house 1 (in by the keypad): the sofa and a dining chair, sat on from their approach and stood up from — never behind the
 *      backrest (a dining chair, whose front is its table, beside it).
 * (The bus seats: e2e/village-bus-cabin.mjs; every seat of the game: shared/src/village/standSpot.test.ts.)
 *
 *   CV_CLIENT_URL=http://localhost:<port> node e2e/seat-front.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, press, sleep, walkAndWait } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";

const phone = process.argv.includes("--phone");
const outArg = process.argv.find((a) => a.startsWith("--out="));
const run = createRun(phone ? "seat-front-phone" : "seat-front-desktop");
if (outArg) run.evidence = outArg.slice("--out=".length);
mkdirSync(run.evidence, { recursive: true });

const DOOR = [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]];
const BODY_APART = 0.75;

const b = await launchBrowser();
const A = await openPlayer(b, run, { tag: phone ? "A-phone" : "A-pc", device: phone ? PHONE : DESKTOP });
const B = await openPlayer(b, run, { tag: "B-pc", device: DESKTOP });

const seatIndex = async (p) => (await pos(p)).seatIndex;
const areaOf = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function waitFor(fn, ms) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await fn()) return true;
    await sleep(150);
  }
  return false;
}
/** Where (x, z) lies from seat `s`: front / beside / behind (shared standSpot.ts, as the page has it). */
const sideOf = (p, s, x, z) =>
  p.page.evaluate(async ([s, x, z]) => (await window.__imp("/village/standSpot.ts")).standSide(s, x, z), [s, x, z]);

/** Walk to (x, z) the way the game would (its own detour search round the colliders), and wait for the walk to end. */
async function goTo(p, x, z, tol = 0.35) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await p.page.evaluate(
      async ([x, z]) => {
        const plan = await window.__imp("/src/game/clickPlan.ts");
        const move = await window.__imp("/src/game/clickMove.ts");
        const am = await window.__imp("/src/game/activeMap.ts");
        const P = window.__cv.getPos();
        const via = plan.findDetour(P.x, P.z, x, z, am.getActiveMap().geometry.obstacles, am.activeBounds(), undefined, { ratio: 6, slack: 40, margin: 40 });
        move.setClickTarget(x, z, 0, via ?? undefined);
      },
      [x, z],
    );
    await sleep(300);
    await waitFor(async () => (await p.page.evaluate(() => window.__cvClickTarget?.() ?? null)) === null, 40000);
    await sleep(300);
    const at = await pos(p);
    if (Math.hypot(at.x - x, at.z - z) < tol) return at;
  }
  return pos(p);
}

/** Sit on seat `s` from its stand point, stand up; returns where the body ended. */
async function sitAndStand(p, s, tag, other = null) {
  await goTo(p, s.standX, s.standZ);
  await sleep(600);
  await act(p);
  const sat = await waitFor(async () => (await seatIndex(p)) === s.i, 6000);
  run.check(`${tag}: 앉기 from its approach sits on it`, sat, { seat: await seatIndex(p), want: s.i });
  if (!sat) return null;
  await sleep(1800);
  await run.shot(p, `${tag}-1-seated.png`);
  await act(p);
  const up = await waitFor(async () => (await seatIndex(p)) === -1, 6000);
  run.check(`${tag}: 일어서기 stands up`, up);
  // the stand-up clip carries the body off the seat (about a second, longer on a busy machine)
  await waitFor(async () => {
    const q = await pos(p);
    return Math.hypot(q.x - s.x, q.z - s.z) > 0.25;
  }, 5000);
  await sleep(500);
  const at = await pos(p);
  const side = await sideOf(p, s, at.x, at.z);
  const standSide = await sideOf(p, s, s.standX, s.standZ);
  await run.shot(p, `${tag}-2-standing.png`);
  run.check(`${tag}: stood up ${standSide === "front" ? "in front of the seat" : "beside the seat (its front is its table)"}, never behind the backrest`, side !== "behind" && (standSide !== "front" || side === "front"), { at, side, standSide, stand: [s.standX, s.standZ] });
  if (!other) run.check(`${tag}: on its stand point`, Math.hypot(at.x - s.standX, at.z - s.standZ) < 0.25, { at, stand: [s.standX, s.standZ] });
  else run.check(`${tag}: a body clear of the visitor on the stand point`, Math.hypot(at.x - other.x, at.z - other.z) >= BODY_APART - 0.1, { at, other });
  return at;
}

await run.step("join", async () => {
  await joinVillage(A, "앞자리");
  await joinVillage(B, "옆사람");
});
const seats = await A.page.evaluate(async () => (await window.__imp("/village/benchSeats.ts")).VILLAGE_SEATS.map((s, i) => ({ ...s, i })));
const byId = (id) => seats.find((s) => s.id === id);

await run.step("plaza bench: sit from the front, stand up in front", async () => {
  await goTo(B, -6, 13, 1);
  await sitAndStand(A, byId("plaza_4:-0.58"), "plaza");
});

await run.step("plaza bench, someone on its stand point: up beside them, still in front", async () => {
  const s = byId("plaza_4:-0.58");
  await goTo(A, s.standX, s.standZ);
  await sleep(500);
  await act(A);
  const sat = await waitFor(async () => (await seatIndex(A)) === s.i, 6000);
  if (!run.check("A sits", sat)) return;
  await goTo(B, s.standX, s.standZ, 0.3);
  await sleep(800);
  const other = await pos(B);
  // (A's seated body keeps B a little off it: near enough that the stand point is taken — closer than two bodies)
  run.check("B stands on the stand point (closer to it than two bodies)", Math.hypot(other.x - s.standX, other.z - s.standZ) < BODY_APART, other);
  await act(A);
  const up = await waitFor(async () => (await seatIndex(A)) === -1, 6000);
  run.check("A stands up", up);
  await waitFor(async () => {
    const q = await pos(A);
    return Math.hypot(q.x - s.x, q.z - s.z) > 0.25;
  }, 5000);
  await sleep(500);
  const at = await pos(A);
  const side = await sideOf(A, s, at.x, at.z);
  await run.shot(A, "plaza-occupied-standing.png");
  run.check("A stood up in front of the bench, a body clear of B — not behind it", side === "front" && Math.hypot(at.x - other.x, at.z - other.z) >= BODY_APART - 0.1, { at, other, side });
  await goTo(B, -6, 13, 1);
});
// one tab from here (a house floor loads a lot)
await B.ctx.close();

await run.step("house 1 (the keypad)", async () => {
  for (const [x, z] of DOOR) await walkAndWait(A, x, z, 40000, 1.2);
  await act(A);
  await A.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
  for (const c of "1004") await press(A, A.page.locator(`.cv-keypad button[data-key="${c}"]`));
  await press(A, A.page.locator('.cv-keypad button[data-key="ok"]'));
  run.check("in house 1", await waitFor(async () => (await areaOf(A)) === "house:house_1:1", 20000));
  await sleep(3000);
});

for (const [id, tag] of [["h1_1_0", "house-sofa"], ["h1_1_4", "house-dining-chair"], ["h1_1_5", "house-dining-chair-2"]]) {
  await run.step(`house 1: ${tag} (${id})`, async () => {
    const s = byId(id);
    if (!run.check(`${id} exists`, !!s)) return;
    await sitAndStand(A, s, tag);
  });
}

await b.close();
process.exit(run.finish({ client: CLIENT_URL, phone }));
