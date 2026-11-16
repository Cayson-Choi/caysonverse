/**
 * House keypad e2e (집 실내 G, design chapter 8.1): K1 (2 m reach), K2 (wrong numbers), K3 (five wrong: 30 s lock, the right code refused
 * meanwhile), K4 (1004: the cover, the entrance floor, the camera inside), K8 (the way out: porch, the code again), K9 (two players in
 * one house, chat). All ten houses are finished: house 2 shows its keys too.
 *
 *   server:  PORT=3011 npx tsx src/index.ts            (in server/)
 *   client:  VITE_SERVER_URL=http://localhost:3011 npx vite --port 5611 --strictPort   (in client/)
 *   CV_CLIENT_URL=http://localhost:5611 node e2e/village-keypad.mjs [--phone] [--out=<folder>]
 */
import { mkdirSync } from "node:fs";
import { CLIENT_URL, DESKTOP, PHONE, createRun, entryReady, launchBrowser, openPlayer, press, sleep, targets, walkAndWait, pos } from "./lib/common.mjs";

const phoneRun = process.argv.includes("--phone");
const run = createRun(phoneRun ? "village-keypad-phone" : "village-keypad");
const outArg = process.argv.find((a) => a.startsWith("--out="));
run.evidence = outArg ? outArg.slice("--out=".length) : run.evidence;
mkdirSync(run.evidence, { recursive: true });

const device = phoneRun ? PHONE : DESKTOP;
const browser = await launchBrowser();
// house_1 = (21,-42), south-facing: the keypad pad stands on the porch 0.65 m in front of the door (≈ (21,-39.40), keypadEntries())
const WAYPOINTS = [[0, 14], [0, -20], [15, -34], [21, -37.15], [21, -39.3]];
const URL = `${CLIENT_URL}/?time=${encodeURIComponent("2026-11-03T12:30")}`;

async function join(tag, nickname) {
  const p = await openPlayer(browser, run, { tag, device });
  await p.page.goto(URL, { waitUntil: "domcontentloaded" });
  await entryReady(p);
  await p.page.locator("input.cv-input").first().fill(nickname);
  await press(p, p.page.locator(".cv-submit"));
  await p.page.waitForFunction(() => window.__cv?.getScreen?.() === "village", null, { timeout: 40000 });
  return p;
}
const area = (p) => p.page.evaluate(async () => (await window.__imp("/src/village/villageArea.ts")).localArea());
async function toDoor(p) {
  for (const [x, z] of WAYPOINTS) await walkAndWait(p, x, z, 40000, 1.2);
}
const key = (p, k) => press(p, p.page.locator(`.cv-keypad button[data-key="${k}"]`));
async function typeCode(p, code) {
  for (const c of code) await key(p, c);
  await key(p, "ok");
}
const message = (p) => p.page.locator(".cv-keypad-result").first().textContent({ timeout: 1500 }).then((t) => (t ?? "").trim(), () => "");
async function openKeypad(p) {
  if (p.touch) await press(p, p.page.locator(".cv-action-btn").first());
  else await p.page.keyboard.press("KeyE");
  await p.page.locator(".cv-keypad").waitFor({ state: "visible", timeout: 8000 });
}
async function waitInHouse(p, floor = 1, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if ((await area(p)) === `house:house_1:${floor}`) return;
    await sleep(100);
  }
  throw new Error(`never reached house_1 floor ${floor} (now ${await area(p)})`);
}
async function coverGone(p) {
  await p.page.waitForFunction(() => {
    const c = document.querySelector(".cv-house-cover");
    return !c || getComputedStyle(c).opacity === "0";
  }, null, { timeout: 15000 });
  await sleep(500);
}

const a = await join("alice", "앨리스");
try {
  await run.step("K1 — the keypad is offered within 2 m of the door only", async () => {
    await walkAndWait(a, 0, 14, 40000, 1.2);
    run.check("far from any house: no keypad target", !(await targets(a)).some((t) => t.id.startsWith("keypad:")));
    for (const [x, z] of WAYPOINTS.slice(1, 3)) await walkAndWait(a, x, z, 40000, 1.2);
    run.check("6 m from the door: no keypad target", !(await targets(a)).some((t) => t.id.startsWith("keypad:")), await pos(a));
    await walkAndWait(a, 21, -37.15, 40000, 1.2);
    await walkAndWait(a, 21, -39.3, 40000, 1.2); // up onto the porch (release 1): the pad is 0.65 m in front of the door
    const t = await targets(a);
    run.check("at the door: the keypad target of house_1", t.some((x) => x.id === "keypad:house_1"), t);
  });

  await run.step("K2 — a wrong number says so and can be tried again", async () => {
    await openKeypad(a);
    run.check("the pad is the 3 x 4 grid (12 keys)", (await a.page.locator(".cv-keypad .cv-keypad-key").count()) === 12);
    const sizes = await a.page.evaluate(() => [...document.querySelectorAll(".cv-keypad-key")].map((e) => Math.round(Math.min(e.getBoundingClientRect().width, e.getBoundingClientRect().height))));
    run.check("every key is at least 56 px", Math.min(...sizes) >= 56, sizes);
    await run.shot(a, "keypad-open.png");
    for (let i = 1; i <= 4; i++) {
      await typeCode(a, "0000");
      await a.page.waitForFunction(() => /번호가 맞지 않아요/.test(document.querySelector(".cv-keypad-result")?.textContent ?? ""), null, { timeout: 5000 }).catch(() => {});
      run.check(`wrong number ${i}: "번호가 맞지 않아요"`, /번호가 맞지 않아요/.test(await message(a)), await message(a));
      if (i === 1) await run.shot(a, "keypad-wrong.png");
      await sleep(350);
    }
  });

  await run.step("K3 — the fifth wrong number locks the pad for 30 s, and even 1004 is refused", async () => {
    await typeCode(a, "0000");
    await a.page.waitForFunction(() => /잠시 뒤 다시 눌러 주세요/.test(document.querySelector(".cv-keypad-result")?.textContent ?? ""), null, { timeout: 6000 }).catch(() => {});
    const m1 = await message(a);
    run.check("locked: the countdown text", /잠시 뒤 다시 눌러 주세요 \((\d+)초\)/.test(m1), m1);
    await run.shot(a, "keypad-locked.png");
    await sleep(2200);
    const m2 = await message(a);
    const s1 = Number(/\((\d+)초\)/.exec(m1)?.[1]);
    const s2 = Number(/\((\d+)초\)/.exec(m2)?.[1]);
    run.check("the countdown goes down", s2 < s1, [m1, m2]);
    run.check("the keys are disabled while locked", (await a.page.locator('.cv-keypad button[data-key="1"]:disabled').count()) === 1);
    // the right code sent straight to the server is refused too
    const reply = await a.page.evaluate(async () => {
      const conn = await window.__imp("/src/net/connection.ts");
      const room = conn.getRoom();
      return await new Promise((resolve) => {
        const off = room.onMessage("KeypadResult", (r) => {
          off();
          resolve(r);
        });
        conn.sendKeypad("house_1", "1004");
        setTimeout(() => resolve(null), 4000);
      });
    });
    run.check("server: 1004 during the lock is refused (locked_out)", reply && reply.ok === false && reply.reason === "locked_out", reply);
    run.check("still in the village", (await area(a)) === "village");
  });

  // K4 and K9 with a second player (own rate state); Alice waits out her 30 s meanwhile.
  const b = await join("bob", "밥이");
  await run.step("K4 — 1004: the cover, the entrance floor, a camera inside the room", async () => {
    await toDoor(b);
    await openKeypad(b);
    const t0 = Date.now();
    await typeCode(b, "1004");
    await waitInHouse(b, 1);
    run.check("area house:house_1:1 within 3 s of the code", Date.now() - t0 < 3000, Date.now() - t0);
    await coverGone(b);
    const p = await pos(b);
    const spawn = { x: 365.3, z: -3.1 };
    run.check("standing at the entrance spot (spawn__h1_in)", Math.hypot(p.x - spawn.x, p.z - spawn.z) < 0.6, p);
    const cam = await b.page.evaluate(() => {
      const t = window.__cvThree?.();
      return t ? { x: t.camera.position.x, y: t.camera.position.y, z: t.camera.position.z } : null;
    });
    run.check("the camera is inside the room (not outside a wall, under the ceiling)", cam && cam.x > 360 && cam.x < 370.6 && cam.z > -7.8 && cam.z < 0 && cam.y < 3.7 && cam.y > 0.3, cam);
    const label = await b.page.evaluate(async () => (await window.__imp("/src/game/activeMap.ts")).getActiveMap().zoneLabel(0, 0));
    run.check('the HUD place name is "1번 집 · 1층"', label === "1번 집 · 1층", label);
    await run.shot(b, "entered-house-1.png");
  });

  await run.step("K9 — two in one house arrive apart and hear each other", async () => {
    await sleep(31000); // Alice's lock has run out
    await a.page.locator(".cv-keypad-close").click().catch(() => {});
    await openKeypad(a);
    await typeCode(a, "1004");
    await waitInHouse(a, 1);
    await coverGone(a);
    run.check("Alice is in too after the lock", (await area(a)) === "house:house_1:1");
    const pa = await pos(a);
    const pb = await pos(b);
    run.check("they arrive apart (≥ 1.4 m)", Math.hypot(pa.x - pb.x, pa.z - pb.z) >= 1.39, [pa, pb]);
    await a.page.evaluate(async () => {
      const conn = await window.__imp("/src/net/connection.ts");
      conn.getRoom().send("chat", { text: "집에서 안녕" });
    });
    await sleep(900);
    const heard = await b.page.evaluate(async () => {
      const store = await window.__imp("/src/stores/chatStore.ts");
      return JSON.stringify(store.useChatStore.getState()).includes("집에서 안녕");
    });
    run.check("same floor: Bob hears Alice", heard);
    await run.shot(b, "two-in-house.png");
  });

  await run.step("K8 — the way out lands on the porch, facing away; the code is asked again", async () => {
    await walkAndWait(b, 365.3, -0.9, 20000, 0.5);
    const tg = await targets(b);
    run.check('the "밖으로 나가기" target is offered on the exit pad', tg.some((t) => t.id === "house_exit"), tg);
    await b.page.keyboard.press("KeyE");
    for (let i = 0; i < 60 && (await area(b)) !== "village"; i++) await sleep(150);
    await sleep(900);
    const p = await pos(b);
    run.check("on the porch of house_1, 0.55 m out from the keypad pad (keypadEntries exit ≈ (21, -38.85))", Math.hypot(p.x - 21, p.z + 38.85) < 0.6, p);
    run.check("no keypad stays open", (await b.page.locator(".cv-keypad").count()) === 0);
    await openKeypad(b);
    const dots = await b.page.locator(".cv-keypad-dots").getAttribute("data-length");
    run.check("the code is asked again (nothing remembered)", dots === "0", dots);
    await run.shot(b, "porch-after-exit.png");
    await b.page.keyboard.press("Escape");
  });

  await run.step("house_2 is finished too: its keypad shows the keys (all ten houses open)", async () => {
    // house_2 is at (-21, -42), south door: the pad on the porch ≈ (-21, -39.4)
    for (const [x, z] of [[0, -20], [-15, -34], [-21, -37.15], [-21, -39.3]]) await walkAndWait(b, x, z, 40000, 1.2);
    const tg = await targets(b);
    run.check("the keypad of house_2 is offered", tg.some((t) => t.id === "keypad:house_2"), tg);
    await openKeypad(b);
    run.check("the 12 keys are shown", (await b.page.locator(".cv-keypad .cv-keypad-key").count()) === 12);
    await run.shot(b, "house-2-keypad.png");
    await b.page.keyboard.press("Escape");
  });
} catch (err) {
  run.check("script ran to the end", false, String(err && err.stack ? err.stack : err));
} finally {
  await browser.close();
}
process.exit(run.finish());
