/**
 * e2e/village-hall-exit.mjs — 추모관 문 회귀 (owner 2026-11-16, 라이브):
 *  1. "추모관 들어오는 입구와 나가는 입구에 보라색 부분을 없애" — 밖의 문 앞과 안의 나가는 문 앞 바닥에 원판·고리(보라색 패드,
 *     9라운드의 옅은 고리)가 하나도 없다. 문은 그대로 쓸 수 있다(E / 동그란 버튼).
 *  2. "추모관 나오기를 했더니 이상한 공간에 들어와서 움직이지도 않아" — 들어가서 한 걸음도 걷지 않고(둘러보기만, 또는 들어가자마자)
 *     나오면, 서버가 마지막으로 받은 Move의 도장이 바깥 문 앞이라 클라이언트가 새 자리(마을 도착점)를 "그 옛 echo"로 여기고
 *     추모관 좌표(x 300)에 남아 마을 쪽 빈 회색 공간에 서 있었다. 이제 문은 서버가 정한 자리를 그대로 받는다
 *     (remoteSync.ts). 마을 도착점에 서 있고, 걸을 수 있다.
 *  3. (9라운드 시각 검토 MAJOR) 라운지 안락의자 0 북쪽(≈293.2, 1.2)에서 북서를 볼 때 뒤의 의자에 막힌 카메라가 머리에서
 *     0.55~0.85 m — 반쯤 비친 머리가 화면을 덮었다: 이제 1 m 안이면 몸을 숨긴다. 궤도 yaw -0.5~-1.1, 피치 0.2~1.0에서 자기 몸이
 *     숨겨졌거나 화면의 25% 미만을 덮는다(의자에 막힌 구도를 실제로 만나는지도 본다).
 * PC(1280x800)와 iPhone 13(375x812, 터치) 둘 다, 차례로(브라우저 하나).
 *
 *   node e2e/village-hall-exit.mjs [--out=<폴더>] [--rounds=3] [--only=exit|lounge]
 */

import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, sleep, turnCameraTo, waitIdle, walkAndWait, walkTo } from "./lib/common.mjs";
import { DOOR_ROUTE, act, areaOf, joinVillage, leaveHall, setOrbit } from "./lib/village.mjs";

const run = createRun("village-hall-exit");
const args = process.argv.slice(2);
const opt = (name, fallback) => (args.find((a) => a.startsWith(`--${name}=`)) ?? `--${name}=${fallback}`).slice(name.length + 3);
run.evidence = opt("out", run.evidence);
mkdirSync(run.evidence, { recursive: true });
const ROUNDS = Number(opt("rounds", "3"));
/** `--only=exit` (the door parts) or `--only=lounge` (the round 9 camera spot); both by default. */
const ONLY = opt("only", "");
const ARRIVAL = { x: 0, z: -49.4 };

/** Every flat disc or ring drawn on the floor within `r` m of (x, z) (CircleGeometry / RingGeometry under 0.3 m): the door pad's kind. */
const floorDiscs = (p, x, z, r) =>
  p.page.evaluate(
    ([x, z, r]) => {
      const { scene } = window.__cvThree();
      const out = [];
      scene.updateMatrixWorld(true);
      scene.traverse((o) => {
        if (!o.isMesh || !o.visible) return;
        const t = o.geometry?.type;
        if (t !== "CircleGeometry" && t !== "RingGeometry") return;
        const w = o.getWorldPosition(o.position.clone());
        if (w.y < 0.3 && Math.hypot(w.x - x, w.z - z) < r)
          out.push({
            type: t,
            x: +w.x.toFixed(2),
            y: +w.y.toFixed(2),
            z: +w.z.toFixed(2),
            colour: o.material?.color?.getHexString?.(),
          });
      });
      return out;
    },
    [x, z, r],
  );

/** The own avatar's share of the screen (its box from a column 0.38 m round the player, 0..1.9 m, clipped to the view); 1 when the camera is inside it. */
const selfCover = (p) =>
  p.page.evaluate(() => {
    const { camera, gl } = window.__cvThree();
    camera.updateMatrixWorld();
    const at = window.__cv.getPos();
    const V3 = camera.position.constructor;
    const xs = [];
    const ys = [];
    let behind = 0;
    for (const y of [0, 0.6, 1.2, 1.9])
      for (let a = 0; a < 8; a++) {
        const v = new V3(at.x + Math.cos(a * 0.785) * 0.38, y, at.z + Math.sin(a * 0.785) * 0.38).project(camera);
        if (v.z > 1 || v.z < -1) {
          behind++;
          continue;
        }
        xs.push(v.x);
        ys.push(v.y);
      }
    if (behind > 0 && xs.length > 0) return 1; // the column straddles the camera: it is all round the lens
    if (xs.length === 0) return 0;
    const cl = (n) => Math.max(-1, Math.min(1, n));
    const w = cl(Math.max(...xs)) - cl(Math.min(...xs));
    const h = cl(Math.max(...ys)) - cl(Math.min(...ys));
    void gl;
    return (w * h) / 4;
  });

async function toDoorOutside(p) {
  const here = await pos(p);
  if (Math.hypot(here.x, here.z + 50.8) > 8) for (const [x, z] of DOOR_ROUTE) await walkAndWait(p, x, z, 40000, 1.2);
  else await walkAndWait(p, 0, -50.8, 15000, 0.8);
}

/** Wait (polled: the area module is reached through an async import) until the local area is `want`; false after `ms`. */
async function inArea(p, want, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await areaOf(p)) === want) return true;
    await sleep(80);
  }
  return false;
}

/** Wait until the way out is offered and the door's curtain is open (polled); false after `ms`. */
async function wayOutOffered(p, ms = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const ok = await p.page.evaluate(async () => {
      const fade = (await window.__imp("/src/village/doorFadeModel.ts")).doorFade;
      const it = await window.__imp("/src/game/interactTargets.ts");
      return !fade.covered() && it.getTargets(window.__cv.getPos()).some((t) => t.id === "memorial_door");
    });
    if (ok) return true;
    await sleep(50);
  }
  return false;
}

/** Click-walk to (x, z) by the game's own click plan (its way round furniture), then wait until the walk ends. */
async function plannedWalk(p, x, z) {
  await p.page.evaluate(
    async ([x, z]) => {
      const cp = await window.__imp("/src/game/clickPlan.ts");
      const am = await window.__imp("/src/game/activeMap.ts");
      const mv = await window.__imp("/src/game/clickMove.ts");
      const map = am.getActiveMap();
      const at = window.__cv.getPos();
      const plan = cp.planClickMove(at.x, at.z, { x, y: 0.01, z, ny: 1 }, map.geometry.obstacles, am.activeBounds(), false, {
        furniture: map.geometry.obstacles,
      });
      if (plan.ok) mv.setClickTarget(plan.x, plan.z, plan.y, plan.via);
    },
    [x, z],
  );
  await sleep(300);
  await waitIdle(p, 20000);
  await sleep(300);
}

/** In through the door (the action at the outside pad); waits for the hall's model when `loaded`. */
async function goIn(p, loaded = true) {
  if ((await areaOf(p)) !== "village") await leaveHall(p).catch(() => {}); // a failed round before: start from the village
  await toDoorOutside(p);
  await act(p);
  const ok = await inArea(p, "hall");
  if (loaded) {
    await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 60000 }).catch(() => {});
    await sleep(1500);
  }
  return ok;
}

/** Back in the village at the arrival spot, and walking. */
async function checkBackOut(p, label) {
  const out = await inArea(p, "village");
  await sleep(1200);
  const at = await pos(p);
  const atArrival = Math.hypot(at.x - ARRIVAL.x, at.z - ARRIVAL.z) < 2.5;
  // the village is drawn (its model's meshes are in the scene) — not an empty sky over a bare floor
  const villageDrawn = await p.page
    .waitForFunction(
      () => {
        let n = 0;
        window.__cvThree().scene.traverse((o) => {
          if (o.isMesh && o.visible) {
            const w = o.getWorldPosition(o.position.clone());
            if (Math.abs(w.x) < 95 && Math.abs(w.z) < 95) n++;
          }
        });
        return n > 50;
      },
      null,
      { timeout: 30000 },
    )
    .then(
      () => true,
      () => false,
    );
  // a short click-walk / tap-walk south, away from the building
  await walkTo(p, at.x + 1.5, at.z + 4);
  await sleep(2500);
  const now = await pos(p);
  const moved = Math.hypot(now.x - at.x, now.z - at.z);
  return run.check(`${label}: back in the village at the arrival spot, the village drawn, and walking`, out && atArrival && villageDrawn && moved > 1, {
    area: await areaOf(p),
    at: { x: +at.x.toFixed(2), z: +at.z.toFixed(2) },
    villageDrawn,
    moved: +moved.toFixed(2),
  });
}

const browser = await launchBrowser();
try {
  for (const [dev, device] of [
    ["pc", DESKTOP],
    ["phone", PHONE],
  ]) {
    const p = await openPlayer(browser, run, { tag: dev, device });
    await run.step(`${dev}: join`, async () => {
      await joinVillage(p, dev === "pc" ? "출구P" : "출구M");
    });

    if (ONLY !== "lounge") {
      await run.step(`${dev}: the entrance — no disc on the floor, the door still opens with the action`, async () => {
        for (const [x, z] of DOOR_ROUTE.slice(0, -1)) await walkAndWait(p, x, z, 40000, 1.2);
        await walkAndWait(p, 0, -46.5, 20000, 0.8);
        await turnCameraTo(p, 0, -56);
        await setOrbit(p, dev === "pc" ? 6 : null, 0.45);
        await sleep(800);
        const discs = await floorDiscs(p, 0, -51.6, 3.5);
        run.check(`${dev}: no disc or ring on the floor at the hall's entrance`, discs.length === 0, discs);
        await run.shot(p, `${dev}-entrance.png`);
        run.check(`${dev}: in through the door`, await goIn(p));
      });

      await run.step(`${dev}: the way out inside — no disc on the floor`, async () => {
        await turnCameraTo(p, 300, 9);
        await setOrbit(p, dev === "pc" ? 6 : null, 0.5);
        await sleep(800);
        const discs = await floorDiscs(p, 300, 5.2, 3);
        run.check(`${dev}: no disc or ring on the floor at the hall's way out`, discs.length === 0, discs);
        await run.shot(p, `${dev}-exit-inside.png`);
        // out from the arrival spot, having only looked round (camera turns, no step)
        await turnCameraTo(p, 300, -6);
        await sleep(500);
        await act(p);
        await checkBackOut(p, `${dev}: out without a step inside`);
        await sleep(600);
        await run.shot(p, `${dev}-back-in-village.png`);
      });

      for (let r = 1; r <= ROUNDS; r++) {
        await run.step(`${dev}: round ${r} — in, look round, out (no step inside)`, async () => {
          if (!(await goIn(p))) throw new Error("not in the hall");
          await turnCameraTo(p, 305, -4);
          await sleep(500);
          await act(p);
          await checkBackOut(p, `${dev} round ${r} (still)`);
        });
        await run.step(`${dev}: round ${r} — in and straight out (the action as soon as it is offered)`, async () => {
          if (!(await goIn(p, false))) throw new Error("not in the hall");
          // one press the moment the way out is offered and the curtain is open (pressing on would, once outside at the arrival
          // spot — within the entrance's reach — take the player straight back in)
          let presses = 0;
          for (let k = 0; k < 3 && (await areaOf(p)) === "hall"; k++) {
            await wayOutOffered(p);
            await act(p).catch(() => {});
            presses++;
            if (await inArea(p, "village", 6000)) break;
          }
          if ((await areaOf(p)) === "hall")
            run.check(
              `${dev} round ${r}: why still inside (debug)`,
              false,
              await p.page.evaluate(async () => {
                const room = (await window.__imp("/src/net/connection.ts")).getRoom();
                const me = room?.state?.players?.get?.(room.sessionId);
                const fade = (await window.__imp("/src/village/doorFadeModel.ts")).doorFade;
                const it = await window.__imp("/src/game/interactTargets.ts");
                return {
                  server: me ? { x: me.x, z: me.z, area: me.area } : null,
                  client: window.__cv.getPos(),
                  covered: fade.covered(),
                  targets: it.getTargets(window.__cv.getPos()).map((t) => t.id),
                };
              }),
            );
          // a press within the door's 1 s cool-down after the way in (doorFadeModel DOOR_COOLDOWN_MS: the server would drop it) is
          // ignored, so the first one may not take
          run.check(`${dev} round ${r}: out within two presses`, presses <= 2, { presses });
          await checkBackOut(p, `${dev} round ${r} (immediate)`);
        });
      }
    }

    if (ONLY !== "exit")
      await run.step(`${dev}: lounge north of armchair 0, looking NW (round 9 MAJOR): the own body never half-covers the view`, async () => {
        if (!(await goIn(p))) throw new Error("not in the hall");
        await walkAndWait(p, 297, 1.4, 15000, 0.6);
        await plannedWalk(p, 292.9, 1.36); // round the lounge's furniture, as a click on that floor would go
        await plannedWalk(p, 292.9, 1.36);
        const at = await pos(p);
        const rows = [];
        // looking north-west toward the letter table (the review's view: forward (-0.46, -0.88)), the camera behind toward the armchair
        if (dev === "pc") await setOrbit(p, 6, 0.35); // the review's zoom (6 m)
        void at;
        // the review's orbit yaw was -0.69 (forward (-0.46, -0.88)); a little either side of it too. The orbit is steered
        // through the view's own glide (viewState.orbitGoal), the way R / a seat turns it; the tilt by a drag.
        for (const deg of [-0.5, -0.69, -0.9, -1.1]) {
          for (const pitch of [0.2, 0.35, 0.6, 1.0]) {
            await p.page.evaluate(async (yaw) => {
              (await window.__imp("/src/game/viewState.ts")).viewState.orbitGoal = { yaw };
            }, deg);
            await sleep(1500);
            await setOrbit(p, null, pitch); // the tilt by a vertical drag, as the player does it
            await sleep(800);
            const m = await p.page.evaluate(() => {
              const { camera } = window.__cvThree();
              camera.updateMatrixWorld();
              const me = window.__cv.getPos();
              const e = camera.matrixWorld.elements;
              return {
                me: [+me.x.toFixed(2), +me.z.toFixed(2)],
                cam: [camera.position.x, camera.position.y, camera.position.z].map((n) => +n.toFixed(2)),
                look: [-e[8], -e[10]].map((n) => +n.toFixed(2)),
                head: Math.hypot(camera.position.x - me.x, camera.position.y - 1.45, camera.position.z - me.z),
                visible: window.__cv.getSelfVisible(),
              };
            });
            const cover = await selfCover(p);
            const row = {
              deg,
              pitch,
              ...m,
              head: +m.head.toFixed(2),
              cover: +cover.toFixed(2),
            };
            rows.push(row);
            run.check(`${dev}: orbit yaw ${deg}, pitch ${pitch}: the own body is hidden or covers < 25% of the view`, !m.visible || cover < 0.25, row);
            if (m.head < 1.6 || pitch === 0.35) await run.shot(p, `${dev}-lounge-yaw${deg}-p${pitch}.png`);
          }
        }
        run.check(
          // owner 2026-11-16 ("건물이나 벽에서는 바뀌도록 하자"): the armchair is furniture and no longer pulls the camera in, so the old
          // blocked view (a camera within 1.2 m of the head) must not happen; only the lounge's walls may shorten the arm
          `${dev}: the armchair no longer pulls the camera in (every camera at least 1.2 m from the head)`,
          rows.every((r) => r.head >= 1.2),
          rows.map((r) => [r.deg, r.pitch, r.head, r.visible]),
        );
        // back out for the next device's clean start
        await walkAndWait(p, 297, 1.4, 15000, 0.6);
        await walkAndWait(p, 300, 4.6, 15000, 0.5);
        await act(p);
        await inArea(p, "village");
      });

    await p.ctx.close();
  }
} finally {
  await browser.close();
}
process.exit(run.finish());
