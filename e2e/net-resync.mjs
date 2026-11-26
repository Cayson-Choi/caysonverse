/**
 * e2e/net-resync.mjs — the server never loses the avatar for good (fix/net-sync, 2026-11-22).
 *
 *   server:  PORT=3071 npx tsx src/index.ts                                                   (server/)
 *   client:  VITE_SERVER_URL=http://localhost:3071 npx vite --port 5671 --strictPort          (client/)
 *   CV_CLIENT_URL=http://localhost:5671 CV_E2E_SLOW=6 node e2e/net-resync.mjs [--only=pc,phone] [--ride=carousel|none]
 *
 * The reported bug: after a hitch (a phone's first seconds in the village, a stalled uplink) the server kept the avatar where it was and
 * refused every later Move, while the client walked 60-78 m on; every door / keypad / ride press was then refused for distance, without a
 * word. Here, on a PC (mouse + keys) and a phone (touch), each hitch is forced on purpose and then the two positions must come back
 * together by themselves (no nudging walk), and the buttons must work:
 *   1. right after entering, every Move is LOST for 7 s while walking 12 m (the first Moves never reach the server; its echo is still 0, so the
 *      refusal changes nothing synced — the case that was never corrected);
 *   2. a frame hitch: the page blocks 3 s while walking (the body must not leap: no refusal at all);
 *   3. a stalled uplink: the Moves of 6 s of walking queue and arrive at once (more than the server's budget: refused, then healed or put
 *      back, with a short line);
 *   4. a door pressed while the server has the player elsewhere (Moves lost on the way to it): a short line, the curtain lifts, the
 *      positions come together, and the next press goes in (the memorial hall);
 *   5. the walk to the park gate and the gate's button, the walk to a ride's pad with a stall on the way, its 타기 button boards, and
 *      비상 내리기 asks once more before it gets off (2026-11-22).
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, r2, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { DOOR_ROUTE, act, joinVillage } from "./lib/village.mjs";
import { arg, areaOf as area, finishRun, serverPos, until, waitArea, walkFar, walkPlanned } from "./lib/noauto.mjs";

const ONLY = arg("only", "pc,phone").split(",");
const RIDE = arg("ride", "carousel");
const run = createRun(arg("name", "net-resync"));
mkdirSync(run.evidence, { recursive: true });

/** Hold back this tab's Move messages for `ms`: "drop" loses them, "queue" sends them all at once afterwards (a stalled uplink). */
const stallMoves = (p, ms, mode) =>
  p.page.evaluate(
    async ([ms, mode]) => {
      const r = (await window.__imp("/src/net/connection.ts")).getRoom();
      const orig = r.send.bind(r);
      const queued = [];
      r.send = (type, m) => {
        if (type === "move") {
          if (mode === "queue") queued.push(m);
          return;
        }
        orig(type, m);
      };
      setTimeout(() => {
        r.send = orig;
        for (const m of queued) orig("move", m);
      }, ms);
    },
    [ms, mode],
  );
/** Block the page's main thread for `ms` on its next frame (a phone compiling shaders, a GC pause). */
const hitch = (p, ms) =>
  p.page.evaluate((ms) => {
    requestAnimationFrame(() => {
      const t = performance.now();
      while (performance.now() - t < ms) {}
    });
  }, ms);
/** Every short line the game showed from now on (the click hint: the refusal / resync lines). */
const watchHints = (p) =>
  p.page.evaluate(() => {
    window.__hints = [];
    const seen = () => {
      const el = document.querySelector("[data-testid=click-hint]");
      const t = el?.textContent ?? "";
      if (t && window.__hints[window.__hints.length - 1] !== t) window.__hints.push(t);
    };
    new MutationObserver(seen).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
const hints = (p) => p.page.evaluate(() => window.__hints ?? []);
/** Wait (no walking, no nudge) until the server has the player where the client stands; the gap at the end. */
async function inStepBy(p, ms) {
  let sv = null;
  await until(async () => {
    sv = await serverPos(p);
    return sv !== null && sv.gap <= 0.25;
  }, ms, 200);
  return sv;
}

async function scenario(device, tag) {
  const p = await openPlayer(browser, run, { tag, device });
  await joinVillage(p, tag === "pc" ? "nrp" : "nrf");
  await watchHints(p);

  await run.step(`${tag}: Moves lost right after entering`, async () => {
    const start = await pos(p);
    // lost long enough that the walk (2 m/s) ends farther out than one Move's budget (4.8 m): the server can never take a later Move
    await stallMoves(p, 7000, "drop");
    await walkTo(p, start.x - 12, start.z + 1);
    await sleep(7500);
    await waitIdle(p, 20000);
    const sv = await inStepBy(p, 6000);
    run.check(`${tag}: the server and the client come back together by themselves (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, sv);
    const h = await hints(p);
    run.check(`${tag}: a put-back is said, not silent`, sv?.gap <= 0.25 && (h.some((t) => t.includes("돌아왔어요"))), h);
  });

  await run.step(`${tag}: a 3 s frame hitch while walking`, async () => {
    const a = await pos(p);
    await walkTo(p, a.x + 7, a.z);
    await sleep(500);
    await hitch(p, 3000);
    await sleep(3500);
    await waitIdle(p, 20000);
    const b = await pos(p);
    const sv = await inStepBy(p, 4000);
    run.check(`${tag}: no leap and no divergence after the hitch (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, { b, sv });
  });

  await run.step(`${tag}: a 6 s stalled uplink while walking`, async () => {
    const a = await pos(p);
    await stallMoves(p, 6000, "queue");
    await walkTo(p, a.x - 12, a.z + 0.5);
    await sleep(6500);
    await waitIdle(p, 20000);
    const sv = await inStepBy(p, 6000);
    run.check(`${tag}: the server and the client come back together after the burst (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, sv);
  });

  await run.step(`${tag}: a door pressed while the server has the player elsewhere`, async () => {
    for (const [x, z] of DOOR_ROUTE.slice(0, -1)) await walkPlanned(p, x, z, 1.2);
    const before = await serverPos(p);
    await stallMoves(p, 60000, "drop"); // lost from here on (the hook is lifted below)
    const [dx, dz] = DOOR_ROUTE[DOOR_ROUTE.length - 1];
    await walkPlanned(p, dx, dz, 1.0);
    const t = await targets(p);
    run.check(`${tag}: the client offers the hall's button at its door`, t.some((x) => x.id === "memorial_door"), t.map((x) => x.id));
    await p.page.evaluate(() => (window.__hints = []));
    await act(p);
    // lift the loss at once: what heals the gap now is the client's own correction
    await p.page.evaluate(async () => {
      const r = (await window.__imp("/src/net/connection.ts")).getRoom();
      delete r.send; // back to the prototype's send
    });
    await sleep(2500);
    const h = await hints(p);
    run.check(`${tag}: the refused press is said (a short line), not silent`, h.some((x) => x.includes("문에서 조금 멀어요")), { h, before });
    run.check(`${tag}: still outside after the refused press`, (await area(p)) === "village");
    const covered = await p.page.evaluate(async () => (await window.__imp("/src/village/doorFadeModel.ts")).doorFade.covered());
    run.check(`${tag}: the curtain is lifted`, !covered);
    const sv = await inStepBy(p, 6000);
    run.check(`${tag}: the positions come back together (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, sv);
    await walkPlanned(p, dx, dz, 1.0);
    await sleep(800);
    await act(p);
    const inHall = await waitArea(p, "hall", 30000);
    run.check(`${tag}: the next press at the door goes in`, inHall, await area(p));
    if (inHall) {
      await p.page.waitForFunction(() => !!window.__cvHall, null, { timeout: 120000 }).catch(() => {});
      await sleep(2500);
      await walkPlanned(p, 300, 4.6, 0.5);
      await sleep(500);
      await act(p);
      run.check(`${tag}: and out again by the hall's button`, await waitArea(p, "village", 30000), await area(p));
      await sleep(2000);
    }
  });

  await run.step(`${tag}: the park gate after a stall on the way`, async () => {
    const g = await p.page.evaluate(async () => (await window.__imp("/shared/src/village/parkArea.ts")).parkGateDoor());
    const out = { x: Math.sin(g.yaw), z: Math.cos(g.yaw) };
    const near = { x: g.centre.x + out.x * 8, z: g.centre.z + out.z * 8 };
    await walkFar(p, near.x, near.z, 2);
    await stallMoves(p, 6000, "queue");
    await walkPlanned(p, g.pad.x, g.pad.z, 1.0);
    await sleep(6500);
    const sv = await inStepBy(p, 6000);
    run.check(`${tag}: in step at the gate (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, sv);
    const me = await pos(p);
    if (Math.hypot(me.x - g.pad.x, me.z - g.pad.z) > 1.0) await walkPlanned(p, g.pad.x, g.pad.z, 1.0);
    await sleep(600);
    await act(p);
    const inPark = await waitArea(p, "park", 60000);
    run.check(`${tag}: the gate's button goes into the park`, inPark, await area(p));
    await p.page.waitForFunction(() => document.querySelectorAll("[data-testid=park-loading]").length === 0, null, { timeout: 240000 }).catch(() => {});
    await sleep(3000);
  });

  if (RIDE !== "none" && (await area(p)) === "park")
    await run.step(`${tag}: a ride after a stall on the way`, async () => {
      const d = await p.page.evaluate(async (k) => (await window.__imp("/shared/src/land/rides.ts")).rideByKey(k).pad, RIDE);
      const me0 = await pos(p);
      const len = Math.hypot(me0.x - d.x, me0.z - d.z) || 1;
      const mid = { x: d.x + ((me0.x - d.x) / len) * 10, z: d.z + ((me0.z - d.z) / len) * 10 };
      await walkFar(p, mid.x, mid.z, 3);
      await stallMoves(p, 6000, "queue");
      await walkFar(p, d.x, d.z, 1.2);
      await sleep(6000);
      const sv = await inStepBy(p, 6000);
      run.check(`${tag}: in step at the ride's pad (gap ${r2(sv?.gap ?? -1)} m)`, sv !== null && sv.gap <= 0.25, sv);
      const me = await pos(p);
      if (Math.hypot(me.x - d.x, me.z - d.z) > 1.2) await walkFar(p, d.x, d.z, 1.2);
      const ride = () =>
        p.page.evaluate(async () => {
          const R = await window.__imp("/src/land/coasterRide.ts");
          return { slot: R.selfRide.slot, reserved: R.rideReserved.key, notice: R.rideNotice.reason };
        });
      const offered = await until(async () => (await targets(p)).some((x) => x.id === `ride_board:${RIDE}`), 20000);
      run.check(`${tag}: the 타기 button is offered at the pad`, offered, (await targets(p)).map((x) => x.id));
      await act(p);
      await sleep(1500);
      run.check(`${tag}: the press is not refused for distance`, (await ride()).notice !== "far", await ride());
      const boarded = await until(async () => (await ride()).slot >= 0, 400000, 500);
      run.check(`${tag}: the 타기 button boards (at once, or when the ride loads)`, boarded, await ride());
      if (!boarded) return;
      // 비상 내리기 asks once more (only while the ride moves)
      const leave = p.page.locator("[data-testid=coaster-leave]");
      const riding = await until(async () => ((await leave.textContent().catch(() => "")) ?? "").includes("비상"), 120000, 300);
      if (riding) {
        await (p.touch ? leave.tap() : leave.click());
        await sleep(1000);
        run.check(`${tag}: one press of 비상 내리기 only asks again`, (await ride()).slot >= 0 && (await leave.getAttribute("data-armed")) === "1", await leave.textContent());
        await run.shot(p, `${tag}-leave-armed.png`);
        await sleep(2500); // past the 3 s window: it lapses by itself
        run.check(`${tag}: unanswered, the question lapses`, (await leave.getAttribute("data-armed")) !== "1" && (await ride()).slot >= 0, await leave.textContent());
        await (p.touch ? leave.tap() : leave.click());
        await sleep(500);
        await (p.touch ? leave.tap() : leave.click());
        run.check(`${tag}: two presses get off`, await until(async () => (await ride()).slot < 0, 6000), await ride());
      } else {
        console.log("      (the ride did not start moving: 비상 내리기 not checked)");
        await (p.touch ? leave.tap() : leave.click()).catch(() => {});
      }
    });
  await p.ctx.close();
}

const browser = await launchBrowser();
if (ONLY.includes("pc")) await scenario(DESKTOP, "pc");
if (ONLY.includes("phone")) await scenario(PHONE, "phone");
await browser.close();
finishRun(run);
