// AI 학교 탈출 1단계 Task 25 E2E — 휴대폰, 375×812, hasTouch + isMobile. Tabs: T = teacher (desktop), E = student on the phone,
// F = student on a desktop browser, both in one team.
// Everything E does is a tap, a touch drag or a long press of the action button: team and enter by the action button → film,
// flashlight, bag → note 2 close-up (drag to tilt, flip, UV circle) → number wheels by tap → letter wheels and the sort board by tap
// → F closes the tab: E is alone (solo), reads both drawer halves, long-presses the key switch for 3 s (Review Focus 2) → a one-person
// vote escapes → summary card. Between the steps the touch layout rules are checked on every screen E sees.
//
//   TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json ADMIN_CODE=e2e-operator CV_ESCAPE_INTRO_MS=1500 npm run dev
//   node e2e/task-escape-mobile.mjs                 # CV_CLIENT_URL=http://localhost:5173 by default
//
// Layout rules (the controls plan's, over every visible button of the screen): at least 48×48 px, at least 8 px between two
// buttons (a round button counts as its circle), inside the 375×812 viewport.
// Evidence → .superpowers/sdd/evidence/task-escape/mobile/ (*.png, assertions-mobile.json). Exit code 0 = every assertion passed and
// no console/page error beyond the expected ones (see e2e/lib/escape.mjs).

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { decodePng, lumaStats, passes } from "./luma-check.mjs";
import { PAD_A, PAD_B, PHONE, SORT_ANSWER, CABINET, COVER_INDEXES, COVER_WORD } from "./lib/escape.mjs";
import {
  centreOf, closeTeamPanel, cls, createRun, ensureOnRug, esc, gone, inPlay, inspect, joinAsStudent, joinAsTeacher,
  joinTeam, launchBrowser, layoutReport, openPlayer, openTeamPanel, screenOf, sleep, standNear, teacherStart, text,
  touchDown, touchMoveTo, touchUp, touchHold, visibleButtons, vis, waitFlag, walkAndWait, targets,
} from "./lib/escape.mjs";

const run = createRun("mobile");
const { check } = run;
const layouts = [];

const waitFlagAll = async (ps, flag, ms) => (await Promise.all(ps.map((p) => waitFlag(p, flag, ms)))).every(Boolean);
const faces = (p) => p.page.evaluate(() => [...document.querySelectorAll(".cv-wheel-now")].map((e) => e.textContent).join(""));
const cardIndex = (p, label) => p.page.evaluate((l) => [...document.querySelectorAll(".cv-fin-card")].findIndex((e) => e.textContent.includes(l)), label);

/** The touch layout rules on whatever E shows right now. */
async function layoutCheck(E, label) {
  await sleep(500);
  const els = await visibleButtons(E);
  const rep = layoutReport(els, PHONE.viewport);
  layouts.push({ label, ...rep, buttons: els.map((e) => `${e.name} ${Math.round(e.w)}×${Math.round(e.h)}`) });
  check(`layout (${label}): ${rep.count} buttons, every one ≥ 48×48`, rep.small.length === 0 && rep.count > 0, rep.small.length ? rep.small : rep.count);
  check(`layout (${label}): every gap ≥ 8 px`, rep.tight.length === 0, rep.tight);
  check(`layout (${label}): all inside the screen`, rep.outside.length === 0, rep.outside);
}

/** Walk to a thing E can inspect and open its close-up with the action button. */
async function tapThing(E, id) {
  const ok = await standNear(E, id);
  await sleep(500); // the context button follows at ~5 Hz
  await E.page.locator(".cv-action-btn").tap();
  const open = await vis(E, ".cv-insp", 5000);
  await sleep(450);
  return ok && open;
}
async function closeCard(E) {
  if (await E.page.locator(".cv-insp-close").count()) await E.page.locator(".cv-insp-close").tap();
  await gone(E, ".cv-insp", 3000);
  await sleep(250);
}
/** Tap a wheel's ▲ (index 0) or ▼ (index 1) button `n` times. */
async function tapWheel(E, wheel, button, n) {
  for (let k = 0; k < n; k++) {
    await E.page.locator(".cv-wheel").nth(wheel).locator(".cv-wheel-btn").nth(button).tap();
    await sleep(160);
  }
}
const binOf = (E, label) => E.page.evaluate((l) => {
  const card = [...document.querySelectorAll(".cv-sort-card")].find((c) => c.textContent.includes(l));
  return card ? card.closest(".cv-sort-bin")?.dataset.bin ?? "tray" : null;
}, label);

const browser = await launchBrowser();
try {
  const T = await openPlayer(browser, run, { tag: "T" });
  const E = await openPlayer(browser, run, { tag: "E", device: PHONE });
  const F = await openPlayer(browser, run, { tag: "F" });
  let code = "";

  // ───────────────────────────── 1. enter and team by the action button ─────────────────────────────
  let teamName = "";
  await run.step("1. E enters and makes a team with the action button; F joins it", async () => {
    code = await joinAsTeacher(T);
    await joinAsStudent(E, "하늘별", code);
    check("E is a touch device in the hall", (await screenOf(E)) === "hub" && (await E.page.evaluate(() => matchMedia("(pointer: coarse)").matches)));
    await ensureOnRug(E, [-8.5, 5]);
    const label = await text(E.page.locator(".cv-action-btn .cv-action-text"));
    check("E on the rug: the action button says 팀 만들기", label === "팀 만들기", label);
    await run.shot(E, "01a-rug-button.png");
    await layoutCheck(E, "hall, on the rug");
    await openTeamPanel(E);
    await E.page.locator(".cv-hub-make .cv-hub-btn").tap();
    await E.page.locator(".cv-hub-mine").waitFor({ state: "visible", timeout: 5000 });
    teamName = await text(E.page.locator(".cv-hub-mine .cv-hub-team-name"));
    await run.shot(E, "01b-team-made.png");
    await layoutCheck(E, "team panel");
    await closeTeamPanel(E);
    await joinAsStudent(F, "가람", code);
    await joinTeam(F, teamName);
    const te = (await cls(E)).teams.find((t) => t.mine);
    const tf = (await cls(F)).teams.find((t) => t.mine);
    check("E and F are one team of two", !!te && !!tf && te.id === tf.id && te.members.length === 2, { e: te?.id, f: tf?.id });
  });

  // ───────────────────────────── 2. waiting pad, 입장 ─────────────────────────────
  await run.step("2. E reaches the waiting pad first; the action button says 입장; one tap takes both in", async () => {
    await teacherStart(T);
    await E.page.waitForFunction(() => /복도 문이 열렸어요/.test(document.querySelector(".cv-hub-phase")?.textContent ?? ""), null, { timeout: 8000 }).catch(() => {});
    await walkAndWait(E, PAD_A[0], PAD_A[1], 40000, 1.0);
    await walkAndWait(F, PAD_B[0], PAD_B[1], 40000, 1.0);
    await E.page.waitForFunction(() => document.querySelector(".cv-action-btn .cv-action-text")?.textContent === "입장", null, { timeout: 10000 }).catch(() => {});
    const label = await text(E.page.locator(".cv-action-btn .cv-action-text"));
    check("E (first on the pad): the action button says 입장", label === "입장", label);
    await run.shot(E, "02a-pad-button.png");
    await layoutCheck(E, "hall, on the pad");
    await E.page.locator(".cv-action-btn").tap();
    const both = await Promise.all([E, F].map((p) => p.page.waitForFunction(() => window.__cv?.getScreen?.() === "escape", null, { timeout: 8000 }).then(() => true, () => false)));
    check("both are in the classroom", both.every(Boolean), both);
    await Promise.all([inPlay(E), inPlay(F)]);
    await sleep(1500);
    await run.shot(E, "02b-classroom.png");
    await layoutCheck(E, "classroom, playing");
  });

  // ───────────────────────────── 3. close-up on a touch screen ─────────────────────────────
  await run.step("3. film + flashlight + bag; note 2: drag to tilt, flip, UV circle", async () => {
    check("E: the note box opens by the button", await tapThing(E, "note_box"), (await inspect(E))?.objectId);
    await layoutCheck(E, "close-up (note box)");
    await E.page.getByRole("button", { name: "가방에 넣기" }).tap();
    check("film in the team bag", await waitFlagAll([E, F], "picked:uv_film", 6000));
    await gone(E, ".cv-insp", 4000);
    check("E: the flashlight opens", await tapThing(E, "flashlight"), (await inspect(E))?.objectId);
    await E.page.getByRole("button", { name: "가방에 넣기" }).tap();
    check("flashlight in the team bag", await waitFlagAll([E, F], "picked:flashlight", 6000));
    await gone(E, ".cv-insp", 4000);
    await sleep(400);
    await E.page.locator(".cv-esc-bag-btn").tap();
    await sleep(400);
    await run.shot(E, "03a-bag-tray.png");
    await layoutCheck(E, "bag tray open");
    const chips = E.page.locator(".cv-esc-bag-chip");
    await chips.nth(0).tap();
    await chips.nth(1).tap();
    check("the two parts become the UV light (E and F)", await waitFlagAll([E, F], "made:uv_flashlight", 6000));
    await E.page.locator(".cv-esc-bag-btn").tap();
    await sleep(300);

    check("E: note 2 opens", await tapThing(E, "note_2"), (await inspect(E))?.objectId);
    const tilt = await centreOf(E, ".cv-insp-tilt");
    // 1) drag to tilt
    await touchDown(E, tilt.x, tilt.y);
    await touchMoveTo(E, tilt.x + 60, tilt.y - 10);
    await touchMoveTo(E, tilt.x + 150, tilt.y - 20);
    await sleep(150);
    const during = await E.page.locator(".cv-insp-tilt").evaluate((e) => e.style.transform);
    const ry = Number((during.match(/rotateY\((-?[\d.]+)deg\)/) ?? [])[1]);
    await run.shot(E, "03b-tilted.png");
    await touchUp(E);
    await sleep(500);
    const after = await E.page.locator(".cv-insp-tilt").evaluate((e) => e.style.transform);
    check("a finger drag tips the card (|rotateY| > 10°)", Math.abs(ry) > 10, during);
    check("lifting the finger eases the card back flat", after === "rotateX(0deg) rotateY(0deg)", after);
    // 2) flip
    await E.page.getByRole("button", { name: "뒤집기" }).tap();
    await sleep(700);
    const flipped = await E.page.locator(".cv-insp-flip").getAttribute("style");
    check("flip: the card turns 180° and the back says 2번", (flipped ?? "").includes("rotateY(180deg)") && (await text(E.page.locator(".cv-insp-face.is-back .cv-insp-body"))).includes("2번"), flipped);
    await E.page.getByRole("button", { name: "뒤집기" }).tap();
    await sleep(700);
    // 3) UV circle follows the finger
    await E.page.getByRole("button", { name: "자외선 비추기" }).tap();
    await sleep(500);
    const centreAt = async () => {
      const m = await E.page.locator(".cv-insp-uvtext").evaluate((e) => e.style.maskImage || e.style.webkitMaskImage || "");
      const g = m.match(/at (-?[\d.]+)px (-?[\d.]+)px/);
      return g ? [Number(g[1]), Number(g[2])] : null;
    };
    const box = (await centreOf(E, ".cv-insp-tilt")).box;
    await touchDown(E, box.x + box.width * 0.3, box.y + box.height * 0.4);
    await sleep(200);
    const c1 = await centreAt();
    await touchMoveTo(E, box.x + box.width * 0.7, box.y + box.height * 0.65);
    await sleep(250);
    const c2 = await centreAt();
    const shown = await text(E.page.locator(".cv-insp-uvtext p"));
    await run.shot(E, "03c-uv-circle.png");
    await touchUp(E);
    check("UV on: the circle follows the finger (the mask centre moved)", !!c1 && !!c2 && Math.hypot(c2[0] - c1[0], c2[1] - c1[1]) > 40, { c1, c2 });
    check("UV on: the hidden digit shows", shown === `숨은 숫자 ${CABINET[0]}`, shown);
    await layoutCheck(E, "close-up with UV");
    await closeCard(E);
  });

  // ───────────────────────────── 4. number wheels by tap ─────────────────────────────
  await run.step("4. cabinet: the four number wheels by tap", async () => {
    check("E: the cabinet's number lock opens", (await tapThing(E, "cabinet")) && (await vis(E, ".cv-lock.is-digits", 5000)));
    await sleep(400);
    for (let i = 0; i < 4; i++) {
      const d = Number(CABINET[i]);
      if (d <= 5) await tapWheel(E, i, 0, d);
      else await tapWheel(E, i, 1, 10 - d);
    }
    check(`the wheels show ${CABINET}`, (await faces(E)) === CABINET, await faces(E));
    const fSees = await F.page.waitForFunction((v) => window.__cv?.getEscape?.()?.lockInput.cabinet_lock === v, CABINET, { timeout: 5000 }).then(() => true, () => false);
    check("the shared input reached F's screen state", fSees, (await esc(F)).lockInput.cabinet_lock);
    await run.shot(E, "04-digits.png");
    await layoutCheck(E, "number lock");
    await sleep(1800);
    await E.page.locator(".cv-lock-open").tap();
    check("solved:cabinet_lock on both", await waitFlagAll([E, F], "solved:cabinet_lock", 8000));
    await sleep(900);
    await E.page.getByRole("button", { name: "가방에 넣기" }).tap();
    check("the sort cards are in the bag", await waitFlagAll([E, F], "picked:sort_cards", 6000));
    await gone(E, ".cv-insp", 4000);
  });

  // ───────────────────────────── 5. letter wheels and the sort board by tap ─────────────────────────────
  await run.step("5. cover word by tap, then the sort board: tap a card to change its cell", async () => {
    check("E: the cover's letter lock opens", (await tapThing(E, "sort_board")) && (await vis(E, ".cv-lock.is-letters", 5000)));
    await sleep(400);
    for (let i = 0; i < 4; i++) {
      const idx = COVER_INDEXES[i];
      if (idx <= 4) await tapWheel(E, i, 0, idx);
      else await tapWheel(E, i, 1, 8 - idx);
    }
    check(`the letter wheels spell ${COVER_WORD}`, (await faces(E)) === COVER_WORD, await faces(E));
    await layoutCheck(E, "letter lock");
    await sleep(1800);
    await E.page.locator(".cv-lock-open").tap();
    check("the cover opens: the sort board shows", await vis(E, ".cv-lock.is-sort", 6000));
    await sleep(400);
    const board = (await E.page.evaluate(async () => (await window.__imp("/src/stores/escapeStore.ts")).useEscapeStore.getState().content)).locks.find((l) => l.id === "board_lock");
    let taps = 0;
    for (const card of board.cards) {
      const want = SORT_ANSWER[card.id];
      for (let k = 0; k < 4 && (await binOf(E, card.label)) !== want; k++) {
        await E.page.locator(".cv-sort-card", { hasText: card.label }).first().tap();
        taps++;
        await sleep(200);
      }
    }
    await sleep(900);
    const placed = await Promise.all(board.cards.map(async (c) => (await binOf(E, c.label)) === SORT_ANSWER[c.id]));
    check(`all 8 cards sit in their cells after ${taps} taps (cycle: tray → first cell → second cell → tray)`, placed.every(Boolean) && taps >= 8, { taps, placed });
    check("the team's board on the server matches", Object.entries((await esc(E)).board).every(([k, v]) => SORT_ANSWER[k] === v) && Object.keys((await esc(E)).board).length === 8);
    await run.shot(E, "05-sort-board.png");
    await layoutCheck(E, "sort board");
    await E.page.locator(".cv-lock-open").tap();
    check("safe_unlocked on both", await waitFlagAll([E, F], "safe_unlocked", 8000));
    await closeCard(E);
  });

  // ───────────────────────────── 6. F closes the tab: solo, both halves, the long press ─────────────────────────────
  await run.step("6. F closes the tab: E is solo, reads both drawer halves, holds the key switch for 3 s", async () => {
    check("before F leaves: the key is a two-person press", (await esc(E)).solo === false);
    await F.ctx.close();
    check("E sees solo", await E.page.waitForFunction(() => window.__cv?.getEscape?.()?.solo === true, null, { timeout: 10000 }).then(() => true, () => false));
    await run.shot(E, "06a-solo.png");
    const halves = [];
    for (const id of ["drawer_left", "drawer_right"]) {
      check(`E: ${id} opens`, await tapThing(E, id), (await inspect(E))?.objectId);
      halves.push((await inspect(E))?.split);
      if (id === "drawer_right") await run.shot(E, "06b-drawer-right.png");
      await closeCard(E);
    }
    check("E reads BOTH halves: '동 ○ 먼 ○' and '○ 의 ○ 저', no 'only X can read' notice", halves[0]?.text === "동 ○ 먼 ○" && halves[1]?.text === "○ 의 ○ 저" && !halves[0]?.lockedText && !halves[1]?.lockedText, halves);

    check("E stands at the west key", await standNear(E, "safe_key_left"));
    await sleep(600);
    const ts = await targets(E);
    const key = ts.find((t) => t.id === "safe_key_left");
    check("the key target is now a hold: '3초 길게 누르기'", key?.hold === true && key.label === "3초 길게 누르기", key);
    const label = await text(E.page.locator(".cv-action-btn .cv-action-text"));
    const isHold = await E.page.locator(".cv-action-btn.is-hold").count();
    check("the action button is the hold button (short touch label '길게', ring style)", label === "길게" && isHold === 1, { label, isHold });
    await layoutCheck(E, "hold button");
    const b = await centreOf(E, ".cv-action-btn");
    let ring = null;
    await touchHold(E, b.x, b.y, 3400, async () => {
      ring = await E.page.evaluate(() => {
        const arc = document.querySelector(".cv-hold-arc");
        return arc ? { off: Number(arc.getAttribute("stroke-dashoffset")), total: Number(arc.getAttribute("stroke-dasharray")) } : null;
      });
      await run.shot(E, "06c-hold-ring.png");
    });
    check("while the button is held the ring fills (about half at 1.7 s)", !!ring && ring.off < ring.total * 0.8 && ring.off > ring.total * 0.1, ring);
    check("3 s of holding opens the safe (safe_open)", await waitFlag(E, "safe_open", 5000), (await esc(E)).flags);
    await sleep(1000);
    await run.shot(E, "06d-safe-open.png");
  });

  // ───────────────────────────── 7. a one-person vote escapes ─────────────────────────────
  await run.step("7. the last door: a one-person vote decides at once, twice", async () => {
    check("the last-door panel opens", await vis(E, ".cv-fin", 40000));
    await sleep(700);
    await run.shot(E, "07a-finale.png");
    await layoutCheck(E, "last-door panel");
    const p1 = await cardIndex(E, "프라이버시 보호");
    await E.page.locator(".cv-fin-card").nth(p1).tap();
    check("one vote chooses the principle: step 2/2", await E.page.waitForFunction(() => document.querySelector(".cv-fin-stepno")?.textContent === "2/2", null, { timeout: 8000 }).then(() => true, () => false));
    await sleep(700);
    const p2 = await cardIndex(E, "먼저 물어보고 허락을 받아야 해");
    await E.page.locator(".cv-fin-card").nth(p2).tap();
    check("phase escaped", await E.page.waitForFunction(() => window.__cv?.getEscape?.()?.phase === "escaped", null, { timeout: 10000 }).then(() => true, () => false));
    check("the summary card opens", await vis(E, ".cv-sum", 40000));
    await sleep(1800);
    await run.shot(E, "07b-summary.png");
    await layoutCheck(E, "summary card");
    await E.page.locator(".cv-sum-leave").tap();
    await E.page.waitForFunction(() => window.__cv?.getScreen?.() === "hub", null, { timeout: 15000 });
    await sleep(2000);
    check("E is back in the hall and counsel is lit", (await E.page.evaluate(() => window.__cv.getLitRooms())).includes("counsel"));
    await run.shot(E, "07c-hall-after.png");
  });

  // ───────────────────────────── brightness of the scene frames (not the close-ups) ─────────────────────────────
  await run.step("scene frames are bright (gamma luma: mean ≥ 0.45, p5 ≥ 0.10)", async () => {
    for (const f of ["01a-rug-button.png", "02a-pad-button.png", "02b-classroom.png", "06a-solo.png", "06d-safe-open.png", "07c-hall-after.png"]) {
      const { rgba } = decodePng(readFileSync(join(run.evidence, f)));
      const s = lumaStats(rgba);
      check(`luma ${f}`, passes(s), { mean: +s.mean.toFixed(3), p5: +s.p5.toFixed(3) });
    }
  });
} finally {
  const exit = run.finish({ layouts });
  await browser.close();
  process.exit(exit);
}
