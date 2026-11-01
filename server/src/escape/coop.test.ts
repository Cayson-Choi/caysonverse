import { beforeEach, describe, expect, it } from "vitest";
import { COOP_WINDOW_MS, FINALE_COOLDOWN_MS, SOLO_HOLD_MS } from "@caysonverse/shared/escape/constants";
import {
  applyAction,
  applyEffects,
  createEngineState,
  inspectView,
  type EngineAction,
  type EngineCtx,
  type EngineEvent,
  type EngineState,
} from "./engine";
import { cancelHold, isSolo, splitGroups } from "./coop";
import { miniRoom } from "./__fixtures__/miniRoom";
import type { RoomDef } from "./types";

const def = miniRoom;
const NAMES: ReadonlyMap<string, string> = new Map([
  ["s1", "가람"],
  ["s2", "나래"],
  ["s3", "다온"],
  ["s1b", "가람"], // s1 again after a refresh (a new sessionId)
]);

let room: RoomDef;
let s: EngineState;
let ctx: EngineCtx;

/** A fresh team. The coop `co` is open (lk_d solved) unless `open` is false. */
function reset(connected: readonly string[] = ["s1", "s2"], open = true, d: RoomDef = def): void {
  room = d;
  s = createEngineState(d);
  if (open) s.flags.add("solved:lk_d");
  ctx = { now: 0, connected, names: NAMES, maxHintTier: 3 };
}
beforeEach(() => reset());

/** One action at game time `now` with these members; both stay for the next calls, as in a room. */
function act(a: EngineAction, now = ctx.now, connected: readonly string[] = ctx.connected): EngineEvent[] {
  ctx = { ...ctx, now, connected };
  return applyAction(room, s, a, ctx);
}
const press = (sid: string, objectId: string, now = ctx.now, connected?: readonly string[]) =>
  act({ t: "press", sid, objectId }, now, connected);
const holdOn = (sid: string, objectId: string, now = ctx.now) => act({ t: "holdStart", sid, objectId }, now);
const holdOff = (sid: string, objectId: string, now = ctx.now) => act({ t: "holdEnd", sid, objectId }, now);
const check = (now = ctx.now) => act({ t: "holdCheck" }, now);
const membership = (connected: readonly string[], now = ctx.now) => act({ t: "membership" }, now, connected);

/** "right" = the current step's correct option, "wrong" = its first other option, anything else = that option id. */
function option(pick: string): string {
  const step = room.finale.steps[s.finaleStep];
  if (pick === "right") return step.correct;
  if (pick === "wrong") return step.options.find((o) => o.id !== step.correct)!.id;
  return pick;
}
const vote = (sid: string, pick: string, connected?: readonly string[], now = ctx.now) =>
  act({ t: "vote", sid, optionId: option(pick) }, now, connected);

/** Opens the last door the way a room does: an effect makes `finale.requires` (ready) true. */
function toFinale(): void {
  expect(applyEffects(room, s, [{ set: "ready" }])).toEqual([{ e: "finale", step: 0 }]);
}

const half = (objectId: string) => def.objects.find((o) => o.id === objectId)!.split!;
const lockedFor = (owners: string) => half("dA").lockedText.split("{owner}").join(owners);
const view = (objectId: string, viewer: string) => inspectView(room, s, objectId, viewer, ctx, "easy");
const DONE: EngineEvent[] = [
  { e: "coopDone", coopId: "co" },
  { e: "say", lineId: "co_open" },
];

describe("split views (나눠 보기)", () => {
  it("splitGroups: alone sees A and B; others alternate by join order", () => {
    expect(splitGroups(["s1"]).get("s1")).toEqual(["A", "B"]);
    const g = splitGroups(["s1", "s2", "s3"]);
    expect([g.get("s1"), g.get("s2"), g.get("s3")]).toEqual([["A"], ["B"], ["A"]]);
    // join order decides, not the id
    expect([...splitGroups(["s2", "s1"])]).toEqual([
      ["s2", ["A"]],
      ["s1", ["B"]],
    ]);
    expect(splitGroups([]).size).toBe(0);
    // a sessionId listed twice counts once
    expect([...splitGroups(["s1", "s1", "s2"])]).toEqual([
      ["s1", ["A"]],
      ["s2", ["B"]],
    ]);
    expect(splitGroups(["s1", "s1"]).get("s1")).toEqual(["A", "B"]);
    expect([isSolo(["s1"]), isSolo(["s1", "s1"]), isSolo([]), isSolo(["s1", "s2"])]).toEqual([true, true, false, false]);
  });

  it("inspectView shows a half only to its group and names the owners to the others", () => {
    ctx = { ...ctx, connected: ["s1", "s2", "s3"] }; // s1 A · s2 B · s3 A
    const textA = half("dA").text;
    const textB = half("dB").text;

    // dA's half only shows once its `when` holds (picked:a); dB has no `when`
    expect(view("dA", "s1")).toEqual({ objectId: "dA", title: "왼쪽 서랍", body: "반쪽짜리 쪽지가 들어 있어요." });
    expect(view("dB", "s2")?.split).toEqual({ text: textB });
    expect(view("dB", "s1")?.split).toEqual({ lockedText: "글씨가 흐릿해요. 이 쪽지는 나래님만 읽을 수 있어요." });
    expect(view("dB", "s3")?.split).toEqual({ lockedText: lockedFor("나래") });

    act({ t: "pickup", sid: "s1", objectId: "shelf" });
    expect(view("dA", "s1")).toEqual({
      objectId: "dA",
      title: "왼쪽 서랍",
      body: "반쪽짜리 쪽지가 들어 있어요.",
      split: { text: textA },
    });
    expect(view("dA", "s3")?.split).toEqual({ text: textA });
    // the other group gets every owner's nickname, joined with 、
    expect(view("dA", "s2")?.split).toEqual({ lockedText: "글씨가 흐릿해요. 이 쪽지는 가람、다온님만 읽을 수 있어요." });
    // the locked view never carries the half itself, at either level
    for (const level of ["easy", "hard"] as const) {
      expect(JSON.stringify(inspectView(room, s, "dA", "s2", ctx, level))).not.toContain(textA);
      expect(JSON.stringify(inspectView(room, s, "dB", "s1", ctx, level))).not.toContain(textB);
    }
    // someone who is not connected reads nobody's half
    expect(view("dB", "s9")?.split).toEqual({ lockedText: lockedFor("나래") });
    // a nickname is inserted as typed (no replace() patterns such as $&)
    ctx = { ...ctx, names: new Map([...NAMES, ["s2", "$&별$1"]]) };
    expect(view("dB", "s1")?.split).toEqual({ lockedText: lockedFor("$&별$1") });
    // objects without a split never get one
    expect(view("shelf", "s1")).not.toHaveProperty("split");
  });

  it("a member left alone reads both halves; a reconnect splits them again (Review Focus 2)", () => {
    s.flags.add("picked:a");
    membership(["s1", "s2"]);
    expect(view("dA", "s1")?.split).toEqual({ text: half("dA").text });
    expect(view("dB", "s1")?.split).toEqual({ lockedText: lockedFor("나래") });

    membership(["s1"]); // s2 drops
    expect(view("dA", "s1")?.split).toEqual({ text: half("dA").text });
    expect(view("dB", "s1")?.split).toEqual({ text: half("dB").text });

    membership(["s1", "s2"]); // s2 is back
    expect(view("dB", "s1")?.split).toEqual({ lockedText: lockedFor("나래") });
    expect(view("dB", "s2")?.split).toEqual({ text: half("dB").text });

    membership(["s2"]); // s1 drops: s2 now reads A as well
    expect(view("dA", "s2")?.split).toEqual({ text: half("dA").text });
    expect(view("dB", "s2")?.split).toEqual({ text: half("dB").text });
  });
});

describe("simultaneous press (동시 누르기)", () => {
  it("press: two members within COOP_WINDOW_MS complete; 2001 ms apart does not", () => {
    expect(COOP_WINDOW_MS).toBe(2000);
    expect(press("s1", "sw1", 0)).toEqual([{ e: "coop", objectId: "sw1", by: "s1" }]);
    expect(press("s2", "sw2", 2000)).toContainEqual({ e: "coopDone", coopId: "co" });

    reset();
    press("s1", "sw1", 0);
    expect(press("s2", "sw2", 2001)).not.toContainEqual(expect.objectContaining({ e: "coopDone" }));
    expect(s.flags.has("co_done")).toBe(false);
    expect([...s.presses]).toEqual([["sw2", { sid: "s2", at: 2001 }]]); // the stale press is gone
    // a fresh press inside the window completes, in either switch order
    expect(press("s1", "sw1", 2500)).toEqual(DONE);
  });

  it("one member pressing both switches never completes", () => {
    expect(press("s1", "sw1", 0)).toEqual([{ e: "coop", objectId: "sw1", by: "s1" }]);
    expect(press("s1", "sw2", 500)).toEqual([{ e: "coop", objectId: "sw2", by: "s1" }]);
    expect(press("s1", "sw1", 900)).toEqual([{ e: "coop", objectId: "sw1", by: "s1" }]);
    expect(s.flags.has("co_done")).toBe(false);
    expect([...s.presses]).toEqual([["sw1", { sid: "s1", at: 900 }]]); // only their latest switch counts

    // two members on the same switch do not complete either
    expect(press("s2", "sw1", 1000)).toEqual([{ e: "coop", objectId: "sw1", by: "s2" }]);
    expect(s.flags.has("co_done")).toBe(false);
    // the other switch by a different member does
    expect(press("s1", "sw2", 1500)).toEqual(DONE);
  });

  it("press is ignored when alone or before requires hold", () => {
    reset(["s1"]);
    expect(press("s1", "sw1", 0)).toEqual([]);
    expect(press("s1", "sw2", 100)).toEqual([]);
    expect(s.presses.size).toBe(0);
    expect(s.flags.has("co_done")).toBe(false);

    reset(["s1", "s2"], false); // lk_d not solved: the coop is closed
    expect(press("s1", "sw1", 0)).toEqual([]);
    expect(press("s2", "sw2", 100)).toEqual([]);
    expect(s.presses.size).toBe(0);

    // not a switch, a sessionId that is not connected, nobody connected
    reset();
    expect(press("s1", "shelf", 0)).toEqual([]);
    expect(press("s9", "sw1", 0)).toEqual([]);
    expect(press("s1", "sw1", 0, [])).toEqual([]);
    expect(s.presses.size).toBe(0);

    // solving lk_d for real opens it
    reset(["s1", "s2"], false);
    s.bag.push("ab");
    act({ t: "input", sid: "s1", lockId: "lk_d", value: "123" });
    act({ t: "submit", sid: "s1", lockId: "lk_d" });
    expect(press("s1", "sw1", 100)).toEqual([{ e: "coop", objectId: "sw1", by: "s1" }]);
    expect(press("s2", "sw2", 200)).toEqual(DONE);
  });

  it("coopDone sets the done flag, runs onSolve through applyEffects (it can open the last door) and happens once", () => {
    press("s1", "sw1", 0);
    expect(press("s2", "sw2", 10)).toEqual(DONE);
    expect([s.flags.has("co_done"), s.flags.has("box_open")]).toEqual([true, true]);
    expect(s.presses.size).toBe(0);
    expect(press("s1", "sw1", 20)).toEqual([]);
    expect(press("s2", "sw2", 30)).toEqual([]);
    expect(s.presses.size).toBe(0);

    const gated: RoomDef = { ...def, finale: { ...def.finale, requires: { all: ["co_done"] } } };
    reset(["s1", "s2"], true, gated);
    press("s2", "sw2", 0);
    expect(press("s1", "sw1", 10)).toEqual([...DONE, { e: "finale", step: 0 }]);
    expect(s.phase).toBe("finale");
  });
});

describe("solo long press (혼자 길게 누르기)", () => {
  it("solo hold completes at SOLO_HOLD_MS via holdEnd or holdCheck; early release cancels", () => {
    expect(SOLO_HOLD_MS).toBe(3000);
    reset(["s1"]);
    expect(holdOn("s1", "sw1", 0)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: true }]);
    expect(s.hold).toEqual({ coopId: "co", objectId: "sw1", sid: "s1", since: 0 });
    expect(holdOff("s1", "sw1", SOLO_HOLD_MS - 1)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: false }]);
    expect(s.hold).toBeNull();
    expect(s.flags.has("co_done")).toBe(false);
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]); // the room's timer for that hold finds nothing

    // holdEnd at exactly SOLO_HOLD_MS completes
    expect(holdOn("s1", "sw2", 5000)).toEqual([{ e: "hold", objectId: "sw2", by: "s1", on: true }]);
    expect(holdOff("s1", "sw2", 5000 + SOLO_HOLD_MS)).toEqual(DONE);
    expect(s.hold).toBeNull();
    expect([s.flags.has("co_done"), s.flags.has("box_open")]).toEqual([true, true]);

    // holdCheck path: not yet at 2999 ms, done at 3000 ms
    reset(["s1"]);
    holdOn("s1", "sw1", 1000);
    expect(check(1000 + SOLO_HOLD_MS - 1)).toEqual([]);
    expect(s.hold).not.toBeNull();
    expect(check(1000 + SOLO_HOLD_MS)).toEqual(DONE);
    expect(s.hold).toBeNull();
    // the release after holdCheck finished it, and a new hold on a done coop, do nothing
    expect(holdOff("s1", "sw1", 4100)).toEqual([]);
    expect(holdOn("s1", "sw1", 5000)).toEqual([]);
    expect(s.hold).toBeNull();
  });

  it("holdStart needs exactly one connected member and an open coop; a repeated start keeps the first", () => {
    expect(holdOn("s1", "sw1", 0)).toEqual([]); // two members: press, not hold
    expect(s.hold).toBeNull();
    reset(["s1"], false); // coop closed
    expect(holdOn("s1", "sw1", 0)).toEqual([]);
    reset(["s1"]);
    expect(holdOn("s1", "shelf", 0)).toEqual([]);
    expect(holdOn("s2", "sw1", 0)).toEqual([]); // not the connected member
    expect(s.hold).toBeNull();

    // key repeat: another holdStart while holding does not restart the timer
    holdOn("s1", "sw1", 0);
    expect(holdOn("s1", "sw1", 1500)).toEqual([]);
    expect(holdOn("s1", "sw2", 1600)).toEqual([]);
    expect(s.hold?.since).toBe(0);
    expect(check(SOLO_HOLD_MS)).toEqual(DONE);

    // a release of another switch or by someone else leaves the hold alone
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    expect(holdOff("s1", "sw2", 500)).toEqual([]);
    expect(holdOff("s2", "sw1", 500)).toEqual([]);
    expect(s.hold?.since).toBe(0);
    // the timer of a cancelled hold cannot finish a newer hold early
    holdOff("s1", "sw1", 1000);
    holdOn("s1", "sw1", 2000);
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);
    expect(s.hold?.since).toBe(2000);
    expect(check(2000 + SOLO_HOLD_MS + 50)).toEqual(DONE);
  });

  it("a second member connecting cancels an active hold (Review Focus 2)", () => {
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    expect(membership(["s1", "s2"], 1000)).toEqual([
      { e: "hold", objectId: "sw1", by: "s1", on: false },
      { e: "members" },
    ]);
    expect(s.hold).toBeNull();
    // the room's scheduled holdCheck and the late release change nothing
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);
    expect(holdOff("s1", "sw1", 3500)).toEqual([]);
    expect(s.flags.has("co_done")).toBe(false);
    // two members now: the switch is a press again
    expect(holdOn("s1", "sw1", 4000)).toEqual([]);
    press("s1", "sw1", 4000);
    expect(press("s2", "sw2", 4500)).toEqual(DONE);
  });

  it("cancelHold (the room's pause / time up) ends the hold once and its timer then finds nothing", () => {
    expect(cancelHold(s)).toEqual([]); // no hold
    reset(["s1"]);
    holdOn("s1", "sw2", 0);
    expect(cancelHold(s)).toEqual([{ e: "hold", objectId: "sw2", by: "s1", on: false }]);
    expect(s.hold).toBeNull();
    expect(cancelHold(s)).toEqual([]);
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);
    expect(s.flags.has("co_done")).toBe(false);
    // the coop stays open: a new hold after resuming still works
    holdOn("s1", "sw2", 10_000);
    expect(check(10_000 + SOLO_HOLD_MS)).toEqual(DONE);
  });

  it("holdEnd and holdCheck cancel instead of finishing when the holder is no longer alone", () => {
    // even if the room has not reported the join yet, a hold never finishes for a pair
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    ctx = { ...ctx, connected: ["s1", "s2"] };
    expect(check(SOLO_HOLD_MS)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: false }]);
    expect(s.flags.has("co_done")).toBe(false);

    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    ctx = { ...ctx, connected: ["s2"] }; // the holder dropped, someone else is alone
    expect(holdOff("s1", "sw1", SOLO_HOLD_MS)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: false }]);
    expect(s.flags.has("co_done")).toBe(false);
  });
});

describe("persuasion vote (설득 투표)", () => {
  it("vote waits for every connected member; mixed picks resolve nothing", () => {
    reset(["s1", "s2", "s3"]);
    toFinale();
    expect(vote("s1", "right")).toEqual([{ e: "votes" }]);
    expect(vote("s2", "right")).toEqual([{ e: "votes" }]);
    expect(vote("s3", "wrong")).toEqual([{ e: "votes" }]); // mixed
    expect([s.finaleStep, s.wrongAttempts, s.cooldownUntil]).toEqual([0, 0, 0]);
    expect(s.firstTry.size).toBe(0);
    expect(s.votes).toEqual(
      new Map([
        ["s1", "o1"],
        ["s2", "o1"],
        ["s3", "o2"],
      ]),
    );
    // a member may change their pick; the last one to agree decides
    expect(vote("s3", "right")).toEqual([{ e: "finale", step: 1 }]);
    expect(s.votes.size).toBe(0);
  });

  it("votes outside the finale, for an option of another step or from a non-member are ignored", () => {
    expect(vote("s1", "o1")).toEqual([]); // still in play
    expect(s.votes.size).toBe(0);
    toFinale();
    expect(vote("s1", "ask")).toEqual([]); // step f2's option
    expect(vote("s1", "nope")).toEqual([]);
    expect(vote("s9", "o1")).toEqual([]);
    expect(act({ t: "vote", sid: "s1", optionId: 1 as unknown as string })).toEqual([]);
    expect(s.votes.size).toBe(0);
  });

  it("unanimous wrong → finaleWrong with explain, cooldown, firstTry=false, votes cleared; votes in cooldown are ignored", () => {
    toFinale();
    vote("s1", "wrong", undefined, 10_000);
    expect(vote("s2", "wrong")).toEqual([
      { e: "finaleWrong", stepId: "f1", optionId: "o2", explain: def.finale.steps[0].options[1].explain },
    ]);
    expect(def.finale.steps[0].options[1].explain).toBe("몰래 올리면 친구의 사생활을 지킬 수 없어요.");
    expect(s.wrongAttempts).toBe(1);
    expect(s.cooldownUntil).toBe(10_000 + FINALE_COOLDOWN_MS);
    expect(s.firstTry.get("privacy")).toBe(false);
    expect(s.votes.size).toBe(0);
    expect([s.phase, s.finaleStep]).toEqual(["finale", 0]);

    // during the cooldown no vote is taken (not even stored)
    expect(vote("s1", "right", undefined, 10_000 + FINALE_COOLDOWN_MS - 1)).toEqual([]);
    expect(vote("s2", "right")).toEqual([]);
    expect(s.votes.size).toBe(0);
    expect([s.finaleStep, s.wrongAttempts]).toEqual([0, 1]);

    // a wrong option without an explanation explains with ""
    const bare: RoomDef = {
      ...def,
      finale: {
        ...def.finale,
        steps: [{ ...def.finale.steps[0], options: def.finale.steps[0].options.map((o) => ({ id: o.id, label: o.label })) }],
      },
    };
    reset(["s1"], true, bare);
    toFinale();
    expect(vote("s1", "wrong")).toEqual([{ e: "finaleWrong", stepId: "f1", optionId: "o2", explain: "" }]);
  });

  it("after the cooldown the right picks advance; the last step escapes and says escapeLines", () => {
    toFinale();
    vote("s1", "wrong", undefined, 0);
    vote("s2", "wrong");
    const until = s.cooldownUntil;
    expect(vote("s1", "right", undefined, until)).toEqual([{ e: "votes" }]); // exactly at the end: taken
    expect(vote("s2", "right")).toEqual([{ e: "finale", step: 1 }]);
    expect(s.finaleStep).toBe(1);
    expect(s.phase).toBe("finale");

    vote("s1", "right");
    expect(vote("s2", "right")).toEqual([{ e: "escaped" }, ...def.escapeLines.map((lineId) => ({ e: "say", lineId }))]);
    expect(def.escapeLines).toEqual(["bye1"]);
    expect(s.phase).toBe("escaped");
    expect(s.flags.has("escaped")).toBe(true);
    expect(s.wrongAttempts).toBe(1);
    expect(s.votes.size).toBe(0);
    // escaped: nothing more happens, membership included
    expect(act({ t: "vote", sid: "s1", optionId: "ask" })).toEqual([]);
    expect(membership(["s1"])).toEqual([]);
    expect(s.finaleStep).toBe(2);
  });

  it("a non-voter disconnecting resolves the remaining unanimous vote (Review Focus 2)", () => {
    toFinale();
    vote("s1", "right", ["s1", "s2"]); // s2 has not voted yet
    const ev = applyAction(def, s, { t: "membership" }, { ...ctx, connected: ["s1"] });
    expect(ev).toContainEqual({ e: "finale", step: 1 });
    expect(ev).toEqual([{ e: "finale", step: 1 }, { e: "members" }]);
    // the one who is left can finish alone
    expect(vote("s1", "right", ["s1"])).toEqual([{ e: "escaped" }, { e: "say", lineId: "bye1" }]);
  });

  it("firstTry keeps only the first outcome per principle", () => {
    // f1 (privacy) wrong, then right: privacy stays false; f2 has no principle and records nothing
    toFinale();
    vote("s1", "wrong");
    vote("s2", "wrong");
    ctx = { ...ctx, now: s.cooldownUntil };
    vote("s1", "right");
    vote("s2", "right");
    vote("s1", "right");
    vote("s2", "right");
    expect(s.phase).toBe("escaped");
    expect([...s.firstTry]).toEqual([["privacy", false]]);

    // both steps on one principle: right first, a later wrong does not overwrite it
    const same: RoomDef = {
      ...def,
      finale: { ...def.finale, steps: def.finale.steps.map((st) => ({ ...st, principleId: "privacy" as const })) },
    };
    reset(["s1", "s2"], true, same);
    toFinale();
    vote("s1", "right");
    vote("s2", "right");
    vote("s1", "wrong");
    vote("s2", "wrong");
    expect([s.finaleStep, s.wrongAttempts]).toEqual([1, 1]);
    expect([...s.firstTry]).toEqual([["privacy", true]]);

    // different principles are kept apart
    const two: RoomDef = {
      ...def,
      finale: { ...def.finale, steps: [def.finale.steps[0], { ...def.finale.steps[1], principleId: "no_harm" as const }] },
    };
    reset(["s1", "s2"], true, two);
    toFinale();
    vote("s1", "right");
    vote("s2", "right");
    vote("s1", "wrong");
    vote("s2", "wrong");
    ctx = { ...ctx, now: s.cooldownUntil };
    vote("s1", "right");
    vote("s2", "right");
    expect(s.phase).toBe("escaped");
    expect(Object.fromEntries(s.firstTry)).toEqual({ privacy: true, no_harm: false });
  });
});

describe("membership on every connectivity change (E13)", () => {
  /** Everything membership may touch. */
  const snapshot = () => ({
    presses: [...s.presses],
    votes: [...s.votes],
    hold: s.hold,
    phase: s.phase,
    step: s.finaleStep,
    wrong: s.wrongAttempts,
    cooldown: s.cooldownUntil,
    firstTry: [...s.firstTry],
    flags: [...s.flags],
  });

  it("is idempotent: the same members again change nothing", () => {
    expect(membership(["s1", "s2"])).toEqual([{ e: "members" }]);
    expect(membership(["s1", "s2"])).toEqual([{ e: "members" }]);

    press("s1", "sw1", 0);
    toFinale();
    vote("s1", "right");
    const before = snapshot();
    for (let i = 0; i < 3; i++) expect(membership(["s1", "s2"], 100)).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(snapshot()).toEqual(before);

    // the same for a lone holder
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    const held = snapshot();
    for (let i = 0; i < 3; i++) expect(membership(["s1"], 100 * i)).toEqual([{ e: "members" }]);
    expect(snapshot()).toEqual(held);
    expect(check(SOLO_HOLD_MS)).toEqual(DONE);
  });

  it("drops and reconnects in any order never count a vote twice; a dropped voter votes again", () => {
    reset(["s1", "s2", "s3"]);
    toFinale();
    vote("s1", "right");
    vote("s2", "right"); // s3 has not voted

    // s2 drops (reported twice): its vote is gone; s3 still has to vote
    expect(membership(["s1", "s3"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(membership(["s1", "s3"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect([...s.votes.keys()]).toEqual(["s1"]);

    // s2 reconnects with the same sessionId (listed last now): the old vote does not come back
    expect(membership(["s1", "s3", "s2"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(s.votes.has("s2")).toBe(false);
    expect(vote("s3", "right")).toEqual([{ e: "votes" }]); // s2 must vote again
    expect(s.finaleStep).toBe(0);
    expect(vote("s2", "right")).toEqual([{ e: "finale", step: 1 }]);

    // more reports of the same membership do not advance again
    expect(membership(["s1", "s3", "s2"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(membership(["s1"])).toEqual([{ e: "votes" }, { e: "members" }]); // s1 has not voted on f2
    expect([s.finaleStep, s.wrongAttempts, s.phase]).toEqual([1, 0, "finale"]);
  });

  it("a refresh under a new sessionId neither carries over nor double-counts the old vote", () => {
    toFinale();
    vote("s1", "right");
    // s1 reloads the page: the room drops the ghost s1 and admits s1b
    expect(membership(["s2", "s1b"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(s.votes.size).toBe(0);
    expect(vote("s2", "right")).toEqual([{ e: "votes" }]);
    expect(vote("s1b", "wrong")).toEqual([{ e: "votes" }]);
    expect(vote("s1b", "right")).toEqual([{ e: "finale", step: 1 }]);
    // the ghost's late vote is ignored
    expect(vote("s1", "right")).toEqual([]);
    expect(s.votes.size).toBe(0);
  });

  it("the remaining votes decide even when they are wrong; with nobody left nothing is decided", () => {
    toFinale();
    vote("s1", "wrong", undefined, 5000);
    expect(membership(["s1"], 6000)).toEqual([
      { e: "finaleWrong", stepId: "f1", optionId: "o2", explain: def.finale.steps[0].options[1].explain },
      { e: "members" },
    ]);
    expect([s.wrongAttempts, s.cooldownUntil]).toEqual([1, 6000 + FINALE_COOLDOWN_MS]);
    // reported again, and during the cooldown: no second wrong attempt
    expect(membership(["s1"], 6500)).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(membership(["s1", "s2"], 7000)).toEqual([{ e: "votes" }, { e: "members" }]);
    expect([s.wrongAttempts, s.cooldownUntil, s.finaleStep]).toEqual([1, 6000 + FINALE_COOLDOWN_MS, 0]);

    // everybody drops: the votes go with them and nothing is decided
    reset();
    toFinale();
    vote("s1", "right");
    expect(membership([])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect([s.votes.size, s.finaleStep]).toEqual([0, 0]);
    expect(membership(["s1"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(s.finaleStep).toBe(0);
    expect(vote("s1", "right")).toEqual([{ e: "finale", step: 1 }]);
  });

  it("a dropped member's press is removed and a reconnect does not revive it", () => {
    press("s1", "sw1", 0);
    expect(membership(["s2"], 100)).toEqual([{ e: "members" }]);
    expect(s.presses.size).toBe(0);
    expect(membership(["s2", "s1"], 200)).toEqual([{ e: "members" }]);
    expect(s.presses.size).toBe(0);
    expect(press("s2", "sw2", 300)).toEqual([{ e: "coop", objectId: "sw2", by: "s2" }]); // s1's press is gone
    expect(press("s1", "sw1", 400)).toEqual(DONE);

    // another member's drop leaves the remaining presses alone
    reset(["s1", "s2", "s3"]);
    press("s1", "sw1", 0);
    membership(["s1", "s2"], 100);
    expect(press("s2", "sw2", 200)).toEqual(DONE);

    // a press by someone who dropped without a membership report does not count either
    reset(["s1", "s2", "s3"]);
    press("s3", "sw1", 0);
    ctx = { ...ctx, connected: ["s1", "s2"] };
    expect(press("s2", "sw2", 100)).toEqual([{ e: "coop", objectId: "sw2", by: "s2" }]);
    expect(s.flags.has("co_done")).toBe(false);
  });

  it("a hold is cancelled once whatever the order of joins and drops, and never comes back", () => {
    const off = { e: "hold", objectId: "sw1", by: "s1", on: false };
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    expect(membership(["s1", "s2"], 300)).toEqual([off, { e: "members" }]);
    expect(membership(["s1", "s2"], 400)).toEqual([{ e: "members" }]); // no second cancel
    expect(membership(["s1"], 500)).toEqual([{ e: "members" }]); // alone again: no hold reappears
    expect(s.hold).toBeNull();
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);

    // the holder drops and someone else is the one left (drop + reconnect in one report)
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    expect(membership(["s2"], 100)).toEqual([off, { e: "members" }]);
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);

    // the holder drops, nobody is left, then reconnects: the hold stays cancelled
    reset(["s1"]);
    holdOn("s1", "sw1", 0);
    expect(membership([], 100)).toEqual([off, { e: "members" }]);
    expect(membership(["s1"], 200)).toEqual([{ e: "members" }]);
    expect(check(SOLO_HOLD_MS + 50)).toEqual([]);
    expect(s.flags.has("co_done")).toBe(false);
    // a fresh hold after the reconnect works
    expect(holdOn("s1", "sw1", 4000)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: true }]);
    expect(check(4000 + SOLO_HOLD_MS)).toEqual(DONE);
  });

  it("a sessionId listed twice counts once (still alone, one vote)", () => {
    reset(["s1", "s1"]);
    expect(press("s1", "sw1", 0)).toEqual([]); // alone: no press
    expect(holdOn("s1", "sw1", 0)).toEqual([{ e: "hold", objectId: "sw1", by: "s1", on: true }]);
    expect(membership(["s1", "s1"], 100)).toEqual([{ e: "members" }]);
    expect(check(SOLO_HOLD_MS)).toEqual(DONE);

    reset();
    toFinale();
    vote("s1", "right");
    expect(membership(["s1", "s1", "s2"])).toEqual([{ e: "votes" }, { e: "members" }]);
    expect(vote("s2", "right", ["s1", "s2", "s2"])).toEqual([{ e: "finale", step: 1 }]);
  });
});
