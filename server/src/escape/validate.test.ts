import { describe, expect, it } from "vitest";
import { validateRoomDef } from "./validate";
import { miniRoom } from "./__fixtures__/miniRoom";
import type { LockDef, RoomDef } from "./types";

const def = miniRoom;

/** `def` with lock `id` replaced by `change(lock)`. */
function withLock(id: string, change: (l: LockDef) => LockDef): RoomDef {
  return { ...def, locks: def.locks.map((l) => (l.id === id ? change(l) : l)) };
}
const letters = (change: Partial<Extract<LockDef, { kind: "letters" }>>) =>
  withLock("lk_l", (l) => ({ ...(l as Extract<LockDef, { kind: "letters" }>), ...change }));
const digits = (change: Partial<Extract<LockDef, { kind: "digits" }>>) =>
  withLock("lk_d", (l) => ({ ...(l as Extract<LockDef, { kind: "digits" }>), ...change }));
const sort = (change: Partial<Extract<LockDef, { kind: "sort" }>>) =>
  withLock("lk_s", (l) => ({ ...(l as Extract<LockDef, { kind: "sort" }>), ...change }));

describe("validateRoomDef", () => {
  it("accepts miniRoom and hands it back", () => {
    expect(validateRoomDef(def)).toBe(def);
  });

  it("letters: at most 10 letters per wheel, one answer letter per wheel, each on its wheel", () => {
    const eleven = ["가", "나", "다", "라", "마", "바", "사", "아", "자", "차", "카"];
    expect(() => validateRoomDef(letters({ wheels: [eleven, ["다", "라"]] }))).toThrow(/lk_l.*wheel 0 has 11 letters/);
    expect(() => validateRoomDef(letters({ wheels: [eleven.slice(0, 10), ["다", "라"]] }))).not.toThrow();
    expect(() => validateRoomDef(letters({ wheels: [[], ["다", "라"]] }))).toThrow(/wheel 0 has 0 letters/);
    expect(() => validateRoomDef(letters({ answer: ["나", "마"] }))).toThrow(/lk_l.*"마" is not on wheel 1/);
    expect(() => validateRoomDef(letters({ answer: ["나"] }))).toThrow(/lk_l.*1 letters for 2 wheels/);
  });

  it("digits: the answer is exactly `length` ASCII digits", () => {
    for (const answer of ["12", "1234", "12a", "\uFF11\uFF12\uFF13", " 12"])
      expect(() => validateRoomDef(digits({ answer })), answer).toThrow(/lk_d.*3 ASCII digits/);
    expect(() => validateRoomDef(digits({ answer: "007" }))).not.toThrow();
  });

  it("sort: every card has an answer in a real bin, no answer for unknown cards, card ids unique across sort locks", () => {
    expect(() => validateRoomDef(sort({ answer: { c1: "x" } }))).toThrow(/lk_s.*card "c2" has no answer/);
    expect(() => validateRoomDef(sort({ answer: { c1: "x", c2: "z" } }))).toThrow(/lk_s.*card "c2".*unknown bin "z"/);
    expect(() => validateRoomDef(sort({ answer: { c1: "x", c2: "y", c9: "x" } }))).toThrow(/lk_s.*unknown card "c9"/);
    const twin: LockDef = { ...(def.locks[2] as Extract<LockDef, { kind: "sort" }>), id: "lk_s2", objectId: "board" };
    expect(() => validateRoomDef({ ...def, locks: [...def.locks, twin] })).toThrow(/card id "c1" is used twice/);
    const dup = sort({ cards: [{ id: "c1", label: "하나" }, { id: "c1", label: "또 하나" }, { id: "c2", label: "둘" }] });
    expect(() => validateRoomDef(dup)).toThrow(/card id "c1" is used twice/);
  });

  it("objects[].locks names existing locks; lock ids are unique", () => {
    const badRef: RoomDef = { ...def, objects: def.objects.map((o) => (o.id === "board" ? { ...o, locks: ["lk_s", "lk_x"] } : o)) };
    expect(() => validateRoomDef(badRef)).toThrow(/object "board" names unknown lock "lk_x"/);
    expect(() => validateRoomDef({ ...def, locks: [...def.locks, def.locks[0]] })).toThrow(/lock id "lk_d" is used twice/);
  });

  it("finale steps name a real correct option with unique option ids; lines exist; escape lines stay unsaid until the escape", () => {
    const step = def.finale.steps[0];
    const steps = (s0: typeof step) => ({ ...def, finale: { ...def.finale, steps: [s0, ...def.finale.steps.slice(1)] } });
    expect(() => validateRoomDef(steps({ ...step, correct: "o9" }))).toThrow(/finale step "f1".*correct option "o9"/);
    expect(() => validateRoomDef(steps({ ...step, options: [...step.options, step.options[0]] }))).toThrow(/f1.*option id "o1" is used twice/);

    expect(() => validateRoomDef({ ...def, introLines: ["nope"] })).toThrow(/unknown line "nope"/);
    expect(() => validateRoomDef({ ...def, escapeLines: ["bye2"] })).toThrow(/unknown line "bye2"/);
    const sayMissing = { ...def, combos: [{ ...def.combos[0], effects: [{ say: "gone" }] }] };
    expect(() => validateRoomDef(sayMissing)).toThrow(/unknown line "gone"/);
    // an escape line said before the escape would reach the client early (it may retell the answer)
    expect(() => validateRoomDef({ ...def, introLines: ["intro1", "bye1"] })).toThrow(/escape line "bye1"/);
    const saidEarly = withLock("lk_d", (l) => ({ ...l, onSolve: [{ say: "bye1" }] }));
    expect(() => validateRoomDef(saidEarly)).toThrow(/escape line "bye1"/);
  });
});
