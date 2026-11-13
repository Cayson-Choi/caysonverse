/**
 * e2e/arrival-spread.mjs — 두 사람이 같은 순간 추모관에 들어가고, 같은 순간 나올 때 처음부터 겹쳐 서 있지 않은지
 * (fix/arrival-spread, 주인 요청: "추모관에 두명의 캐릭터가 동시에 들어갈경우 처음에 겹쳐져있는 상태가 발생").
 *
 * Two players (two tabs of ONE browser) walk onto the memorial's outside door pad side by side and press E in the same
 * second; once both are inside, each tab's own pose and its view of the other (`__cv.getRemotes`, the newest snapshot,
 * and `__cv.getRemoteDrawn`, where the avatar is drawn) must be at least the arrival spacing apart (2 x PLAYER_RADIUS
 * + 0.3 m = 1.1 m, shared/src/village/arrivalSpot.ts). Then both walk onto the inside pad and press E together, and
 * the same holds outside. Neither arrival may stand on a door pad. A screenshot from each tab after each door.
 *
 *   PORT=2801 npx tsx src/index.ts                                         (in server/)
 *   VITE_SERVER_URL=http://localhost:2801 npx vite --port 5401 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5401 node e2e/arrival-spread.mjs --out=<folder> [--label=after]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DESKTOP, createRun, launchBrowser, openPlayer, pos, sleep, walkAndWait } from "./lib/escape.mjs";
import { DOOR_ROUTE, act, areaOf, joinVillage, setOrbit } from "./lib/village.mjs";

const arg = (name, dflt) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? dflt;
const LABEL = arg("label", "run");
const run = createRun(`arrival-spread-${LABEL}`);
run.evidence = arg("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });

/** shared/src/village/arrivalSpot.ts ARRIVAL_SPACING_M: 2 x PLAYER_RADIUS (0.4) + 0.3 m. */
const SPACING_M = 1.1;
/** Two bodies of PLAYER_RADIUS overlap below this centre distance. */
const BODY_M = 0.8;
const OUT_PAD = { x: 0, z: -51.6, r: 2.0 };
const IN_PAD = { x: 300, z: 5.2, r: 1.4 };
const r3 = (n) => Math.round(n * 1000) / 1000;
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const epoch = (p) => p.page.evaluate(() => performance.timeOrigin + performance.now());

const doorOffered = (p, label) =>
  p.page
    .waitForFunction(
      async (label) => {
        const m = await window.__imp("/src/game/interactTargets.ts");
        return m.getTargets(window.__cv.getPos()).some((t) => t.kind === "door" && t.label === label);
      },
      label,
      { timeout: 8000, polling: 200 },
    )
    .then(
      () => true,
      () => false,
    );

/** Both tabs' own pose and their view of the other: the newest snapshot and where the avatar is drawn. */
async function sample(A, B, sidA, sidB) {
  const view = (p, other) =>
    p.page.evaluate((sid) => {
      const self = window.__cv.getPos();
      const remote = window.__cv.getRemotes().find((r) => r.sessionId === sid) ?? null;
      const drawn = window.__cv.getRemoteDrawn()[sid] ?? null;
      return {
        self: { x: self.x, z: self.z, yaw: self.yaw },
        remote: remote ? { x: remote.x, z: remote.z, yaw: remote.yaw } : null,
        drawn: drawn ? { x: drawn.x, z: drawn.z } : null,
      };
    }, other);
  const a = await view(A, sidB);
  const b = await view(B, sidA);
  return {
    a,
    b,
    selfPair: r3(dist(a.self, b.self)),
    seenByA: a.remote ? r3(dist(a.self, a.remote)) : null,
    seenByB: b.remote ? r3(dist(b.self, b.remote)) : null,
    drawnByA: a.drawn ? r3(dist(a.self, a.drawn)) : null,
    drawnByB: b.drawn ? r3(dist(b.self, b.drawn)) : null,
  };
}

function judge(name, s, pad) {
  const all = [s.selfPair, s.seenByA, s.seenByB, s.drawnByA, s.drawnByB];
  run.check(`${name}: each tab sees the other (snapshot and drawn avatar)`, all.every((d) => d !== null), s);
  run.check(`${name}: the two own poses are >= ${SPACING_M} m apart`, s.selfPair >= SPACING_M - 1e-3, s.selfPair);
  run.check(`${name}: A sees B >= ${SPACING_M} m away (snapshot), B sees A >= ${SPACING_M} m away`, s.seenByA >= SPACING_M - 1e-3 && s.seenByB >= SPACING_M - 1e-3, { seenByA: s.seenByA, seenByB: s.seenByB });
  run.check(`${name}: the drawn avatars do not overlap (>= ${BODY_M} m) on either screen`, s.drawnByA >= BODY_M && s.drawnByB >= BODY_M, { drawnByA: s.drawnByA, drawnByB: s.drawnByB });
  const onPad = [s.a.self, s.b.self].map((p) => r3(Math.hypot(p.x - pad.x, p.z - pad.z)));
  run.check(`${name}: neither stands on the door pad (centre farther than its ${pad.r} m radius)`, onPad.every((d) => d > pad.r), onPad);
}

const browser = await launchBrowser();
const summary = { label: LABEL };
try {
  const A = await openPlayer(browser, run, { tag: "A", device: DESKTOP, settings: { graphics: "low" } });
  const B = await openPlayer(browser, run, { tag: "B", device: DESKTOP, settings: { graphics: "low" } });
  let sidA = "";
  let sidB = "";

  await run.step("1. two players in the village walk onto the memorial's door pad, side by side", async () => {
    await joinVillage(A, "들A");
    await joinVillage(B, "들B");
    sidA = await A.page.evaluate(() => window.__cv.getSessionId());
    sidB = await B.page.evaluate(() => window.__cv.getSessionId());
    const route = DOOR_ROUTE.slice(0, -1);
    await Promise.all([
      (async () => {
        for (const [x, z] of route) await walkAndWait(A, x - 0.8, z, 40000, 1.2);
        await walkAndWait(A, -0.8, -51.0, 20000, 0.4);
      })(),
      (async () => {
        await sleep(700);
        for (const [x, z] of route) await walkAndWait(B, x + 0.8, z, 40000, 1.2);
        await walkAndWait(B, 0.8, -51.0, 20000, 0.4);
      })(),
    ]);
    summary.padA = await pos(A);
    summary.padB = await pos(B);
    run.check("A is on the outside pad", Math.hypot(summary.padA.x - OUT_PAD.x, summary.padA.z - OUT_PAD.z) <= OUT_PAD.r, summary.padA);
    run.check("B is on the outside pad", Math.hypot(summary.padB.x - OUT_PAD.x, summary.padB.z - OUT_PAD.z) <= OUT_PAD.r, summary.padB);
    run.check("both are offered 추모관 들어가기", (await doorOffered(A, "추모관 들어가기")) && (await doorOffered(B, "추모관 들어가기")));
  });

  await run.step("2. both press E in the same second and go in", async () => {
    const [ta, tb] = await Promise.all([epoch(A).then(async (t) => (await act(A), t)), epoch(B).then(async (t) => (await act(B), t))]);
    summary.enterPressGapMs = Math.round(Math.abs(ta - tb));
    run.check("the two presses are within one second", summary.enterPressGapMs < 1000, summary.enterPressGapMs);
    for (const p of [A, B]) {
      await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "hall", null, { timeout: 15000 });
    }
    await Promise.all([A, B].map((p) => p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 })));
    await sleep(2500);
    run.check("A is in the hall", (await areaOf(A)) === "hall");
    run.check("B is in the hall", (await areaOf(B)) === "hall");
    const s = await sample(A, B, sidA, sidB);
    summary.enter = s;
    judge("inside", s, IN_PAD);
    for (const [p, tag] of [
      [A, "A"],
      [B, "B"],
    ]) {
      await setOrbit(p, 5.5, 0.45);
      await run.shot(p, `${LABEL}-enter-${tag}.png`);
    }
  });

  await run.step("3. both walk onto the inside pad, press E together and come out", async () => {
    await Promise.all([walkAndWait(A, 299.4, 4.7, 15000, 0.4), (async () => (await sleep(400), walkAndWait(B, 300.6, 4.7, 15000, 0.4)))()]);
    summary.inPadA = await pos(A);
    summary.inPadB = await pos(B);
    run.check("both are offered 밖으로 나가기", (await doorOffered(A, "밖으로 나가기")) && (await doorOffered(B, "밖으로 나가기")), { a: summary.inPadA, b: summary.inPadB });
    const [ta, tb] = await Promise.all([epoch(A).then(async (t) => (await act(A), t)), epoch(B).then(async (t) => (await act(B), t))]);
    summary.exitPressGapMs = Math.round(Math.abs(ta - tb));
    run.check("the two presses are within one second", summary.exitPressGapMs < 1000, summary.exitPressGapMs);
    for (const p of [A, B]) {
      await p.page.waitForFunction(async () => (await window.__imp("/src/village/villageArea.ts")).localArea() === "village", null, { timeout: 15000 });
    }
    await sleep(3000);
    run.check("A is outside", (await areaOf(A)) === "village");
    run.check("B is outside", (await areaOf(B)) === "village");
    const s = await sample(A, B, sidA, sidB);
    summary.exit = s;
    judge("outside", s, OUT_PAD);
    for (const [p, tag] of [
      [A, "A"],
      [B, "B"],
    ]) {
      await setOrbit(p, 6, 0.45);
      await run.shot(p, `${LABEL}-exit-${tag}.png`);
    }
  });

  await A.ctx.close();
  await B.ctx.close();
} finally {
  await browser.close();
}
writeFileSync(join(run.evidence, `arrival-spread-${LABEL}.json`), JSON.stringify(summary, null, 2));
process.exit(run.finish(summary));
