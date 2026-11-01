import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCK_SUBMIT_GAP_MS, SOLO_HOLD_MS, type TextLevel } from "@caysonverse/shared/escape/constants";
import { PRINCIPLES, PRINCIPLE_SOURCE } from "@caysonverse/shared/escape/principles";
import { COUNSEL_ANCHORS, COUNSEL_VISUALS } from "@caysonverse/shared/school/counselMap";
import { bundleNeedles, publicContent, publicStrings, resolveText, secretStrings } from "../content";
import {
  applyAction,
  createEngineState,
  currentStage,
  inspectView,
  type EngineAction,
  type EngineCtx,
  type EngineEvent,
  type EngineState,
} from "../engine";
import type { LockDef, ObjectDef, Text } from "../types";
import { validateRoomDef } from "../validate";
import { counsel } from "./counsel";
import { ROOM_DEFS } from "./index";

type DigitsLock = Extract<LockDef, { kind: "digits" }>;
type SortLock = Extract<LockDef, { kind: "sort" }>;

const NAMES: ReadonlyMap<string, string> = new Map([
  ["s1", "가람"],
  ["s2", "나래"],
]);
const lock = (id: string) => counsel.locks.find((l) => l.id === id)!;
const board = lock("board_lock") as SortLock;
const obj = (id: string) => counsel.objects.find((o) => o.id === id)!;
const notes = () => counsel.objects.filter((o) => /^note_\d$/.test(o.id));
const noteNumber = (o: ObjectDef) => Number(o.id.slice("note_".length));
const byNoteNumber = (a: ObjectDef, b: ObjectDef) => noteNumber(a) - noteNumber(b);

/** Every string (keys and values) inside a JSON-like value. */
function allStrings(x: unknown, out: string[] = []): string[] {
  if (typeof x === "string") out.push(x);
  else if (Array.isArray(x)) for (const v of x) allStrings(v, out);
  else if (x !== null && typeof x === "object")
    for (const [k, v] of Object.entries(x)) {
      out.push(k);
      allStrings(v, out);
    }
  return out;
}

/** Both levels are written, non-empty and different. */
function expectTwoLevels(t: Text, what: string): void {
  expect(typeof t, what).toBe("object");
  if (typeof t === "string") return;
  expect(t.easy.trim().length, `${what} easy`).toBeGreaterThan(0);
  expect(t.hard.trim().length, `${what} hard`).toBeGreaterThan(0);
  expect(t.easy, what).not.toBe(t.hard);
}

// ───────────────────────────── A team playing the room ─────────────────────────────

interface Team {
  s: EngineState;
  ctx: EngineCtx;
  events: EngineEvent[];
}

function team(connected: readonly string[] = ["s1", "s2"], level: TextLevel = "easy"): Team {
  return { s: createEngineState(counsel), ctx: { now: 0, connected, names: NAMES, maxHintTier: 3, level }, events: [] };
}

/** One action `dt` ms of game time after the previous one (default: past the lock submit gap). */
function act(t: Team, a: EngineAction, dt = LOCK_SUBMIT_GAP_MS): EngineEvent[] {
  t.ctx = { ...t.ctx, now: t.ctx.now + dt };
  const ev = applyAction(counsel, t.s, a, t.ctx);
  t.events.push(...ev);
  return ev;
}
const pickup = (t: Team, objectId: string, sid = "s1") => act(t, { t: "pickup", sid, objectId });
const input = (t: Team, lockId: string, value: string, sid = "s1") => act(t, { t: "input", sid, lockId, value });
const submit = (t: Team, lockId: string, sid = "s1") => act(t, { t: "submit", sid, lockId });
const place = (t: Team, cardId: string, bin: string, sid = "s1") => act(t, { t: "place", sid, lockId: "board_lock", cardId, bin });
const press = (t: Team, objectId: string, sid: string, dt?: number) => act(t, { t: "press", sid, objectId }, dt);
const vote = (t: Team, optionId: string, sid: string) => act(t, { t: "vote", sid, optionId });
const view = (t: Team, objectId: string, viewer = "s1") => inspectView(counsel, t.s, objectId, viewer, t.ctx, t.ctx.level);

/** The intended sort, written out here so a changed answer in the room data fails this test. */
const SORT: Record<string, "ok" | "stop"> = {
  festival: "ok",
  lunch: "ok",
  club_notice: "ok",
  my_drawing: "ok",
  phone_number: "stop",
  address: "stop",
  medical: "stop",
  password: "stop",
};

function makeUvLight(t: Team): void {
  pickup(t, "flashlight", "s1");
  pickup(t, "note_box", "s2");
  act(t, { t: "combine", sid: "s1", a: "flashlight", b: "uv_film" });
}
function openCabinet(t: Team): void {
  makeUvLight(t);
  input(t, "cabinet_lock", "4719");
  submit(t, "cabinet_lock");
}
function openCover(t: Team, takeCards = true): void {
  openCabinet(t);
  if (takeCards) pickup(t, "cabinet", "s2");
  input(t, "cover_lock", "1356", "s2"); // 동 · 의 · 먼 · 저 (wheel indexes)
  submit(t, "cover_lock", "s2");
}
function sortBoard(t: Team): void {
  openCover(t);
  for (const [card, bin] of Object.entries(SORT)) place(t, card, bin);
  submit(t, "board_lock");
}
/** Two members turn the two keys within one second (the coop window is two). */
function openSafe(t: Team): void {
  sortBoard(t);
  press(t, "safe_key_left", "s1");
  press(t, "safe_key_right", "s2", 900);
}
function persuade(t: Team): void {
  openSafe(t);
  for (const sid of t.ctx.connected) vote(t, "privacy", sid);
  for (const sid of t.ctx.connected) vote(t, "ask_first", sid);
}

// ──────────────────────────────────── Tests ────────────────────────────────────

describe("counsel room (상담실, 개인정보)", () => {
  it("is a valid room: validateRoomDef(counsel) passes and ROOM_DEFS serves it", () => {
    expect(validateRoomDef(counsel)).toBe(counsel);
    expect(ROOM_DEFS.counsel).toBe(counsel);
    expect(Object.keys(ROOM_DEFS)).toEqual(["counsel"]);
    expect(counsel.id).toBe("counsel");
    expect(counsel.title).toBe("상담실");
    expect(counsel.principleIds).toEqual(["privacy"]);
    expect(PRINCIPLES.find((p) => p.id === "privacy")?.label).toBe("프라이버시 보호");
  });

  it("golden path escapes with firstTry.privacy = true", () => {
    for (const level of ["easy", "hard"] as const) {
      const t = team(["s1", "s2"], level);
      const stages: (string | null)[] = [currentStage(counsel, t.s)?.id ?? null];
      const stageNow = () => stages.push(currentStage(counsel, t.s)?.id ?? null);

      makeUvLight(t);
      expect(t.s.bag).toEqual(["uv_flashlight"]);
      expect(t.events).toContainEqual({ e: "say", lineId: "bandit_uv" });
      // the UV light shows the hidden digit of a note
      expect(view(t, "note_2")?.reveal).toBe("숨은 숫자 4");
      input(t, "cabinet_lock", "4719");
      expect(submit(t, "cabinet_lock")).toEqual([
        { e: "solved", lockId: "cabinet_lock", by: "s1" },
        { e: "say", lineId: "cabinet_open" },
      ]);
      stageNow();
      expect(pickup(t, "cabinet", "s2")).toEqual([{ e: "picked", item: "sort_cards", by: "s2" }]);
      input(t, "cover_lock", "1356", "s2");
      expect(submit(t, "cover_lock", "s2")).toEqual([
        { e: "solved", lockId: "cover_lock", by: "s2" },
        { e: "say", lineId: "cover_open" },
      ]);
      stageNow();
      for (const [card, bin] of Object.entries(SORT)) place(t, card, bin);
      expect(submit(t, "board_lock")).toEqual([
        { e: "solved", lockId: "board_lock", by: "s1" },
        { e: "say", lineId: "board_done" },
      ]);
      expect(t.s.flags.has("safe_unlocked")).toBe(true);
      stageNow();
      expect(press(t, "safe_key_left", "s1")).toEqual([{ e: "coop", objectId: "safe_key_left", by: "s1" }]);
      expect(press(t, "safe_key_right", "s2", 900)).toEqual([
        { e: "coopDone", coopId: "safe_keys" },
        { e: "say", lineId: "safe_open" },
        { e: "finale", step: 0 },
      ]);
      expect(t.s.bag).toContain("memory_chip");
      expect(t.s.phase).toBe("finale");
      stageNow();
      vote(t, "privacy", "s1");
      expect(vote(t, "privacy", "s2")).toEqual([{ e: "finale", step: 1 }]);
      vote(t, "ask_first", "s1");
      const last = vote(t, "ask_first", "s2");
      stageNow();

      expect(t.s.phase).toBe("escaped");
      expect(t.s.firstTry.get("privacy")).toBe(true);
      expect(t.s.wrongAttempts).toBe(0);
      expect(t.s.hintsUsed).toBe(0);
      // the escape lines arrive with the escape, at the class's text level
      expect(last).toEqual([
        {
          e: "escaped",
          lines: counsel.escapeLines.map((id) => ({ speaker: counsel.lines[id].speaker, text: resolveText(counsel.lines[id].text, level) })),
        },
      ]);
      expect(stages).toEqual(["uv", "split", "sort", "coop", "finale", null]);
    }
  });

  it("a lone player can finish too: both drawer halves, a 3-second hold on one key, one vote per step", () => {
    const t = team(["s1"]);
    openCover(t);
    const left = view(t, "drawer_left")?.split;
    const right = view(t, "drawer_right")?.split;
    expect([left?.text, right?.text]).toEqual([obj("drawer_left").split!.text, obj("drawer_right").split!.text]);
    for (const [card, bin] of Object.entries(SORT)) place(t, card, bin);
    submit(t, "board_lock");
    expect(press(t, "safe_key_left", "s1")).toEqual([]); // alone: pressing is not enough
    expect(act(t, { t: "holdStart", sid: "s1", objectId: "safe_key_left" })).toEqual([{ e: "hold", objectId: "safe_key_left", by: "s1", on: true }]);
    act(t, { t: "holdCheck" }, SOLO_HOLD_MS);
    expect(t.s.flags.has("safe_open")).toBe(true);
    vote(t, "privacy", "s1");
    vote(t, "ask_first", "s1");
    expect(t.s.phase).toBe("escaped");
  });

  it("out of order is refused: cover before cabinet, board before cover or without cards, safe before the board", () => {
    // cover before the cabinet: no input is kept, a submit does nothing (not even a wrong attempt)
    const t = team();
    makeUvLight(t);
    expect(view(t, "sort_board")?.lockId).toBeUndefined();
    input(t, "cover_lock", "1356");
    expect(t.s.lockInput.get("cover_lock")).toBe("0000");
    expect(submit(t, "cover_lock")).toEqual([]);
    // board before the cover
    expect(place(t, "festival", "ok")).toEqual([]);
    expect(t.s.board.size).toBe(0);
    expect(submit(t, "board_lock")).toEqual([]);
    // the cards and the drawer halves wait for the cabinet
    expect(pickup(t, "cabinet")).toEqual([]);
    expect(view(t, "cabinet")?.canPickup).toBeUndefined();
    expect(view(t, "drawer_left")?.split).toBeUndefined();
    expect(view(t, "drawer_left")?.body).toBe("서랍이 잠겨 있어요. 캐비닛 안에 열쇠가 있을지도 몰라요.");
    // the safe before the board
    expect(press(t, "safe_key_left", "s1")).toEqual([]);
    expect(press(t, "safe_key_right", "s2", 300)).toEqual([]);
    expect(t.s.flags.has("safe_open")).toBe(false);
    // the last door before the safe
    expect(vote(t, "privacy", "s1")).toEqual([]);
    expect(t.s.phase).toBe("play");
    expect(t.s.flags.has("solved:cover_lock") || t.s.flags.has("solved:board_lock")).toBe(false);
    expect(t.s.wrongAttempts).toBe(0);

    // board without the cards: cover open, cards left in the cabinet
    const u = team();
    openCover(u, false);
    expect(u.s.flags.has("solved:cover_lock")).toBe(true);
    expect(place(u, "festival", "ok")).toEqual([]);
    expect(submit(u, "board_lock")).toEqual([]);
    expect(u.s.flags.has("solved:board_lock")).toBe(false);
    pickup(u, "cabinet");
    expect(view(u, "sort_board")?.lockId).toBe("board_lock");
    // and the safe still needs the board
    expect(press(u, "safe_key_left", "s1")).toEqual([]);
    expect(u.s.flags.has("safe_open")).toBe(false);
  });

  it("wrong answers count, and each wrong persuasion choice explains itself", () => {
    const t = team();
    makeUvLight(t);
    input(t, "cabinet_lock", "5283"); // the public notes' digits: the wrong judgement
    expect(submit(t, "cabinet_lock")).toEqual([{ e: "wrong", lockId: "cabinet_lock" }]);
    input(t, "cabinet_lock", "4719");
    submit(t, "cabinet_lock");
    pickup(t, "cabinet");
    input(t, "cover_lock", "0000"); // 가 · 밀 · 나 · 께
    expect(submit(t, "cover_lock")).toEqual([{ e: "wrong", lockId: "cover_lock" }]);
    input(t, "cover_lock", "1356");
    submit(t, "cover_lock");
    for (const card of Object.keys(SORT)) place(t, card, "ok"); // "everything may be shared": 4 wrong
    expect(submit(t, "board_lock")).toEqual([{ e: "wrong", lockId: "board_lock", wrongCount: 4 }]);
    expect(t.s.wrongAttempts).toBe(3);

    for (const step of counsel.finale.steps) {
      for (const o of step.options) {
        if (o.id === step.correct) expect(o.explain, o.id).toBeUndefined();
        else expect(o.explain?.trim().length ?? 0, o.id).toBeGreaterThan(10);
      }
    }
    // a wrong first choice: firstTry.privacy stays false even after the team gets it right
    const u = team();
    openSafe(u);
    vote(u, "transparency", "s1");
    const wrong = vote(u, "transparency", "s2");
    expect(wrong).toEqual([
      { e: "finaleWrong", stepId: counsel.finale.steps[0].id, optionId: "transparency", explain: counsel.finale.steps[0].options.find((o) => o.id === "transparency")!.explain },
    ]);
    expect(u.s.firstTry.get("privacy")).toBe(false);
  });

  it("the cabinet answer equals the hidden digits of the private notes in note order", () => {
    expect(notes().map((o) => o.id).sort()).toEqual(["note_1", "note_2", "note_3", "note_4", "note_5", "note_6", "note_7", "note_8"]);
    const digits = counsel.objects
      .filter((o) => o.tag === "private")
      .sort(byNoteNumber)
      .map((o) => o.inspect.reveal!.text.slice(-1))
      .join("");
    expect(digits).toBe((lock("cabinet_lock") as DigitsLock).answer);
    expect(digits).toBe("4719");
    expect(counsel.objects.filter((o) => o.tag === "private").map(noteNumber).sort()).toEqual([2, 3, 6, 7]);
    for (const n of notes()) {
      expect(n.inspect.reveal?.item, n.id).toBe("uv_flashlight");
      expect(n.inspect.reveal?.text, n.id).toMatch(/^숨은 숫자 \d$/);
      // 이/가 follows the number as read aloud (2 이, 4 사, 5 오 end in a vowel → 가)
      const particle = [2, 4, 5].includes(noteNumber(n)) ? "가" : "이";
      expect(n.inspect.back, n.id).toBe(`쪽지 뒷면 구석에 작은 숫자 ${noteNumber(n)}${particle} 적혀 있어요.`);
      expect(n.tag === "private" || n.tag === "public", n.id).toBe(true);
    }
    // the UV text shows only while the team bag holds the UV light
    const t = team();
    expect(view(t, "note_3")?.reveal).toBeUndefined();
    makeUvLight(t);
    expect(view(t, "note_3")?.reveal).toBe("숨은 숫자 7");
  });

  it("split drawers (동의먼저): two members each read one half after the cabinet opens", () => {
    const t = team();
    openCabinet(t);
    const lockedFor = (name: string) => "글씨가 흐릿해요. 이 쪽지는 {owner}님만 읽을 수 있어요.".replace("{owner}", name);
    expect(view(t, "drawer_left", "s1")?.split).toEqual({ text: "동 ○ 먼 ○" });
    expect(view(t, "drawer_right", "s1")?.split).toEqual({ lockedText: lockedFor("나래") });
    expect(view(t, "drawer_right", "s2")?.split).toEqual({ text: "○ 의 ○ 저" });
    expect(view(t, "drawer_left", "s2")?.split).toEqual({ lockedText: lockedFor("가람") });
    // the letter lock's answer is the two halves put together, read off its wheels
    const cover = lock("cover_lock");
    expect(cover.kind === "letters" && cover.answer).toEqual(["동", "의", "먼", "저"]);
    expect(cover.kind === "letters" && cover.answer.map((l, i) => cover.wheels[i].indexOf(l)).join("")).toBe("1356");
  });

  it("the sort answer: school news and my own drawing may be shared; a friend's details stop", () => {
    expect(board.answer).toEqual(SORT);
    expect(board.bins).toEqual([
      { id: "ok", label: "공개해도 돼요" },
      { id: "stop", label: "멈춰요" },
    ]);
    expect(Object.fromEntries(board.cards.map((c) => [c.id, c.label]))).toEqual({
      festival: "학교 축제 날짜",
      lunch: "이번 주 급식 메뉴",
      club_notice: "동아리 모집 포스터",
      my_drawing: "내가 올리기로 한 내 그림",
      phone_number: "친구 전화번호",
      address: "친구네 집 주소",
      medical: "친구의 병원 기록",
      password: "친구의 비밀번호",
    });
    expect(board.needsItem).toBe("sort_cards");
  });

  it("answer-independent presentation: the public card and option order is mixed and pinned", () => {
    for (const level of ["easy", "hard"] as const) {
      const c = publicContent(counsel, level);
      const pub = c.locks.find((l) => l.id === "board_lock");
      const cards = pub?.kind === "sort" ? pub.cards.map((x) => x.id) : [];
      // pinned (FNV-1a order of the ids; club and phone were renamed until it mixed well)
      expect(cards).toEqual(["festival", "lunch", "medical", "password", "club_notice", "address", "my_drawing", "phone_number"]);
      const bins = cards.map((id) => (SORT[id] === "ok" ? "O" : "S")).join("");
      expect(bins).toBe("OOSSOSOS");
      expect(["OOOOSSSS", "SSSSOOOO"]).not.toContain(bins);
      expect(bins).not.toMatch(/OOO|SSS/); // never three of one kind in a row

      // the right option is never listed first (step ids were renamed until it was not)
      expect(c.finale.steps.map((st) => st.id)).toEqual(["pick_principle", "tell_ari"]);
      expect(c.finale.steps.map((st) => st.options.map((o) => o.id))).toEqual([
        ["transparency", "privacy", "reliability", "fairness"],
        ["no_name_ok", "ask_first", "funny_ok"],
      ]);
      counsel.finale.steps.forEach((step, i) => expect(c.finale.steps[i].options[0].id, step.id).not.toBe(step.correct));
    }
  });

  it("finale: two steps, privacy then ask_first, option ids unique across steps, 7대 원칙 labels", () => {
    expect(counsel.finale.requires).toEqual({ all: ["finale_ready"] });
    expect(counsel.finale.steps.map((st) => [st.id, st.principleId, st.correct])).toEqual([
      ["pick_principle", "privacy", "privacy"],
      ["tell_ari", undefined, "ask_first"],
    ]);
    const ids = counsel.finale.steps.flatMap((st) => st.options.map((o) => o.id));
    expect(new Set(ids).size).toBe(ids.length);
    // step 1 offers principles of the cited document, with their official labels
    const labelOf = new Map(PRINCIPLES.map((p) => [p.id as string, p.label]));
    for (const o of counsel.finale.steps[0].options) {
      expect(labelOf.get(o.id), o.id).toBe(o.label);
      expect(o.desc?.length ?? 0, o.id).toBeGreaterThan(5);
    }
    // 공공성 is not offered: it reads like the value 사회의 공공선 and would confuse
    expect(counsel.finale.steps[0].options.map((o) => o.label)).not.toContain("공공성");
  });

  it("every object has a COUNSEL_ANCHORS anchor, and every COUNSEL_VISUALS flag is producible by the def", () => {
    expect(counsel.objects.map((o) => o.id).sort()).toEqual(COUNSEL_ANCHORS.map((a) => a.id).sort());
    expect(new Set(counsel.objects.map((o) => o.id)).size).toBe(counsel.objects.length);

    const producible = new Set<string>(["escaped"]);
    for (const o of counsel.objects) if (o.pickup) producible.add(`picked:${o.pickup.item}`);
    for (const c of counsel.combos) producible.add(`made:${c.out}`);
    for (const l of counsel.locks) producible.add(`solved:${l.id}`);
    for (const c of counsel.coops) producible.add(c.doneFlag);
    for (const effects of [...counsel.locks.map((l) => l.onSolve), ...counsel.coops.map((c) => c.onSolve)])
      for (const ef of effects) if ("set" in ef) producible.add(ef.set);
    for (const v of COUNSEL_VISUALS) expect(producible.has(v.flag), v.flag).toBe(true);

    // and the golden path really sets every one of them
    const t = team();
    persuade(t);
    for (const v of COUNSEL_VISUALS) expect(t.s.flags.has(v.flag), v.flag).toBe(true);
    // the switches are the coop's, on the two side walls
    expect(counsel.coops[0].switches).toEqual(["safe_key_left", "safe_key_right"]);
    for (const id of counsel.coops[0].switches) expect(obj(id).kind).toBe("switch");
    expect(obj("exit_door").kind).toBe("door");
    expect(obj("counsel_screen").kind).toBe("screen");
  });

  it("notes, claim, intro_2, escape_1 and the summary have both easy and hard text", () => {
    for (const n of notes()) expectTwoLevels(n.inspect.body, n.id);
    expectTwoLevels(counsel.finale.claim, "claim");
    expectTwoLevels(counsel.lines.intro_2.text, "intro_2");
    expectTwoLevels(counsel.lines.escape_1.text, "escape_1");
    counsel.summary.lines.forEach((l, i) => expectTwoLevels(l, `summary ${i + 1}`));
    expectTwoLevels(counsel.summary.question, "summary question");
    expectTwoLevels(obj("counsel_screen").inspect.body, "counsel_screen");
    expect(counsel.summary.source).toBe(`${PRINCIPLE_SOURCE} — 7대 원칙 '프라이버시 보호'`);
    // the levels really reach the players
    const easy = team(["s1", "s2"], "easy");
    const hard = team(["s1", "s2"], "hard");
    expect(view(easy, "note_7")?.body).toBe("요즘 부모님이 자주 다투셔서 집에 가기 싫어요. — 4학년 2반 하늘");
    expect(view(hard, "note_7")?.body).toBe("최근 부모님 다툼이 잦아 집에 가기가 힘듭니다. — 4학년 2반 하늘");
    expect(publicContent(counsel, "hard").lines.intro_2.text).toBe(resolveText(counsel.lines.intro_2.text, "hard"));
  });

  it("story lines: intro then escape, set on a bright day, escape lines held back until the escape", () => {
    expect(counsel.introLines).toEqual(["intro_1", "intro_2", "intro_3", "intro_4"]);
    expect(counsel.escapeLines).toEqual(["escape_1", "escape_2"]);
    expect(resolveText(counsel.lines.intro_1.text, "easy")).toContain("낮");
    const story = [...counsel.introLines, ...counsel.escapeLines].flatMap((id) => {
      const t = counsel.lines[id].text;
      return typeof t === "string" ? [t] : [t.easy, t.hard];
    });
    for (const line of story) expect(line).not.toMatch(/밤|달빛|별빛|별이|달이/);
    for (const level of ["easy", "hard"] as const) {
      const lines = publicContent(counsel, level).lines;
      for (const id of counsel.escapeLines) expect(lines).not.toHaveProperty(id);
      // no public text names the cover-lock word before the team finds it
      for (const s of allStrings(publicContent(counsel, level))) expect(s).not.toContain("동의");
    }
  });

  it("5 stages × 3 hints; publicContent(counsel) contains none of secretStrings(counsel)", () => {
    expect(counsel.stages.map((st) => [st.id, st.doneWhen])).toEqual([
      ["uv", "solved:cabinet_lock"],
      ["split", "solved:cover_lock"],
      ["sort", "solved:board_lock"],
      ["coop", "safe_open"],
      ["finale", "escaped"],
    ]);
    for (const st of counsel.stages) {
      expect(st.hints).toHaveLength(3);
      for (const h of st.hints) expect(h.trim().length, st.id).toBeGreaterThan(10);
      expect(new Set(st.hints).size, st.id).toBe(3);
    }
    const secrets = secretStrings(counsel);
    expect(secrets).toEqual(expect.arrayContaining(["4719", "동의먼저", "동 ○ 먼 ○", "○ 의 ○ 저", "숨은 숫자 4"]));
    for (const level of ["easy", "hard"] as const) {
      const strings = allStrings(publicContent(counsel, level));
      const leaked = secrets.filter((sec) => strings.some((p) => p.includes(sec)));
      expect(leaked, level).toEqual([]);
    }
    // the first hint request gives the first stage's first hint
    const t = team();
    expect(act(t, { t: "hint", sid: "s1" })).toEqual([{ e: "hint", stageId: "uv", tier: 1, text: counsel.stages[0].hints[0] }]);
  });

  it("no source file in shared/ or client/ carries a counsel secret (answers live only in rooms/counsel.ts)", () => {
    const root = resolve(__dirname, "..", "..", "..", ".."); // server/src/escape/rooms → repo root
    const needles = bundleNeedles(counsel);
    expect(needles.length).toBeGreaterThan(20);
    // the needles never fire on the public content itself (E9)
    for (const p of publicStrings(counsel)) expect(needles.filter((n) => n.test(JSON.stringify(p))).map(String), p).toEqual([]);
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        if (e.name === "node_modules") continue;
        const p = join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.(ts|tsx|js|mjs|json|css|html)$/.test(e.name)) files.push(p);
      }
    };
    walk(join(root, "shared", "src"));
    walk(join(root, "client", "src"));
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((f) => {
      const text = readFileSync(f, "utf8");
      return needles.filter((n) => n.test(text)).map((n) => `${f}: ${String(n).slice(0, 40)}`);
    });
    expect(hits).toEqual([]);
  });

  it("contains none of the reference project's world names", () => {
    const strings = allStrings(counsel);
    expect(strings.length).toBeGreaterThan(100);
    for (const s of strings) for (const w of ["네오시티", "닥터 카오스", "비토", "윤리 코어"]) expect(s).not.toContain(w);
  });
});
