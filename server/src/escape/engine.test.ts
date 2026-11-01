import { beforeEach, describe, expect, it } from "vitest";
import { HINT_GAP_MS, LOCK_SUBMIT_GAP_MS } from "@caysonverse/shared/escape/constants";
import {
  applyAction,
  applyEffects,
  createEngineState,
  currentStage,
  holds,
  inspectView,
  type EngineAction,
  type EngineCtx,
  type EngineState,
} from "./engine";
import { miniRoom } from "./__fixtures__/miniRoom";
import type { RoomDef } from "./types";

const def = miniRoom;
let s: EngineState;
let ctx: EngineCtx;

beforeEach(() => {
  s = createEngineState(def);
  ctx = { now: 0, connected: ["p1", "p2"], names: new Map([["p1", "가람"], ["p2", "나래"]]), maxHintTier: 3, level: "easy" };
});

const act = (a: EngineAction, d: RoomDef = def) => applyAction(d, s, a, ctx);
const pickup = (objectId: string, sid = "p1") => act({ t: "pickup", sid, objectId });
const input = (lockId: string, value: string, sid = "p1") => act({ t: "input", sid, lockId, value });
const place = (lockId: string, cardId: string, bin: string, sid = "p1") => act({ t: "place", sid, lockId, cardId, bin });
const submit = (lockId: string, sid = "p1") => act({ t: "submit", sid, lockId });
const hint = () => act({ t: "hint", sid: "p1" });
/** Moves game time past the submit gap so the next submit counts. */
const later = (ms = LOCK_SUBMIT_GAP_MS) => {
  ctx.now += ms;
};

function makeAb(): void {
  pickup("shelf");
  pickup("drawer");
  act({ t: "combine", sid: "p1", a: "a", b: "b" });
}
function solveDigits(): void {
  makeAb();
  input("lk_d", "123");
  submit("lk_d");
  later();
}
function solveLetters(): void {
  solveDigits();
  input("lk_l", "11");
  submit("lk_l");
  later();
}

describe("createEngineState / holds", () => {
  it("starts in play with an empty bag and every code lock at its zero position", () => {
    expect(s.phase).toBe("play");
    expect(s.bag).toEqual([]);
    expect(s.flags.size).toBe(0);
    expect(s.lockInput.get("lk_d")).toBe("000");
    expect(s.lockInput.get("lk_l")).toBe("00");
    expect(s.lockInput.has("lk_s")).toBe(false);
    expect(s.board.size).toBe(0);
    expect([s.wrongAttempts, s.hintsUsed, s.finaleStep]).toEqual([0, 0, 0]);
    expect(s.hold).toBeNull();
  });

  it("applyEffects runs set, give (once), take and say in order", () => {
    s.bag.push("a");
    const events = applyEffects(def, s, [
      { set: "door_lit" },
      { give: "cards" },
      { give: "cards" },
      { say: "made_ab" },
      { take: "a" },
      { say: "solved_d" },
    ]);
    expect(events).toEqual([
      { e: "say", lineId: "made_ab" },
      { e: "say", lineId: "solved_d" },
    ]);
    expect(s.bag).toEqual(["cards"]);
    expect(s.flags.has("door_lit")).toBe(true);
    expect(s.phase).toBe("play");
  });

  it("holds checks all, none and items; no condition always holds", () => {
    expect(holds(undefined, s)).toBe(true);
    expect(holds({}, s)).toBe(true);
    s.flags.add("f");
    s.bag.push("i");
    expect(holds({ all: ["f"], none: ["g"], items: ["i"] }, s)).toBe(true);
    expect(holds({ all: ["f", "g"] }, s)).toBe(false);
    expect(holds({ none: ["f"] }, s)).toBe(false);
    expect(holds({ items: ["i", "j"] }, s)).toBe(false);
  });
});

describe("applyAction", () => {
  it("pickup adds once and sets picked:<item>; respects pickup.when", () => {
    // drawer's b can only be taken after a (when: picked:a)
    expect(pickup("drawer")).toEqual([]);
    expect(s.bag).toEqual([]);

    expect(pickup("shelf", "p2")).toEqual([{ e: "picked", item: "a", by: "p2" }]);
    expect(s.bag).toEqual(["a"]);
    expect(s.flags.has("picked:a")).toBe(true);

    expect(pickup("shelf")).toEqual([]); // already picked: nothing twice
    expect(s.bag).toEqual(["a"]);

    expect(pickup("drawer")).toEqual([{ e: "picked", item: "b", by: "p1" }]);
    expect(s.bag).toEqual(["a", "b"]);
    expect(pickup("panel")).toEqual([]); // no pickup on this object
    expect(pickup("nope")).toEqual([]);
  });

  it("combine needs both items, works in either order, removes inputs and sets made:<out>", () => {
    pickup("shelf");
    expect(act({ t: "combine", sid: "p1", a: "a", b: "b" })).toEqual([]); // b not in the bag yet
    expect(s.bag).toEqual(["a"]);
    pickup("drawer");
    expect(act({ t: "combine", sid: "p1", a: "a", b: "a" })).toEqual([]); // no such combo

    // reversed order (b, a) still matches the combo (a, b); its effects run
    expect(act({ t: "combine", sid: "p2", a: "b", b: "a" })).toEqual([
      { e: "combined", out: "ab", by: "p2" },
      { e: "say", lineId: "made_ab" },
    ]);
    expect(s.bag).toEqual(["ab"]);
    expect(s.flags.has("made:ab")).toBe(true);
    expect(act({ t: "combine", sid: "p1", a: "a", b: "b" })).toEqual([]); // inputs are gone
  });

  it("input is validated per kind and is the shared value", () => {
    // digits: wrong format is ignored
    input("lk_d", "12");
    expect(s.lockInput.get("lk_d")).toBe("000");
    // the lock is not usable before its requires (ab in the bag)
    input("lk_d", "123");
    expect(s.lockInput.get("lk_d")).toBe("000");

    makeAb();
    for (const bad of ["1234", "12a", " 123", "\uFF11\uFF12\uFF13", ""]) input("lk_d", bad);
    expect(s.lockInput.get("lk_d")).toBe("000");
    input("lk_d", "123");
    expect(s.lockInput.get("lk_d")).toBe("123");
    // shared: the other player's turn of the wheels replaces the one team value
    input("lk_d", "456", "p2");
    expect(s.lockInput.get("lk_d")).toBe("456");
    act({ t: "input", sid: "p1", lockId: "lk_d", value: 123 as unknown as string });
    expect(s.lockInput.get("lk_d")).toBe("456");

    // letters: one digit per wheel, each below that wheel's length (2 letters → 0 or 1)
    input("lk_l", "11");
    expect(s.lockInput.get("lk_l")).toBe("00"); // requires solved:lk_d
    input("lk_d", "123");
    submit("lk_d");
    for (const bad of ["1", "111", "12", "21", "1a"]) input("lk_l", bad);
    expect(s.lockInput.get("lk_l")).toBe("00");
    input("lk_l", "10", "p2");
    expect(s.lockInput.get("lk_l")).toBe("10");

    // a solved lock no longer takes input; a sort lock never does
    input("lk_d", "999");
    expect(s.lockInput.get("lk_d")).toBe("123");
    input("lk_s", "00");
    expect(s.lockInput.has("lk_s")).toBe(false);
  });

  it("submit: wrong counts once; right sets solved:<id> and runs onSolve", () => {
    makeAb();
    input("lk_d", "999");
    expect(submit("lk_d")).toEqual([{ e: "wrong", lockId: "lk_d" }]);
    expect(s.wrongAttempts).toBe(1);
    expect(s.flags.has("solved:lk_d")).toBe(false);

    later();
    input("lk_d", "123");
    expect(submit("lk_d", "p2")).toEqual([
      { e: "solved", lockId: "lk_d", by: "p2" },
      { e: "say", lineId: "solved_d" },
    ]);
    expect(s.flags.has("solved:lk_d")).toBe(true);
    expect(s.wrongAttempts).toBe(1);

    // letters: wheel indexes "11" read 나/라 = the answer; onSolve gives the cards
    later();
    input("lk_l", "01");
    expect(submit("lk_l")).toEqual([{ e: "wrong", lockId: "lk_l" }]);
    expect(s.wrongAttempts).toBe(2);
    later();
    input("lk_l", "11");
    expect(submit("lk_l")).toEqual([{ e: "solved", lockId: "lk_l", by: "p1" }]);
    expect(s.bag).toContain("cards");
  });

  it("a second submit inside LOCK_SUBMIT_GAP_MS is ignored (Review Focus 3)", () => {
    makeAb();
    input("lk_d", "999");
    // two players press "열기" at the same moment: one wrong attempt
    expect(submit("lk_d", "p1")).toEqual([{ e: "wrong", lockId: "lk_d" }]);
    expect(submit("lk_d", "p2")).toEqual([]);
    expect(s.wrongAttempts).toBe(1);

    // still inside the gap: even the right answer is not judged yet
    ctx.now += LOCK_SUBMIT_GAP_MS - 1;
    input("lk_d", "123");
    expect(submit("lk_d")).toEqual([]);
    expect(s.flags.has("solved:lk_d")).toBe(false);
    expect(s.wrongAttempts).toBe(1);

    // exactly the gap after the counted submit: judged again
    ctx.now += 1;
    expect(submit("lk_d")).toEqual([
      { e: "solved", lockId: "lk_d", by: "p1" },
      { e: "say", lineId: "solved_d" },
    ]);
  });

  it("submit is ignored before requires hold and after solved", () => {
    expect(submit("lk_d")).toEqual([]); // ab not in the bag
    expect(submit("lk_l")).toEqual([]); // lk_d not solved
    expect(submit("nope")).toEqual([]);
    expect(s.wrongAttempts).toBe(0);
    // an ignored submit does not start the gap: the first real one right after is judged
    makeAb();
    input("lk_d", "123");
    expect(submit("lk_d")[0]).toEqual({ e: "solved", lockId: "lk_d", by: "p1" });

    later();
    const bagBefore = [...s.bag];
    expect(submit("lk_d")).toEqual([]); // already solved: onSolve does not run twice
    expect(s.bag).toEqual(bagBefore);
    expect(s.wrongAttempts).toBe(0);
  });

  it("sort: unplaced cards report `unplaced` without a wrong attempt; wrong placement reports wrongCount", () => {
    // without the cards in the bag nothing can be placed or submitted
    expect(place("lk_s", "c1", "x")).toEqual([]);
    expect(s.board.size).toBe(0);
    expect(submit("lk_s")).toEqual([]);

    solveLetters();
    expect(s.bag).toContain("cards");
    expect(submit("lk_s")).toEqual([{ e: "wrong", lockId: "lk_s", unplaced: 2 }]);
    expect(s.wrongAttempts).toBe(0);

    later();
    place("lk_s", "c1", "y");
    expect(submit("lk_s")).toEqual([{ e: "wrong", lockId: "lk_s", unplaced: 1 }]);
    later();
    place("lk_s", "c2", "y", "p2");
    expect(s.board.get("c2")).toBe("y");
    expect(submit("lk_s")).toEqual([{ e: "wrong", lockId: "lk_s", wrongCount: 1 }]);
    expect(s.wrongAttempts).toBe(1);

    // unknown card / bin is ignored; bin "" takes a card back off the board
    place("lk_s", "c9", "x");
    place("lk_s", "c1", "z");
    expect(s.board.get("c1")).toBe("y");
    expect(s.board.has("c9")).toBe(false);
    place("lk_s", "c1", "");
    expect(s.board.has("c1")).toBe(false);
    place("lk_s", "c1", "x");
    later();
    expect(submit("lk_s")[0]).toEqual({ e: "solved", lockId: "lk_s", by: "p1" });
    expect(s.flags.has("ready")).toBe(true);
    // the board of a solved lock is frozen
    place("lk_s", "c1", "y");
    expect(s.board.get("c1")).toBe("x");
  });

  it("an effect that satisfies finale.requires switches phase to 'finale'", () => {
    solveLetters();
    place("lk_s", "c1", "x");
    place("lk_s", "c2", "y");
    s.votes.set("p1", "o2"); // stale votes are cleared on the switch
    expect(s.phase).toBe("play");
    expect(submit("lk_s")).toEqual([
      { e: "solved", lockId: "lk_s", by: "p1" },
      { e: "finale", step: 0 },
    ]);
    expect(s.phase).toBe("finale");
    expect(s.finaleStep).toBe(0);
    expect(s.votes.size).toBe(0);
  });

  it("a pickup or combine that satisfies finale.requires also switches to 'finale' (once)", () => {
    const byItem: RoomDef = { ...def, finale: { ...def.finale, requires: { items: ["a"] } } };
    expect(act({ t: "pickup", sid: "p1", objectId: "shelf" }, byItem)).toEqual([
      { e: "picked", item: "a", by: "p1" },
      { e: "finale", step: 0 },
    ]);
    expect(s.phase).toBe("finale");
    // already in the finale: a later effect does not restart it
    s.finaleStep = 1;
    expect(act({ t: "pickup", sid: "p1", objectId: "drawer" }, byItem)).toEqual([{ e: "picked", item: "b", by: "p1" }]);
    expect(act({ t: "combine", sid: "p1", a: "a", b: "b" }, byItem)).toEqual([
      { e: "combined", out: "ab", by: "p1" },
      { e: "say", lineId: "made_ab" },
    ]);
    expect(s.finaleStep).toBe(1);
  });

  it("hints: tier 1→2→3, HINT_GAP_MS between tiers, maxHintTier cap, hintsUsed counts, next stage restarts at tier 1", () => {
    const [h1, h2, h3] = def.stages[0].hints;
    ctx.now = 10_000;
    expect(hint()).toEqual([{ e: "hint", stageId: "st_items", tier: 1, text: h1 }]);
    expect(s.hintsUsed).toBe(1);

    ctx.now += 1000; // 29 s left → rounded up
    expect(hint()).toEqual([{ e: "hintWait", waitS: 29 }]);
    ctx.now += HINT_GAP_MS - 1000 - 1;
    expect(hint()).toEqual([{ e: "hintWait", waitS: 1 }]);
    expect(s.hintsUsed).toBe(1);
    ctx.now += 1;
    expect(hint()).toEqual([{ e: "hint", stageId: "st_items", tier: 2, text: h2 }]);
    ctx.now += HINT_GAP_MS;
    expect(hint()).toEqual([{ e: "hint", stageId: "st_items", tier: 3, text: h3 }]);
    ctx.now += HINT_GAP_MS;
    expect(hint()).toEqual([{ e: "hintMax" }]);
    expect(s.hintsUsed).toBe(3);

    // the next stage starts again at tier 1, without waiting for the gap
    makeAb();
    expect(hint()).toEqual([{ e: "hint", stageId: "st_locks", tier: 1, text: def.stages[1].hints[0] }]);
    expect(s.hintsUsed).toBe(4);

    // a lower cap from the class (maxHintTier) stops earlier
    s = createEngineState(def);
    ctx = { ...ctx, now: 0, maxHintTier: 2 };
    hint();
    ctx.now += HINT_GAP_MS;
    hint();
    ctx.now += HINT_GAP_MS;
    expect(hint()).toEqual([{ e: "hintMax" }]);
    expect(s.hintsUsed).toBe(2);
    ctx.maxHintTier = 0;
    makeAb();
    expect(hint()).toEqual([{ e: "hintMax" }]);
  });

  it("currentStage is the first stage whose doneWhen flag is unset", () => {
    expect(currentStage(def, s)?.id).toBe("st_items");
    s.flags.add("solved:lk_l"); // a later stage's flag alone does not move the stage
    expect(currentStage(def, s)?.id).toBe("st_items");
    s.flags.add("made:ab");
    expect(currentStage(def, s)?.id).toBe("st_sort");
    s.flags.add("ready");
    expect(currentStage(def, s)).toBeNull();
    expect(hint()).toEqual([]); // no stage left: no hint
    expect(s.hintsUsed).toBe(0);
  });

  it("does nothing once escaped", () => {
    s.phase = "escaped";
    s.bag.push("a", "b", "ab", "cards");
    const actions: EngineAction[] = [
      { t: "pickup", sid: "p1", objectId: "shelf" },
      { t: "combine", sid: "p1", a: "a", b: "b" },
      { t: "input", sid: "p1", lockId: "lk_d", value: "123" },
      { t: "place", sid: "p1", lockId: "lk_s", cardId: "c1", bin: "x" },
      { t: "submit", sid: "p1", lockId: "lk_d" },
      { t: "hint", sid: "p1" },
    ];
    for (const a of actions) expect(act(a), a.t).toEqual([]);
    expect(s.bag).toEqual(["a", "b", "ab", "cards"]);
    expect(s.lockInput.get("lk_d")).toBe("000");
    expect(s.board.size).toBe(0);
    expect([s.hintsUsed, s.flags.size]).toEqual([0, 0]);
  });
});

describe("inspectView", () => {
  const view = (objectId: string, level: "easy" | "hard" = "easy") => inspectView(def, s, objectId, "p1", ctx, level);

  it("inspectView picks the first matching state body, shows reveal only with the item", () => {
    expect(view("panel")?.body).toBe("숫자 칸과 글자 칸이 있는 판이에요.");
    s.flags.add("solved:lk_d");
    expect(view("panel")?.body).toBe("숫자 칸이 열렸어요.");
    s.flags.add("solved:lk_l"); // both states match → the first one
    expect(view("panel")?.body).toBe("판이 모두 열렸어요.");

    expect(view("poster")).toEqual({
      objectId: "poster",
      title: "벽 포스터",
      body: "평범한 학급 안내 포스터예요.",
      back: "뒷면은 비어 있어요.",
      image: "poster",
    });
    s.bag.push("ab");
    expect(view("poster")?.reveal).toBe("숨은 글씨: 첫 바퀴는 둘째 글자, 둘째 바퀴도 둘째 글자");
    expect(view("poster", "hard")).toMatchObject({ title: "게시판 포스터", back: "뒷면에는 아무것도 적혀 있지 않다." });
    expect(view("nope")).toBeNull();
  });

  it("canPickup only while the pickup is possible; lockId is the first visible unsolved lock", () => {
    expect(view("shelf")?.canPickup).toBe("a");
    expect(view("drawer")).toEqual({ objectId: "drawer", title: "서랍", body: "서랍 안에 보라색 필름이 있어요." }); // needs picked:a
    expect(view("drawer", "hard")?.body).toBe("서랍 속에 얇은 보라색 필름 한 장이 놓여 있다.");
    pickup("shelf");
    expect(view("shelf")?.canPickup).toBeUndefined(); // already in the bag
    expect(view("drawer")?.canPickup).toBe("b");
    pickup("drawer");
    expect(view("drawer")).toMatchObject({ body: "서랍이 텅 비었어요." });
    expect(view("drawer")?.canPickup).toBeUndefined();

    expect(view("panel")?.lockId).toBeUndefined(); // lk_d needs ab
    act({ t: "combine", sid: "p1", a: "a", b: "b" });
    expect(view("panel")?.lockId).toBe("lk_d");
    input("lk_d", "123");
    submit("lk_d");
    expect(view("panel")?.lockId).toBe("lk_l");
    later();
    input("lk_l", "11");
    submit("lk_l");
    expect(view("panel")?.lockId).toBeUndefined(); // both solved
    expect(view("board")?.lockId).toBe("lk_s"); // no requires
  });
});
