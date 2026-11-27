/**
 * e2e/no-auto-houses.mjs — a house is entered, left and climbed ONLY on purpose (owner 2026-11-21: "모든 건물… 문제가 없는지 다시 확인해").
 *
 *   CV_CLIENT_URL=http://localhost:5621 CV_E2E_SLOW=6 node e2e/no-auto-houses.mjs [--only=pc,phone] [--houses=1,2,…] [--idle=30000] [--negonly=1] [--name=…]
 *
 * For each of the ten houses, on a PC and a phone. Outside: walking into the front door by the keys, a click-walk at it, clicks on the ground
 * by it and standing at it idle never go in and never open the keypad; the button opens the keypad and the code goes in. Inside, floor 1:
 * the keys into the door, a click-walk at it, clicks on the floor by it and standing at it idle never leave; standing on the stair's pad and
 * clicks on the floor by the stair never climb; the stair's button climbs. Floor 2: standing at the stair and clicks on the floor by it never
 * go down; the button does. Then a tap on the front door itself leaves, back in by the keypad, and the 나가기 button leaves.
 */
import { mkdirSync } from "node:fs";
import { DESKTOP, PHONE, createRun, launchBrowser, openPlayer, pos, press, sleep, targets, waitIdle, walkTo } from "./lib/common.mjs";
import { act, joinVillage } from "./lib/village.mjs";
import { arg, areaOf as area, finishRun, inStep, keysToward, pickInfo, setView, tapDoor, tapWorld, waitArea, walkFar, walkPlanned } from "./lib/noauto.mjs";

const ONLY = arg("only", "pc,phone").split(",");
const HOUSES = arg("houses", "1,2,3,4,5,6,7,8,9,10").split(",").map(Number);
const IDLE_MS = Number(arg("idle", "30000"));
const NEG_ONLY = arg("negonly", "0") === "1";
const run = createRun(arg("name", "no-auto-houses"));
mkdirSync(run.evidence, { recursive: true });

async function coverGone(p) {
  await p.page
    .waitForFunction(() => {
      const c = document.querySelector(".cv-house-cover");
      const f = document.querySelector(".cv-door-fade");
      return (!c || getComputedStyle(c).opacity === "0") && (!f || getComputedStyle(f).opacity === "0");
    }, null, { timeout: 60000 })
    .catch(() => {});
  await sleep(600);
}
const keypadOpen = (p) => p.page.evaluate(() => !!document.querySelector(".cv-keypad"));

async function oneHouse(p, n, tag, data) {
  const L = `${tag} house ${n}`;
  const kp = data.keypads.find((k) => k.buildingId === `house_${n}`);
  const pl = data.places[n];
  const F1 = `house:house_${n}:1`;
  const F2 = `house:house_${n}:2`;
  // outward from the door: from the pad to where a visitor comes out
  const ol = Math.hypot(kp.exit.x - kp.pad.x, kp.exit.z - kp.pad.z) || 1;
  const o = { x: (kp.exit.x - kp.pad.x) / ol, z: (kp.exit.z - kp.pad.z) / ol };
  const outAt = (d, s = 0) => ({ x: kp.pad.x + o.x * d - o.z * s, z: kp.pad.z + o.z * d + o.x * s });
  const stay = (want, verb) => async (what, detail) => {
    await sleep(4000);
    const a = await area(p);
    const pad = await keypadOpen(p);
    run.check(`${L}: ${what} does NOT ${verb}`, a === want && !pad, detail ? { area: a, keypad: pad, pick: detail } : { area: a, keypad: pad });
    if (pad) await p.page.keyboard.press("Escape").catch(() => {});
  };
  /** In by the keypad: the button opens it, the code is typed (each digit seen in the dots before the next), 확인. Twice at most. */
  const enter = async () => {
    let ok = false;
    for (let attempt = 0; attempt < 2 && !ok; attempt++) {
      await walkPlanned(p, kp.pad.x, kp.pad.z, 0.9);
      await sleep(600);
      await inStep(p, "before the keypad");
      if (!(await keypadOpen(p))) await act(p);
      await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 15000 });
      const dots = () => p.page.evaluate(() => Number(document.querySelector(".cv-keypad-dots")?.getAttribute("data-length") ?? -1));
      for (let k = 0; k < 4; k++) {
        for (let t = 0; t < 4 && (await dots()) <= k; t++) {
          await press(p, p.page.locator(`.cv-keypad button[data-key="${"1004"[k]}"]`));
          await sleep(250);
        }
      }
      const okBtn = p.page.locator(`.cv-keypad button[data-key="ok"]`);
      if (!(await okBtn.isEnabled().catch(() => false))) {
        // (what the pad shows when 확인 is not offered: the digits typed, a lock-out or a request still out)
        const st = await p.page.evaluate(() => ({ dots: document.querySelector(".cv-keypad-dots")?.getAttribute("data-length"), msg: document.querySelector(".cv-keypad-result")?.textContent ?? null, digitsEnabled: !document.querySelector('.cv-keypad button[data-key="1"]')?.disabled }));
        console.log(`      (확인 is not offered: ${JSON.stringify(st)})`);
      }
      await press(p, okBtn).catch(() => {});
      ok = await waitArea(p, F1, 40000);
      if (!ok) {
        const why = await p.page.evaluate(() => { const r = document.querySelector(".cv-keypad-result"); return r ? `${r.getAttribute("data-reason")} | ${r.textContent}` : "(the keypad is gone)"; });
        console.log(`      (the keypad did not let us in: ${why}; at ${JSON.stringify(await pos(p))})`);
        await p.page.locator(".cv-keypad-close").click({ timeout: 3000 }).catch(() => {});
        await sleep(6000);
      }
    }
    await coverGone(p);
    await sleep(1500);
    return ok;
  };
  const leaveByButton = async () => {
    await walkFar(p, pl.exitPad.x, pl.exitPad.z, 0.6);
    await sleep(500);
    await act(p);
    const ok = await waitArea(p, "village", 30000);
    await coverGone(p);
    await sleep(1500);
    return ok;
  };

  // ── outside ──
  const notIn = stay("village", "go in or open the keypad");
  await walkFar(p, outAt(3).x, outAt(3).z, 1.5);
  const yawKey = await keysToward(p, outAt(-2).x, outAt(-2).z, [kp.exit.yaw + Math.PI, kp.exit.yaw, kp.exit.yaw + Math.PI / 2, kp.exit.yaw - Math.PI / 2], 4000);
  run.check(`${L}: the keys walked at the front door`, yawKey !== null, await pos(p));
  await notIn("walking into the front door by the keys");
  await walkTo(p, outAt(-2).x, outAt(-2).z);
  await waitIdle(p, 15000);
  await notIn("a click-walk straight at the front door");
  const back = outAt(3);
  await walkPlanned(p, back.x, back.z, 1.2);
  await setView(p, yawKey ?? kp.exit.yaw + Math.PI);
  await sleep(2000);
  for (const [name, d, s] of [["the pad", 0, 0], ["the door's foot", -0.9, 0], ["beside the door", -0.6, 1.2], ["1.5 m in front of it", 1.5, 0]]) {
    const q = outAt(d, s);
    if (await tapWorld(p, q.x, 0, q.z)) {
      await notIn(`a ${p.touch ? "tap" : "click"} on the ground ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    }
    const at = await pos(p);
    if (Math.hypot(at.x - back.x, at.z - back.z) > 1.2) await walkPlanned(p, back.x, back.z, 1.2);
  }
  // a tap on the front door itself from outside: the door is the keypad's (the code), never a way in by itself
  if (await tapWorld(p, outAt(-1.2).x, 1.2, outAt(-1.2).z)) {
    await notIn("a tap on the front door from outside (the keypad's code is the way in)", await pickInfo(p));
    await waitIdle(p, 15000);
  }
  await walkPlanned(p, kp.pad.x, kp.pad.z, 0.9);
  await sleep(IDLE_MS);
  await notIn(`standing at the front door ${IDLE_MS / 1000} s`);
  const t0 = await targets(p);
  run.check(`${L}: the keypad button is offered at the door`, t0.some((x) => x.id === `keypad:house_${n}`), t0);
  const cameIn = await enter();
  run.check(`${L}: the button and the code go in`, cameIn, await area(p));
  if (!cameIn) return;

  // ── floor 1 ──
  const notOut = stay(F1, "leave or climb");
  const D = data.door[n]; // the door's middle on its wall, and the way into the room
  const inAt = (d, s = 0) => ({ x: D.x + D.vx * d - D.vz * s, z: D.z + D.vz * d + D.vx * s });
  await sleep(5000);
  run.check(`${L}: 5 s after coming in, still on floor 1`, (await area(p)) === F1, await area(p));
  await walkFar(p, inAt(2.6).x, inAt(2.6).z, 1.0);
  const yawIn = await keysToward(p, D.x, D.z, [pl.exitPad.yaw, pl.exitPad.yaw + Math.PI, pl.exitPad.yaw + Math.PI / 2, pl.exitPad.yaw - Math.PI / 2], 3500);
  run.check(`${L}: inside, the keys walked at the front door`, yawIn !== null, await pos(p));
  await notOut("walking into the front door by the keys");
  await walkTo(p, inAt(-1.5).x, inAt(-1.5).z);
  await waitIdle(p, 15000);
  await notOut("a click-walk straight through the front door");
  const backIn = inAt(2.6);
  await walkFar(p, backIn.x, backIn.z, 1.0);
  await setView(p, yawIn ?? pl.exitPad.yaw);
  await sleep(2000);
  for (const [name, d, s] of [["at the door's very foot", 0.1, 0], ["just inside the door", 0.3, 0.3], ["by the door's edge", 0.2, -0.7], ["on the exit pad", 0.8, 0]]) {
    const q = inAt(d, s);
    if (await tapWorld(p, q.x, 0, q.z)) {
      await notOut(`a ${p.touch ? "tap" : "click"} on the floor ${name}`, await pickInfo(p));
      await waitIdle(p, 15000);
    }
    if ((await area(p)) !== F1) {
      await coverGone(p);
      await enter();
    }
    const at = await pos(p);
    if (Math.hypot(at.x - backIn.x, at.z - backIn.z) > 1.0) await walkFar(p, backIn.x, backIn.z, 1.0);
  }
  await walkFar(p, pl.exitPad.x, pl.exitPad.z, 0.6);
  await sleep(IDLE_MS);
  await notOut(`standing at the front door ${IDLE_MS / 1000} s`);
  if ((await area(p)) !== F1) {
    await coverGone(p);
    await enter();
  }
  const t1 = await targets(p);
  run.check(`${L}: the 나가기 button is offered at the front door`, t1.length > 0 && t1.some((x) => /exit|out|door/i.test(x.id) || /나가기/.test(x.label)), t1);
  // the stair: standing on its pad and clicks on the floor by it never climb
  await walkFar(p, pl.upPad.x, pl.upPad.z, 0.5);
  await sleep(Math.min(IDLE_MS, 12000));
  await notOut(`standing on the stair's pad ${Math.min(IDLE_MS, 12000) / 1000} s`);
  const awayUp = { x: pl.upPad.x + (pl.spawnIn.x - pl.upPad.x) * 0.5, z: pl.upPad.z + (pl.spawnIn.z - pl.upPad.z) * 0.5 };
  await walkFar(p, awayUp.x, awayUp.z, 1.0);
  for (const yaw of [yawIn ?? 0, (yawIn ?? 0) + Math.PI / 2, (yawIn ?? 0) + Math.PI, (yawIn ?? 0) - Math.PI / 2]) {
    await setView(p, yaw);
    await sleep(1500);
    if (await tapWorld(p, pl.upPad.x, 0, pl.upPad.z)) {
      const pk = await pickInfo(p);
      // (from some sides the stair itself stands in front of its pad: a tap on its steps walks to the pad, never climbs — owner 2026-11-27;
      // the floor tap is what this checks, so take another view; a stray climb is still undone below)
      if (!pk || pk.y > 0.15 || pk.ny < 0.8) {
        console.log(`      (the tap landed on ${pk ? `${pk.name} y ${pk.y}` : "nothing"}, not the floor: next view)`);
        await sleep(3500);
        await waitIdle(p, 15000);
        if ((await area(p)) === F2) {
          await coverGone(p);
          await walkFar(p, pl.downPad.x, pl.downPad.z, 0.5);
          await act(p);
          await waitArea(p, F1, 20000);
          await coverGone(p);
        }
        await walkFar(p, awayUp.x, awayUp.z, 1.0);
        continue;
      }
      await notOut(`a ${p.touch ? "tap" : "click"} on the floor of the stair's pad`, pk);
      await waitIdle(p, 15000);
      break;
    }
  }
  if (NEG_ONLY) {
    if ((await area(p)) !== F1) return;
    run.check(`${L}: the 나가기 button leaves`, await leaveByButton(), await area(p));
    return;
  }
  await walkFar(p, pl.upPad.x, pl.upPad.z, 0.5);
  await sleep(500);
  const tUp = await targets(p);
  run.check(`${L}: the stair's button is offered on its pad`, tUp.some((x) => /stair/i.test(x.id)), tUp);
  await act(p);
  const up = await waitArea(p, F2, 30000);
  run.check(`${L}: the stair's button climbs`, up, await area(p));
  await coverGone(p);
  // ── floor 2 ──
  if (up) {
    const stay2 = stay(F2, "go down");
    await sleep(5000);
    await stay2("arriving upstairs and standing 9 s");
    await walkFar(p, pl.downPad.x, pl.downPad.z, 0.5);
    await sleep(Math.min(IDLE_MS, 12000));
    await stay2(`standing on the stair's pad upstairs ${Math.min(IDLE_MS, 12000) / 1000} s`);
    await walkFar(p, pl.spawnUp.x, pl.spawnUp.z, 0.8);
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await setView(p, yaw);
      await sleep(1500);
      if (await tapWorld(p, pl.downPad.x, 0, pl.downPad.z)) {
        const pk = await pickInfo(p);
        if (!pk || pk.y > 0.15 || pk.y < -0.15 || pk.ny < 0.8) {
          console.log(`      (the tap landed on ${pk ? `${pk.name} y ${pk.y}` : "nothing"}, not the floor: next view)`);
          await sleep(3500);
          await waitIdle(p, 15000);
          if ((await area(p)) === F1) {
            await coverGone(p);
            await walkFar(p, pl.upPad.x, pl.upPad.z, 0.5);
            await act(p);
            await waitArea(p, F2, 20000);
            await coverGone(p);
          }
          await walkFar(p, pl.spawnUp.x, pl.spawnUp.z, 0.8);
          continue;
        }
        await stay2(`a ${p.touch ? "tap" : "click"} on the floor of the stair's pad upstairs`, pk);
        await waitIdle(p, 15000);
        break;
      }
    }
    if ((await area(p)) === F2) {
      await walkFar(p, pl.downPad.x, pl.downPad.z, 0.5);
      await sleep(500);
      await act(p);
      run.check(`${L}: the stair's button goes down`, await waitArea(p, F1, 30000), await area(p));
      await coverGone(p);
    }
  }
  // a tap on the front door itself leaves
  let leftBy = { ok: false, tries: [] };
  for (const d of [2.4, 3.4]) {
    await walkFar(p, inAt(d).x, inAt(d).z, 0.9);
    leftBy = await tapDoor(p, [1.4, 0.8].map((y) => ({ x: D.x, y, z: D.z })), yawIn ?? pl.exitPad.yaw, () => waitArea(p, "village", 20000));
    if (leftBy.ok) break;
  }
  run.check(`${L}: a tap on the front door leaves`, leftBy.ok, leftBy.tries);
  if (leftBy.ok) {
    await coverGone(p);
    await sleep(1500);
    run.check(`${L}: back in by the keypad`, await enter(), await area(p));
  }
  run.check(`${L}: the 나가기 button leaves`, await leaveByButton(), await area(p));
}

async function profile(tag, device) {
  const browser = await launchBrowser();
  try {
    const p = await openPlayer(browser, run, { tag, device, settings: { graphics: tag === "phone" ? "low" : "high" } });
    await joinVillage(p, `nh${tag[0]}`, "2026-11-21T12:30");
    await sleep(3000);
    const data = await p.page.evaluate(async (houses) => {
      const A = await window.__imp("/shared/src/village/houseAreas.ts");
      const B = await window.__imp("/shared/src/village/buildingAccess.ts");
      const door = {};
      for (const n of houses) {
        const a = A.localToWorld(n, 1, 5.3, 0);
        const b = A.localToWorld(n, 1, 5.3, 1);
        door[n] = { x: a.x, z: a.z, vx: b.x - a.x, vz: b.z - a.z };
      }
      return { keypads: B.keypadEntries(), places: JSON.parse(JSON.stringify(A.HOUSE_PLACES)), door };
    }, HOUSES);
    for (const n of HOUSES) {
      await run.step(`${tag}: house ${n}`, async () => {
        if ((await area(p)) !== "village") {
          // a failed step left us inside: out by the button
          const inN = Number(/house_(\d+)/.exec(await area(p))?.[1] ?? n);
          if (/:2$/.test(await area(p))) {
            await walkFar(p, data.places[inN].downPad.x, data.places[inN].downPad.z, 0.5);
            await act(p);
            await sleep(4000);
          }
          const pl = data.places[inN];
          await walkFar(p, pl.exitPad.x, pl.exitPad.z, 0.6);
          await act(p);
          await waitArea(p, "village", 20000);
          await coverGone(p);
        }
        await oneHouse(p, n, tag, data);
      });
    }
  } finally {
    await browser.close();
  }
}

try {
  if (ONLY.includes("pc")) await profile("pc", DESKTOP);
  if (ONLY.includes("phone")) await profile("phone", PHONE);
} finally {
  finishRun(run);
}
