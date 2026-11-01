/**
 * Checks a room's data before it is used (AI 학교 탈출, Task 7 fix round 1). A room file calls
 * `validateRoomDef` on its definition so a typo fails at server start (and in its test) instead of
 * making a puzzle unsolvable in class. Pure; throws an Error naming the room and the problem.
 *
 * Checked: lock ids unique; digits answers are `length` ASCII digits; letter wheels hold 1..10
 * letters (lock input stores one index digit per wheel) and the answer has one letter per wheel,
 * each on its wheel; sort answers cover every card with a real bin and name no unknown card, and
 * card ids are unique across the room's sort locks (the board is one map); `objects[].locks` names
 * existing locks; each finale step's `correct` is one of its options and option ids are unique;
 * every line id used (intro, escape, `say` effects) exists, and no escape line is said before the
 * escape (escape lines stay off the public content because they may retell the answer).
 */

import type { Effect, RoomDef } from "./types";

const MAX_WHEEL_LETTERS = 10;

function isAsciiDigits(s: string): boolean {
  if (s.length === 0) return false;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

/** Returns `def` unchanged when it is valid; otherwise throws. */
export function validateRoomDef<T extends RoomDef>(def: T): T {
  const fail = (msg: string): never => {
    throw new Error(`RoomDef "${def.id}": ${msg}`);
  };

  const lockIds = new Set<string>();
  const cardIds = new Set<string>();
  for (const l of def.locks) {
    if (lockIds.has(l.id)) fail(`lock id "${l.id}" is used twice`);
    lockIds.add(l.id);
    if (l.kind === "digits") {
      if (l.answer.length !== l.length || !isAsciiDigits(l.answer))
        fail(`digits lock "${l.id}": the answer must be ${l.length} ASCII digits`);
    } else if (l.kind === "letters") {
      l.wheels.forEach((w, i) => {
        if (w.length < 1 || w.length > MAX_WHEEL_LETTERS)
          fail(`letters lock "${l.id}": wheel ${i} has ${w.length} letters (1..${MAX_WHEEL_LETTERS})`);
      });
      if (l.answer.length !== l.wheels.length)
        fail(`letters lock "${l.id}": the answer has ${l.answer.length} letters for ${l.wheels.length} wheels`);
      l.answer.forEach((letter, i) => {
        if (!l.wheels[i].includes(letter)) fail(`letters lock "${l.id}": answer letter "${letter}" is not on wheel ${i}`);
      });
    } else {
      const bins = new Set(l.bins.map((b) => b.id));
      const cards = new Set<string>();
      for (const c of l.cards) {
        if (cardIds.has(c.id)) fail(`card id "${c.id}" is used twice across the sort locks`);
        cardIds.add(c.id);
        cards.add(c.id);
        const bin = Object.hasOwn(l.answer, c.id) ? l.answer[c.id] : undefined;
        if (bin === undefined) fail(`sort lock "${l.id}": card "${c.id}" has no answer`);
        else if (!bins.has(bin)) fail(`sort lock "${l.id}": card "${c.id}" goes to unknown bin "${bin}"`);
      }
      for (const k of Object.keys(l.answer)) if (!cards.has(k)) fail(`sort lock "${l.id}": the answer names unknown card "${k}"`);
    }
  }

  for (const o of def.objects)
    for (const id of o.locks ?? []) if (!lockIds.has(id)) fail(`object "${o.id}" names unknown lock "${id}"`);

  for (const step of def.finale.steps) {
    const ids = new Set<string>();
    for (const o of step.options) {
      if (ids.has(o.id)) fail(`finale step "${step.id}": option id "${o.id}" is used twice`);
      ids.add(o.id);
    }
    if (!ids.has(step.correct)) fail(`finale step "${step.id}": correct option "${step.correct}" is not one of its options`);
  }

  // Lines: every reference exists; escape lines are not said before the escape.
  const known = (id: string) => Object.hasOwn(def.lines, id);
  const said: string[] = [...def.introLines];
  const sayIds = (effects: readonly Effect[] | undefined) => {
    for (const ef of effects ?? []) if ("say" in ef) said.push(ef.say);
  };
  for (const c of def.combos) sayIds(c.effects);
  for (const l of def.locks) sayIds(l.onSolve);
  for (const c of def.coops) sayIds(c.onSolve);
  for (const id of [...said, ...def.escapeLines]) if (!known(id)) fail(`unknown line "${id}"`);
  const escape = new Set(def.escapeLines);
  for (const id of said) if (escape.has(id)) fail(`escape line "${id}" is said before the escape`);

  return def;
}
