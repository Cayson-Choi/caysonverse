// AI 학교 탈출 1단계 Task 25 E2E — PC, 1280×800. Tabs: T = teacher, A "가람" and B "나래" = team 1; C "한결" and D "모아" = team 2.
// Walks the whole path: wrong class code → teacher opens the class → students join (same-nickname refusal) → team → closed/opened
// gate → waiting pad → classroom → bag, UV light, cabinet → split clues and team chat → teacher pause → cover word and sort board
// → safe (two keys) → last door (wrong, 30 s wait, right, right) → escape show → summary card → back to the hall (board window lit)
// → Review Focus 1 (tab refresh inside a classroom) → results CSV → end of class.
//
//   TEACHER_KEYS_FILE=e2e/fixtures/teacher-keys.e2e.json ADMIN_CODE=e2e-operator CV_ESCAPE_INTRO_MS=1500 npm run dev
//   node e2e/task-escape-desktop.mjs                # CV_CLIENT_URL=http://localhost:5173 by default
//
// Evidence → .superpowers/sdd/evidence/task-escape/desktop/ (*.png, assertions-desktop.json). Exit code 0 = every assertion passed
// and no console/page error beyond the expected 521 / 401 lines and the known THREE.Clock warning (see e2e/lib/escape.mjs; the
// same-nickname refusal of step 3 additionally allows the Colyseus SDK's own "closed unexpectedly (4002)" line while it happens).
// Step 13 (teacher pause) runs between steps 10 and 11 on purpose: it needs a lock that is still unsolved, otherwise a dropped
// lock input could not be told from a refused one. The finale's 30 s wait is paused and checked once more in step 14.

import { join } from "node:path";
import { readFileSync } from "node:fs";
import { decodePng, gammaLuma, lumaStats, passes } from "./luma-check.mjs";
import {
  CABINET, COVER_INDEXES, COVER_WORD, SORT_ANSWER, TEACHER_KEY, WRONG_KEY, PAD_A, PAD_B,
  classCodeOf, closeTeamPanel, cls, createRun, dest, ensureOnRug, entryReady, esc, gone, inHub, inPlay, inspect, joinAsStudent, joinTeam,
  launchBrowser, makeTeam, openPlayer, openSheet, openTeamPanel, pos, press, raw, screenOf, sleep, standNear, submitCode,
  targets, teacherStart, text, toEntry, turnCameraTo, vis, waitFlag, walkAndWait, walkTo,
} from "./lib/escape.mjs";

const run = createRun("desktop");
const { check } = run;
const r2 = (n) => Math.round(n * 100) / 100;
/** The server's CHAT_NOT_NICE sentence (server/src/rooms/profanity.ts): what a held-back chat line answers the sender. */
const CHAT_NOT_NICE = "고운 말로 다시 써 볼까요?";

const chatLog = (p) => p.page.evaluate(async () => (await window.__imp("/src/stores/chatStore.ts")).useChatStore.getState().log.map((l) => ({ kind: l.kind, text: l.text })));
const waitFlagAll = async (ps, flag, ms) => (await Promise.all(ps.map((p) => waitFlag(p, flag, ms)))).every(Boolean);
const faces = (p) => p.page.evaluate(() => [...document.querySelectorAll(".cv-wheel-now")].map((e) => e.textContent).join(""));
const waitLockMsg = (p, want, ms = 5000) =>
  p.page.waitForFunction((w) => document.querySelector(".cv-lock-msg.is-on")?.textContent === w, want, { timeout: ms }).then(() => true, () => false);
const waitToast = (p, want, ms = 6000) =>
  p.page.waitForFunction((w) => [...document.querySelectorAll(".cv-esc-toast span")].some((e) => e.textContent === w), want, { timeout: ms }).then(() => true, () => false);
const cardIndex = (p, label) => p.page.evaluate((l) => [...document.querySelectorAll(".cv-fin-card")].findIndex((e) => e.textContent.includes(l)), label);
const bubbles = (p) => p.page.evaluate(() => window.__cv.getBubbles().map((b) => b.text));

/** Walk to an inspectable thing and open its close-up with E. */
async function openThing(p, id, spots) {
  const ok = await standNear(p, id, spots);
  if (!ok) {
    const here = await pos(p);
    const others = await p.page.evaluate(() => window.__cv.getRemotes().map((r) => `${r.nickname}@${Math.round(r.x * 10) / 10},${Math.round(r.z * 10) / 10}`));
    console.log(`   [diag] ${p.tag} could not stand where ${id} is the pick: at (${r2(here.x)}, ${r2(here.z)}), others ${others.join(" ")}, targets ${JSON.stringify(await targets(p))}`);
    await run.shot(p, `diag-${p.tag}-${id}.png`);
  }
  await p.page.keyboard.press("KeyE");
  const open = await vis(p, ".cv-insp", 5000);
  await sleep(450); // the card pops in over 0.32 s
  return ok && open;
}
async function closeInspect(p) {
  if (await p.page.locator(".cv-insp").count()) {
    await p.page.keyboard.press("Escape");
    await gone(p, ".cv-insp", 3000);
  }
  await sleep(250);
}
const SPOT = {
  note_box: [[0.1, 1.7], [0.1, 2.0], [0.3, 1.8]],
  flashlight: [[3.3, -2.2], [3.2, -2.4], [3.4, -2.0]],
  note_2: [[-1.8, 2.3], [-1.7, 2.1], [-2.0, 2.4]],
  cabinet: [[-3.6, 2.5], [-3.4, 2.4]],
  drawer_left: [[-2.9, -1.1], [-2.8, -0.9], [-3.0, -1.3]],
  drawer_right: [[3.2, 1.5], [3.3, 1.3], [3.1, 1.7]],
  sort_board: [[-2.6, -3.0], [-2.4, -3.1]],
  key_left: [[-4.3, -0.1], [-4.1, 0.0], [-4.0, 0.2], [-4.2, -0.3]],
  key_right: [[4.0, 0.25], [4.2, 0.1], [3.9, 0.4], [4.1, -0.1], [4.3, 0.3], [3.8, 0.0]],
};

/** Steps 8 and 9 of the brief for any team: film + flashlight → UV light; note 2 under UV; cabinet 4719; the cards into the bag. */
async function untilCabinet(p, q, who) {
  check(`${who}: the note box opens`, await openThing(p, "note_box", SPOT.note_box), (await inspect(p))?.objectId);
  await p.page.getByRole("button", { name: "가방에 넣기" }).click();
  check(`${who}: film is in the team bag (picked:uv_film on both screens)`, await waitFlagAll([p, q], "picked:uv_film", 6000));
  await gone(p, ".cv-insp", 4000);
  check(`${who}: the flashlight opens`, await openThing(p, "flashlight", SPOT.flashlight), (await inspect(p))?.objectId);
  await p.page.getByRole("button", { name: "가방에 넣기" }).click();
  check(`${who}: flashlight is in the team bag`, await waitFlagAll([p, q], "picked:flashlight", 6000));
  await gone(p, ".cv-insp", 4000);
  await sleep(400);
  await p.page.locator(".cv-esc-bag-btn").click();
  await sleep(350);
  const chips = p.page.locator(".cv-esc-bag-chip");
  check(`${who}: the bag tray has 2 chips`, (await chips.count()) === 2, await chips.count());
  await chips.nth(0).click();
  await chips.nth(1).click();
  const bagQ = await q.page.waitForFunction(() => window.__cv?.getEscape?.()?.bag.includes("uv_flashlight"), null, { timeout: 8000 }).then(() => true, () => false);
  check(`${who}: combining makes uv_flashlight, and the teammate's bag has it too`, bagQ && (await esc(p)).bag.join() === "uv_flashlight", { p: (await esc(p)).bag, q: (await esc(q)).bag });
  await p.page.locator(".cv-esc-bag-btn").click();
  await sleep(300);

  check(`${who}: note 2 opens`, await openThing(p, "note_2", SPOT.note_2), (await inspect(p))?.objectId);
  await p.page.getByRole("button", { name: "자외선 비추기" }).click();
  await sleep(500);
  const shown = await text(p.page.locator(".cv-insp-uvtext p"));
  const ins = await inspect(p);
  check(`${who}: under UV note 2 shows its hidden digit`, shown === `숨은 숫자 ${CABINET[0]}` && ins?.reveal === shown, { shown, reveal: ins?.reveal });
  await closeInspect(p);
  check(`${who}: the cabinet's number lock opens`, (await openThing(p, "cabinet", SPOT.cabinet)) && (await vis(p, ".cv-lock.is-digits", 5000)));
  await sleep(500);
  for (const d of CABINET) await p.page.keyboard.press(`Digit${d}`);
  check(`${who}: typed ${CABINET} (wheels show it)`, (await faces(p)) === CABINET, await faces(p));
  await p.page.keyboard.press("Enter");
  check(`${who}: solved:cabinet_lock on both screens`, await waitFlagAll([p, q], "solved:cabinet_lock", 8000));
  await sleep(900);
  const pick = p.page.getByRole("button", { name: "가방에 넣기" });
  await pick.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
  await pick.click().catch(() => {});
  check(`${who}: the sort cards are in the team bag`, await waitFlagAll([p, q], "picked:sort_cards", 6000));
  await gone(p, ".cv-insp", 4000);
}

const sceneShots = []; // scene frames (no overlay close-ups) for the brightness check
const browser = await launchBrowser();
const sceneShot = async (p, file) => {
  await run.shot(p, file);
  sceneShots.push(file);
};
let teamName = "";
let splitHolder = "";
let assetMark = 0;
let schoolAssets = null;
const uniqueBytes = (list) => {
  const seen = new Map();
  for (const a of list) if (a.status === 200 && !seen.has(a.url)) seen.set(a.url, a.bytes);
  return seen;
};
try {
  const T = await openPlayer(browser, run, { tag: "T", acceptDownloads: true });
  const A = await openPlayer(browser, run, { tag: "A" });
  const B = await openPlayer(browser, run, { tag: "B" });
  let code = "";

  // ───────────────────────────── 1. wrong class code ─────────────────────────────
  await run.step("1. A tries class code ZZZZZZ", async () => {
    await toEntry(A);
    await openSheet(A, "가람");
    await submitCode(A, "ZZZZZZ");
    await A.page.locator(".cv-dest-error").waitFor({ state: "visible", timeout: 8000 });
    const want = await A.page.evaluate(async () => (await window.__imp("/src/net/reconnectPolicy.ts")).CLASS_NOT_FOUND_NOTICE);
    check("A: no class has that code → CLASS_NOT_FOUND_NOTICE on the sheet", (await dest(A)) === want && want.length > 10, await dest(A));
    // window.__cv (getScreen) exists only once a scene has mounted (LocalPlayer installs it), so on this first visit the
    // entry screen is checked in the page itself; a screen name, if there is one, must still say "entry".
    const screenA = await screenOf(A);
    check(
      "A: still on the entry screen",
      (await vis(A, ".cv-entry", 3000)) && (await vis(A, "dialog.cv-dest[open]", 3000)) && (screenA === undefined || screenA === "entry"),
      screenA ?? "entry (no scene mounted yet)",
    );
    await run.shot(A, "01-wrong-code.png");
  });

  // ───────────────────────────── 2. teacher opens the class ─────────────────────────────
  await run.step("2. T opens the class with the teacher key", async () => {
    await toEntry(T);
    await openSheet(T, "김쌤");
    await T.page.locator(".cv-dest-role").click();
    await T.page.locator(".cv-dest-key-input").fill(WRONG_KEY);
    await T.page.locator(".cv-dest-go").click();
    await T.page.locator(".cv-dest-error").waitFor({ state: "visible", timeout: 8000 });
    check("T: a wrong key is refused with a Korean notice", /선생님 키/.test(await dest(T)), await dest(T));
    await T.page.locator(".cv-dest-key-input").fill(TEACHER_KEY);
    await T.page.locator(".cv-dest-go").click();
    await inHub(T);
    code = (await classCodeOf(T)) ?? "";
    const panelCode = await text(T.page.locator(".cv-hub-code-value"));
    check("T: the teacher panel shows a 6-symbol class code", /^[2-9A-HJ-NP-Z]{6}$/.test(panelCode) && panelCode === code, { panelCode, title: code });
    check("T: the panel has its tabs 진행·팀·채팅·결과", (await T.page.locator(".cv-hub-tab").allTextContents()).join("|") === "진행|팀|채팅|결과");
    await run.shot(T, "02-teacher-panel.png");
  });

  // ───────────────────────────── 3. students join ─────────────────────────────
  await run.step("3. A and B join with the code; B's first try uses A's nickname", async () => {
    await submitCode(A, code); // A's sheet is still open from step 1
    await inHub(A);
    check("A: in the hall", (await screenOf(A)) === "hub");
    await toEntry(B);
    await openSheet(B, "가람");
    const endAllow = run.allow("Colyseus 4002 join refusal (same nickname)", /Room connection was closed unexpectedly \(4002\)/);
    await submitCode(B, code);
    await B.page.locator(".cv-dest-error").waitFor({ state: "visible", timeout: 8000 });
    await sleep(600);
    endAllow();
    check("B: the same nickname → the Korean 'same nickname' notice", (await dest(B)).includes("같은 닉네임"), await dest(B));
    await run.shot(B, "03-same-nickname.png");
    await B.page.locator(".cv-dest-who-edit").click();
    await sleep(500);
    await openSheet(B, "나래");
    await submitCode(B, code);
    await inHub(B);
    check("B: 나래 gets in", (await screenOf(B)) === "hub");
    const remotes = await A.page.evaluate(() => window.__cv.getRemotes().map((x) => x.nickname));
    check("A sees 나래 and the teacher in the hall", remotes.includes("나래") && remotes.includes("김쌤"), remotes);
  });

  // ───────────────────────────── 4. team ─────────────────────────────
  await run.step("4. A makes team 햇살(파랑), B joins it", async () => {
    await ensureOnRug(A, [-8.5, 5]);
    await openTeamPanel(A);
    await A.page.locator(".cv-hub-chips .cv-hub-chip", { hasText: /^햇살$/ }).click();
    await A.page.locator('.cv-hub-swatch[aria-label="파랑"]').click();
    await press(A, A.page.locator(".cv-hub-make .cv-hub-btn"));
    await A.page.locator(".cv-hub-mine").waitFor({ state: "visible", timeout: 5000 });
    teamName = await text(A.page.locator(".cv-hub-mine .cv-hub-team-name"));
    check("A: made a team named 햇살(파랑)", teamName === "햇살(파랑)", teamName);
    await closeTeamPanel(A);
    await joinTeam(B, teamName);
    const ta = (await cls(A)).teams.find((t) => t.mine);
    const tb = (await cls(B)).teams.find((t) => t.mine);
    check("A and B have the same teamId, 2 members", !!ta && !!tb && ta.id === tb.id && ta.members.length === 2 && tb.members.length === 2, { a: ta?.id, b: tb?.id });
    check("the members are 가람 and 나래", !!ta && ta.members.map((m) => m.nickname).sort().join() === "가람,나래", ta?.members.map((m) => m.nickname));
    await sceneShot(B, "04-team-made.png");
    // The progress board as the teacher sees it: T stands in the hall looking at the school model (window unlit); the camera is kept.
    await walkAndWait(T, 0, -7.2, 30000, 0.8);
    await turnCameraTo(T, 0, -14);
    await sleep(1500);
    await sceneShot(T, "04b-board-before.png");
  });

  // ───────────────────────────── 5. closed gate, then the teacher starts ─────────────────────────────
  await run.step("5. before the start A cannot pass the gate (x < 14); T starts → the door opens", async () => {
    await walkAndWait(A, 12, -1.7, 20000, 1.0);
    await walkTo(A, 22, -1.7);
    await sleep(7000);
    const blocked = await pos(A);
    check("A: walking east before the start stops short of the gate (11 ≤ x < 14: it walked, and was stopped)", blocked.x >= 11 && blocked.x < 14, { x: r2(blocked.x), z: r2(blocked.z) });
    await turnCameraTo(A, 20, -1.7);
    await sceneShot(A, "05a-gate-closed.png");
    await teacherStart(T);
    check("A: the banner flashes '복도 문이 열렸어요!'", await A.page.waitForFunction(() => /복도 문이 열렸어요/.test(document.querySelector(".cv-hub-phase")?.textContent ?? ""), null, { timeout: 8000 }).then(() => true, () => false));
    await sleep(2500);
    await sceneShot(A, "05b-gate-open.png");
    check("the class phase is running", (await cls(A))?.phase === "running", (await cls(A))?.phase);
  });

  // ───────────────────────────── 6. waiting pad ─────────────────────────────
  await run.step("6. A reaches the counselling pad first, B second; A presses E", async () => {
    await walkAndWait(A, PAD_A[0], PAD_A[1], 40000, 1.0);
    await sleep(1200);
    const alone = await text(A.page.locator(".cv-hub-hint"));
    check("A alone on the pad: the hint asks for teammates, no enter button", alone.includes("팀원이 2명 이상 모이면") && (await A.page.locator(".cv-action-btn").count()) === 0, alone);
    await walkAndWait(B, PAD_B[0], PAD_B[1], 40000, 1.0);
    await A.page.waitForFunction(() => /입장 \(팀원 2명\)/.test(document.querySelector(".cv-action-btn")?.textContent ?? ""), null, { timeout: 10000 }).catch(() => {});
    const aBtn = await text(A.page.locator(".cv-action-btn"));
    check("A (first on the pad) sees '입장 (팀원 2명)'", aBtn.includes("입장 (팀원 2명)"), aBtn);
    const bHint = await text(B.page.locator(".cv-hub-hint"));
    check("B (second) has no button, only the line naming the leader", (await B.page.locator(".cv-action-btn").count()) === 0 && bHint.includes("팀장 가람님이 입장을 누르면 함께 들어가요"), bHint);
    await sceneShot(A, "06a-pad-leader.png");
    await run.shot(B, "06b-pad-follower.png");
    assetMark = A.assets.length;
    const t0 = Date.now();
    await A.page.keyboard.press("KeyE");
    const both = await Promise.all([A, B].map((p) => p.page.waitForFunction(() => window.__cv?.getScreen?.() === "escape", null, { timeout: 5000 }).then(() => Date.now() - t0, () => -1)));
    check("both screens say 'escape' within 5 s of A's E", both.every((ms) => ms >= 0), both);
  });

  // ───────────────────────────── 7. intro ─────────────────────────────
  await run.step("7. intro lines, then the clock runs", async () => {
    check("A: the intro story box is up", await vis(A, ".cv-esc-dialogue-text", 20000), await text(A.page.locator(".cv-esc-dialogue-text")));
    await run.shot(A, "07a-intro.png");
    await Promise.all([inPlay(A), inPlay(B)]);
    await sleep(1500);
    const t0 = (await esc(A)).timeLeftS;
    await sleep(3500);
    const t1 = (await esc(A)).timeLeftS;
    const tb = (await esc(B)).timeLeftS;
    check("timeLeftS counts down (A)", t1 < t0 && t0 > 0, [t0, t1]);
    check("B reads the same clock (±2 s)", Math.abs(tb - t1) <= 2, [tb, t1]);
    // First-load report of the school's model files (distinct URLs): what the hall fetched, then what entering the classroom added.
    const hall = uniqueBytes(A.assets.slice(0, assetMark));
    const room = uniqueBytes(A.assets.slice(assetMark));
    const total = (m) => [...m.values()].reduce((a, b) => a + b, 0);
    schoolAssets = { hall: Object.fromEntries(hall), hallBytes: total(hall), classroom: Object.fromEntries(room), classroomBytes: total(room) };
    console.log("   school model files — hall:", total(hall), "B; classroom added:", total(room), "B", JSON.stringify([...room.keys()]));
    check("the hall's model files stay within the 3.5 MB hub budget", total(hall) > 0 && total(hall) <= 3.5 * 1024 * 1024, total(hall));
    check("the classroom's model files were fetched only on entering (not in the hall)", [...room.keys()].some((u) => /counsel/.test(u)) && ![...hall.keys()].some((u) => /counsel/.test(u)), [...room.keys()]);
    await sceneShot(A, "07b-play.png");
    await sceneShot(B, "07c-play-b.png");
  });

  // ───────────────────────────── 8 + 9. bag, UV, cabinet ─────────────────────────────
  await run.step("8+9. A: film + flashlight → UV light; note 2 under UV; cabinet 4719", async () => {
    await untilCabinet(A, B, "A");
    await run.shot(B, "09-cabinet-open-b.png");
  });

  // ───────────────────────────── 10. split clues and team chat ─────────────────────────────
  await run.step("10. split clues (A's left drawer, B's two drawers) and the team chat", async () => {
    // The server hands the halves out in the order the members joined the classroom (A, B, A …): whoever got into the room first
    // reads the left drawer. The brief's wording has 가람 (A) first; the join order of two simultaneous entries is the server's call,
    // so the check follows whoever holds the left drawer and asserts the full pattern for that pair.
    const split = {};
    for (const [p, who] of [[A, "A"], [B, "B"]]) {
      for (const id of ["drawer_left", "drawer_right"]) {
        check(`${who}: the ${id} opens`, await openThing(p, id, SPOT[id]), (await inspect(p))?.objectId);
        split[who + "." + id] = (await inspect(p))?.split;
        if (who === "A" && id === "drawer_left") await run.shot(p, "10a-split-drawer.png");
        await closeInspect(p);
      }
      // Players block each other: A leaves the drawers' spots free for B.
      if (who === "A") await walkAndWait(A, 0.8, 3.2, 25000, 1.0);
    }
    const holder = split["A.drawer_left"]?.text !== undefined ? "A" : "B";
    const other = holder === "A" ? "B" : "A";
    const nick = { A: "가람", B: "나래" };
    check(`${holder} (${nick[holder]}) reads the left drawer: '동 ○ 먼 ○'`, split[holder + ".drawer_left"]?.text === "동 ○ 먼 ○", split[holder + ".drawer_left"]);
    check(`${other}'s left drawer: no text, only that ${nick[holder]}님만 can read it`, split[other + ".drawer_left"]?.text === undefined && (split[other + ".drawer_left"]?.lockedText ?? "").includes(`${nick[holder]}님만`), split[other + ".drawer_left"]);
    check(`${other} (${nick[other]}) reads the right drawer: '○ 의 ○ 저'`, split[other + ".drawer_right"]?.text === "○ 의 ○ 저", split[other + ".drawer_right"]);
    check(`${holder}'s right drawer: only the notice that ${nick[other]}님만 can read it`, split[holder + ".drawer_right"]?.text === undefined && (split[holder + ".drawer_right"]?.lockedText ?? "").includes(`${nick[other]}님만`), split[holder + ".drawer_right"]);
    splitHolder = holder;

    // Team chat: A's line reaches B and the teacher's chat tab; B's rude line is held back.
    await A.page.keyboard.press("Enter");
    await A.page.locator(".cv-chat-field").fill("동 먼");
    await A.page.locator(".cv-chat-field").press("Enter");
    await A.page.keyboard.press("Escape"); // a sent line keeps the caret in the field (2026-11-10): leave the chat
    await sleep(1200);
    check("B sees A's team-chat line '동 먼'", (await bubbles(B)).includes("동 먼"), await bubbles(B));
    await T.page.getByRole("tab", { name: "채팅" }).click();
    await sleep(600);
    const tChat = await text(T.page.locator(".cv-hub-chat"));
    check("T's chat tab shows '동 먼'", tChat.includes("동 먼"), tChat.slice(0, 200));
    await B.page.keyboard.press("Enter");
    await B.page.locator(".cv-chat-field").fill("시1발");
    await B.page.locator(".cv-chat-field").press("Enter");
    await B.page.keyboard.press("Escape"); // leave the chat (the caret stays in the field after a send)
    await sleep(1500);
    const bLog = await chatLog(B);
    check("B is answered with CHAT_NOT_NICE", bLog.some((l) => l.kind === "system" && l.text === CHAT_NOT_NICE), bLog.slice(-3));
    const aLog = await chatLog(A);
    check("A never sees the held-back line (no bubble, no log row)", !(await bubbles(A)).some((t) => t.includes("시")) && !aLog.some((l) => l.text.includes("시1발") || l.text.includes("시발") || l.text === CHAT_NOT_NICE), aLog.slice(-3));
    await sleep(500);
    const tChat2 = await text(T.page.locator(".cv-hub-chat"));
    check("T's chat tab shows '⚠ 걸러진 말'", tChat2.includes("⚠ 걸러진 말"), tChat2.slice(-120));
    await run.shot(T, "10c-teacher-chat.png");
    await T.page.getByRole("tab", { name: "진행" }).click();
  });

  // ───────────────────────────── 13. teacher pause (between 10 and 11, see the header) ─────────────────────────────
  await run.step("13. T pauses: covers, the clock stands still, a lock input is dropped; T resumes", async () => {
    check("A: the board's cover lock opens", (await openThing(A, "sort_board", SPOT.sort_board)) && (await vis(A, ".cv-lock.is-letters", 5000)));
    const input0 = (await esc(A)).lockInput.cover_lock ?? "";
    const before = (await esc(A)).timeLeftS;
    await T.page.getByRole("button", { name: "일시정지" }).click();
    const covers = await Promise.all([A, B].map((p) => vis(p, ".cv-esc-cover", 8000)));
    check("both screens show the pause cover", covers.every(Boolean), covers);
    check("the cover says 선생님이 잠시 멈췄어요", (await text(A.page.locator(".cv-esc-card-title"))) === "선생님이 잠시 멈췄어요", await text(A.page.locator(".cv-esc-card-title")));
    await run.shot(A, "13a-paused-a.png");
    await run.shot(B, "13b-paused-b.png");
    const p0 = (await esc(A)).timeLeftS;
    await raw(A, "x_lock_input", { lockId: "cover_lock", value: COVER_INDEXES.join("") });
    await sleep(3200);
    const p1 = (await esc(A)).timeLeftS;
    check("paused: timeLeftS stands still for 3 s", p0 === p1 && (await esc(B)).timeLeftS === p1, [p0, p1]);
    check("paused: A's lock input was dropped", ((await esc(A)).lockInput.cover_lock ?? "") === input0 && ((await esc(B)).lockInput.cover_lock ?? "") === input0, { before: input0, after: (await esc(A)).lockInput.cover_lock });
    await T.page.getByRole("button", { name: "다시 시작" }).click();
    check("resume: the covers go away", (await gone(A, ".cv-esc-cover", 8000)) && (await gone(B, ".cv-esc-cover", 8000)));
    await sleep(3200);
    const after = (await esc(A)).timeLeftS;
    check("resume: the clock runs again", after < p1 && p1 <= before, [before, p1, after]);
    check("resume: the dropped input did not come back later", ((await esc(A)).lockInput.cover_lock ?? "") === input0, (await esc(A)).lockInput.cover_lock);
  });

  // ───────────────────────────── 11. cover word and the sort board ─────────────────────────────
  await run.step("11. cover word 동의먼저 → sort board: 2 wrong cards, then right", async () => {
    if (!(await A.page.locator(".cv-lock.is-letters").count())) await A.page.keyboard.press("KeyE");
    check("A: the letters lock is open", await vis(A, ".cv-lock.is-letters", 5000));
    for (let i = 0; i < 4; i++) {
      for (let k = 0; k < COVER_INDEXES[i]; k++) await A.page.keyboard.press("ArrowUp");
      if (i < 3) await A.page.keyboard.press("ArrowRight");
    }
    check(`the wheels spell ${COVER_WORD}`, (await faces(A)) === COVER_WORD, await faces(A));
    await sleep(1800);
    await A.page.locator(".cv-lock-open").click();
    check("the cover opens: the card shows the sort board", await vis(A, ".cv-lock.is-sort", 6000));
    const board = (await A.page.evaluate(async () => (await window.__imp("/src/stores/escapeStore.ts")).useEscapeStore.getState().content)).locks.find((l) => l.id === "board_lock");
    const labelOf = Object.fromEntries(board.cards.map((c) => [c.id, c.label]));
    const place = { ...SORT_ANSWER, festival: "stop", password: "ok" }; // 2 cards in the wrong bin
    for (const [cid, bin] of Object.entries(place)) {
      await A.page.locator(".cv-sort-tray .cv-sort-card", { hasText: labelOf[cid] }).dragTo(A.page.locator(`.cv-sort-bin[data-bin="${bin}"]`));
      await sleep(130);
    }
    await sleep(900);
    check("all 8 cards are placed", (await A.page.locator(".cv-sort-tray .cv-sort-card").count()) === 0 && Object.keys((await esc(A)).board).length === 8, Object.keys((await esc(A)).board).length);
    const w0 = (await esc(A)).wrongAttempts;
    await A.page.locator(".cv-lock-open").click();
    check("the board says '2장이 제자리가 아니에요'", await waitLockMsg(A, "2장이 제자리가 아니에요"), await text(A.page.locator(".cv-lock-msg")));
    await sleep(500);
    check("wrongAttempts went up by exactly 1", (await esc(A)).wrongAttempts === w0 + 1 && (await esc(B)).wrongAttempts === w0 + 1, [w0, (await esc(A)).wrongAttempts]);
    await run.shot(A, "11a-board-wrong.png");
    // fix the two cards (bin → the right bin) and submit again
    await A.page.locator('.cv-sort-bin[data-bin="stop"] .cv-sort-card', { hasText: labelOf.festival }).dragTo(A.page.locator('.cv-sort-bin[data-bin="ok"]'));
    await sleep(150);
    await A.page.locator('.cv-sort-bin[data-bin="ok"] .cv-sort-card', { hasText: labelOf.password }).dragTo(A.page.locator('.cv-sort-bin[data-bin="stop"]'));
    await sleep(1800);
    check("the team's board matches the answer now", Object.entries((await esc(A)).board).every(([k, v]) => SORT_ANSWER[k] === v), (await esc(A)).board);
    await A.page.locator(".cv-lock-open").click();
    check("board solved: safe_unlocked on both screens", await waitFlagAll([A, B], "safe_unlocked", 8000));
    await run.shot(A, "11b-board-solved.png");
    await sleep(600);
    await closeInspect(A);
  });

  // ───────────────────────────── 12. the safe: two keys ─────────────────────────────
  await run.step("12. keys 3 s apart do not open the safe; 0.5 s apart do", async () => {
    check("A stands where the west key is the nearest thing", await standNear(A, "safe_key_left", SPOT.key_left), await targets2(A));
    check("B stands where the east key is the nearest thing", await standNear(B, "safe_key_right", SPOT.key_right), await targets2(B));
    await A.page.keyboard.press("KeyE");
    await sleep(3000);
    await B.page.keyboard.press("KeyE");
    await sleep(1500);
    check("3 s apart: the safe stays shut", !(await esc(A)).flags.includes("safe_open") && !(await esc(B)).flags.includes("safe_open"), (await esc(A)).flags);
    await sleep(2700); // B's own 2 s window ends
    await A.page.keyboard.press("KeyE");
    await sleep(500);
    await B.page.keyboard.press("KeyE");
    check("0.5 s apart: safe_open on both screens", await waitFlagAll([A, B], "safe_open", 6000), (await esc(A)).flags);
    await sleep(1200);
    await sceneShot(B, "12-safe-open.png");
  });

  // ───────────────────────────── 14. the last door ─────────────────────────────
  await run.step("14. last door: both '투명성' → explanation + 30 s wait → both '프라이버시 보호' → both '먼저 물어보고 허락' → escape", async () => {
    const fin = await Promise.all([A, B].map((p) => vis(p, ".cv-fin", 40000)));
    check("the last-door panel opens for both", fin.every(Boolean), fin);
    await sleep(600);
    await run.shot(A, "14a-finale.png");
    const wrongIdx = await cardIndex(A, "투명성");
    await A.page.keyboard.press("Digit" + (wrongIdx + 1));
    await sleep(400);
    await B.page.locator(".cv-fin-card").nth(wrongIdx).click();
    check("the explanation shows on both screens", (await vis(A, ".cv-fin-explain", 6000)) && (await vis(B, ".cv-fin-explain", 6000)), await text(A.page.locator(".cv-fin-explain")));
    await sleep(800);
    const cool = await text(A.page.locator(".cv-fin-cool span"));
    const cd0 = (await esc(A)).cooldownS;
    check("a 30 s wait is shown ('n초 뒤에 다시 고를 수 있어요')", /^\d+초 뒤에 다시 고를 수 있어요$/.test(cool) && cd0 >= 25 && cd0 <= 30, { cool, cd0 });
    await run.shot(A, "14b-finale-wrong.png");
    const waitStart = Date.now();
    // Review Focus 4: the wait stops while the teacher pauses.
    await sleep(1500);
    await T.page.getByRole("button", { name: "일시정지" }).click();
    await vis(A, ".cv-esc-cover", 8000);
    const c1 = (await esc(A)).cooldownS;
    await sleep(3200);
    const c2 = (await esc(A)).cooldownS;
    check("paused: the 30 s wait stands still", c1 === c2 && c1 > 0, [c1, c2]);
    await T.page.getByRole("button", { name: "다시 시작" }).click();
    await gone(A, ".cv-esc-cover", 8000);
    const ended = await A.page.waitForFunction(() => window.__cv?.getEscape?.()?.cooldownS === 0 && [...document.querySelectorAll(".cv-fin-card")].every((e) => !e.disabled), null, { timeout: 45000 }).then(() => true, () => false);
    const waited = (Date.now() - waitStart) / 1000;
    check("the wait ends after about 30 s of play time (plus the 3 s pause)", ended && waited >= 28 && waited <= 42, r2(waited));
    // right principle, both
    const principleIdx = await cardIndex(A, "프라이버시 보호");
    await A.page.keyboard.press("Digit" + (principleIdx + 1));
    await sleep(300);
    await B.page.locator(".cv-fin-card").nth(principleIdx).click();
    check("principle chosen by both: step 2/2", await A.page.waitForFunction(() => document.querySelector(".cv-fin-stepno")?.textContent === "2/2", null, { timeout: 8000 }).then(() => true, () => false));
    await sleep(700);
    const askIdx = await cardIndex(A, "먼저 물어보고 허락을 받아야 해");
    await A.page.keyboard.press("Digit" + (askIdx + 1));
    await sleep(300);
    await B.page.locator(".cv-fin-card").nth(askIdx).click();
    const escaped = await Promise.all([A, B].map((p) => p.page.waitForFunction(() => window.__cv?.getEscape?.()?.phase === "escaped", null, { timeout: 10000 }).then(() => true, () => false)));
    check("both screens: phase escaped", escaped.every(Boolean), escaped);
    await sleep(500);
    await sceneShot(B, "14c-escape-glow.png");
    await sleep(1500);
    await sceneShot(B, "14d-escape-opening.png");
    await sleep(1500);
    await sceneShot(B, "14e-escape-lights.png");
    const sums = await Promise.all([A, B].map((p) => vis(p, ".cv-sum", 40000)));
    check("the summary card opens for both", sums.every(Boolean), sums);
    await sleep(1800);
    await run.shot(A, "14f-summary-a.png");
    await run.shot(B, "14g-summary-b.png");
    const card = await A.page.evaluate(() => ({
      title: document.querySelector(".cv-sum-title")?.textContent,
      first: document.querySelector(".cv-sum-first")?.textContent,
      lines: document.querySelectorAll(".cv-sum-lines li").length,
    }));
    check("summary card: 탈출 성공!, three lines, 'second thoughts' first-try note", card.title === "탈출 성공!" && card.lines === 3 && card.first === "다시 생각해서 원칙을 맞혔어요!", card);
  });

  // ───────────────────────────── 15. back to the hall ─────────────────────────────
  await run.step("15. 복도로 나가기 → corridor pad; counsel is lit; the system line", async () => {
    await A.page.locator(".cv-sum-leave").click();
    await B.page.locator(".cv-sum-leave").click();
    await Promise.all([A, B].map((p) => p.page.waitForFunction(() => window.__cv?.getScreen?.() === "hub", null, { timeout: 15000 })));
    await sleep(2500);
    const pa = await pos(A);
    const pb = await pos(B);
    check("A and B stand in the corridor in front of the counselling pad", Math.hypot(pa.x - PAD_A[0], pa.z - PAD_A[1]) < 3.5 && Math.hypot(pb.x - PAD_A[0], pb.z - PAD_A[1]) < 3.5, { a: [r2(pa.x), r2(pa.z)], b: [r2(pb.x), r2(pb.z)] });
    const lit = await Promise.all([A, B, T].map((p) => p.page.evaluate(() => window.__cv.getLitRooms())));
    check("getLitRooms() has counsel on A, B and T", lit.every((l) => l.includes("counsel")), lit);
    const want = `${teamName} 팀이 상담실을 탈출했어요!`;
    const logs = await Promise.all([A, B, T].map(chatLog));
    check(`the system line '${want}' is in the hall chat`, logs.some((l) => l.some((x) => x.kind === "system" && x.text === want)), logs.map((l) => l.filter((x) => x.kind === "system").map((x) => x.text)));
    await sceneShot(A, "15a-hall-after-a.png");
    await sleep(3500); // the sparkle ends
    await sceneShot(T, "15b-board-after.png");
    const before = decodePng(readFileSync(join(run.evidence, "04b-board-before.png")));
    const after = decodePng(readFileSync(join(run.evidence, "15b-board-after.png")));
    // Only the model on the wall (right of the teacher panel), where the windows are; the panel and the chat log differ between the
    // frames. A lit window turns from blue-grey to a warm yellow that is as bright: count the pixels that got warmer (R - B up by
    // more than 60) and are bright (gamma luma > 0.6) afterwards, against the pixels that got cooler.
    let warmPx = 0;
    let coolPx = 0;
    for (let y = 150; y < 400; y++) {
      for (let x = 330; x < 940; x++) {
        const i = (y * before.width + x) * 4;
        const warm = after.rgba[i] - after.rgba[i + 2] - (before.rgba[i] - before.rgba[i + 2]);
        if (warm > 60 && gammaLuma(after.rgba[i], after.rgba[i + 1], after.rgba[i + 2]) > 0.6) warmPx++;
        else if (warm < -60) coolPx++;
      }
    }
    check("the board's counsel window turned from blue-grey to a bright warm colour (same camera, before/after)", before.width === after.width && warmPx >= 300 && warmPx > coolPx * 3, { warmPx, coolPx });
  });

  // ───────────────────────────── 16. Review Focus 1: refresh inside a classroom ─────────────────────────────
  const C = await openPlayer(browser, run, { tag: "C" });
  let D = await openPlayer(browser, run, { tag: "D" });
  await run.step("16. team 2 (C, D) reaches step 9; D refreshes the tab and comes back to the same classroom", async () => {
    await joinAsStudent(C, "한결", code);
    await joinAsStudent(D, "모아", code);
    const name2 = await makeTeam(C, [-9.2, 7]);
    await joinTeam(D, name2, [-9.2, 5.6]);
    check("C and D are in one team of two (not team 1)", (await cls(C)).teams.find((t) => t.mine)?.members.length === 2 && name2 !== teamName, name2);
    // A and B still stand in front of the pad (that is where the summary card sent them): out of the way first.
    await walkAndWait(A, 10, 3, 40000, 1.5);
    await walkAndWait(B, 10, -3, 40000, 1.5);
    await walkAndWait(C, PAD_A[0], PAD_A[1], 40000, 1.0);
    await sleep(800);
    await walkAndWait(D, PAD_B[0], PAD_B[1], 40000, 1.0);
    const cBtn = await C.page.waitForFunction(() => /입장/.test(document.querySelector(".cv-action-btn")?.textContent ?? ""), null, { timeout: 10000 }).then(() => true, () => false);
    check("C (first on the pad) sees the enter button", cBtn, await text(C.page.locator(".cv-action-btn")) || (await text(C.page.locator(".cv-hub-hint"))));
    await C.page.keyboard.press("KeyE");
    await Promise.all([inPlay(C), inPlay(D)]);
    await sleep(800);
    await untilCabinet(C, D, "C");
    // D's own half: the drawer whose text D can read (the halves go out in join order, so which one it is is the server's call).
    const halves = {};
    for (const id of ["drawer_left", "drawer_right"]) {
      check(`D: the ${id} opens`, await openThing(D, id, SPOT[id]), (await inspect(D))?.objectId);
      halves[id] = (await inspect(D))?.split;
      await closeInspect(D);
    }
    const ownId = halves.drawer_left?.text !== undefined ? "drawer_left" : "drawer_right";
    const otherId = ownId === "drawer_left" ? "drawer_right" : "drawer_left";
    check("D reads exactly one of the two drawers", halves[ownId]?.text !== undefined && halves[otherId]?.text === undefined && /한결님만/.test(halves[otherId]?.lockedText ?? ""), halves);
    const before = await esc(D);
    const teamBefore = (await cls(D)).teams.find((t) => t.mine)?.id;
    await run.shot(D, "16a-before-refresh.png");
    // ── D refreshes the tab ──
    await D.page.reload({ waitUntil: "domcontentloaded" });
    await entryReady(D);
    await openSheet(D, "모아");
    await submitCode(D, code);
    const back = await D.page.waitForFunction(() => window.__cv?.getScreen?.() === "escape", null, { timeout: 40000 }).then(() => true, () => false);
    check("D: same class code and nickname → back in the classroom by itself", back, await screenOf(D));
    await D.page.waitForFunction(() => window.__cv?.getEscape?.()?.flags.includes("solved:cabinet_lock"), null, { timeout: 15000 }).catch(() => {});
    const afterD = await esc(D);
    check("D: the same flags as before the refresh", JSON.stringify([...afterD.flags].sort()) === JSON.stringify([...before.flags].sort()), { before: before.flags, after: afterD.flags });
    check("D: the same team bag (the sort cards)", JSON.stringify(afterD.bag) === JSON.stringify(before.bag), { before: before.bag, after: afterD.bag });
    check("D: still C's teammate (same team, 2 members in the room)", afterD.members.length === 2 && (await cls(D))?.teams.find((t) => t.mine)?.id === teamBefore, afterD.members.map((m) => m.nickname));
    check(`D: the ${ownId} still gives D's own half`, (await openThing(D, ownId, SPOT[ownId])) && (await inspect(D))?.split?.text === halves[ownId].text, [halves[ownId], (await inspect(D))?.split]);
    await run.shot(D, "16b-after-refresh.png");
    await closeInspect(D);
    check(`D: the ${otherId} is still the other half (locked, 한결님만)`, (await openThing(D, otherId, SPOT[otherId])) && (await inspect(D))?.split?.text === undefined && /한결님만/.test((await inspect(D))?.split?.lockedText ?? ""), (await inspect(D))?.split);
    await closeInspect(D);
  });

  // ───────────────────────────── 17. results CSV ─────────────────────────────
  await run.step("17. T downloads the results CSV", async () => {
    await T.page.getByRole("tab", { name: "결과" }).click();
    const [dl] = await Promise.all([T.page.waitForEvent("download", { timeout: 10000 }), T.page.getByRole("button", { name: "결과 CSV 받기" }).click()]);
    const bytes = readFileSync(await dl.path());
    check("the file starts with a UTF-8 BOM", bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf, [...bytes.subarray(0, 3)]);
    const csv = bytes.subarray(3).toString("utf8"); // the 3 BOM bytes were checked above
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = lines[0].split(",");
    const col = header.indexOf("프라이버시 보호 첫 시도");
    check("the header has the column '프라이버시 보호 첫 시도'", col >= 0, header);
    const row = lines.find((l) => l.startsWith(teamName));
    check(`the row of ${teamName} says 오답 (the first try was '투명성')`, !!row && row.split(",")[col] === "오답", row);
    check("the row says 탈출", !!row && row.split(",").includes("탈출"), row);
    await run.shot(T, "17-results-tab.png");
  });

  // ───────────────────────────── 18. end of class ─────────────────────────────
  await run.step("18. T ends the class: students see the entry screen with CLASS_ENDED_NOTICE", async () => {
    await T.page.getByRole("tab", { name: "진행" }).click();
    await T.page.getByRole("button", { name: "수업 끝내기" }).click();
    await T.page.getByRole("button", { name: "끝내기", exact: true }).click();
    const want = await A.page.evaluate(async () => (await window.__imp("/src/net/reconnectPolicy.ts")).CLASS_ENDED_NOTICE);
    check("CLASS_ENDED_NOTICE is a real sentence (an empty one would match any screen)", typeof want === "string" && want.length > 10, want);
    const t0 = Date.now();
    // The class keeps its connections open for a grace (CLASS_END_GRACE_MS, 30 s: time to download the results), then closes them all
    // with CLASS_CLOSED_CODE. A student inside a classroom first sees the classroom's own "수업이 끝났어요" card.
    const ended = await vis(D, ".cv-esc-card", 15000);
    check("D (classroom): the classroom shows its 수업이 끝났어요 card at once", ended && (await text(D.page.locator(".cv-esc-card"))).includes("수업이 끝났어요"), await text(D.page.locator(".cv-esc-card")));
    await run.shot(D, "18-class-ended-d-card.png");
    const seen = await Promise.all(
      [[A, "A (hall)"], [B, "B (hall)"], [D, "D (classroom)"]].map(async ([p, who]) => {
        // The entry screen itself must show the sentence: the hall's chat log carries the same words as a system line.
        const at = await p.page
          .waitForFunction((w) => w.length > 10 && (document.querySelector(".cv-entry")?.innerText ?? "").includes(w), want, { timeout: 60000 })
          .then(() => (Date.now() - t0) / 1000, () => -1);
        return { who, p, at };
      }),
    );
    for (const s of seen) {
      check(`${s.who}: the entry screen shows the class-ended notice (after ${s.at.toFixed(1)} s)`, s.at >= 0 && s.at <= 50, s.at >= 0 ? want : { at: s.at, text: (await s.p.page.evaluate(() => document.body.innerText)).slice(0, 160) });
      await run.shot(s.p, `18-class-ended-${s.who[0].toLowerCase()}.png`);
    }
    await run.shot(A, "18-class-ended.png");
  });

  // ───────────────────────────── brightness of the scene frames ─────────────────────────────
  await run.step("scene frames are bright (gamma luma: mean ≥ 0.45, p5 ≥ 0.10)", async () => {
    for (const f of sceneShots) {
      const { rgba } = decodePng(readFileSync(join(run.evidence, f)));
      const s = lumaStats(rgba);
      check(`luma ${f}`, passes(s), { mean: +s.mean.toFixed(3), p5: +s.p5.toFixed(3) });
    }
  });
} catch (e) {
  // A throw outside run.step (a launch, a page that never opened) must exit non-zero, not pass on the checks seen so far.
  run.check("script ran to the end", false, String(e?.stack ?? e).slice(0, 900));
} finally {
  const exit = run.finish({ splitHolder, schoolAssets });
  await browser.close();
  process.exit(exit);
}

async function targets2(p) {
  return p.page.evaluate(async () => (await window.__imp("/src/game/interactTargets.ts")).getTargets(window.__cv.getPos()).map((t) => `${t.id}@${Math.round(t.dist * 100) / 100}`));
}
