/**
 * The puzzle engine (AI 학교 탈출, Task 7): one team's puzzle state and the rules that change
 * it, driven by the room data (types.ts). Server-authoritative and pure: every function takes
 * the game time in `ctx.now` (GameClock, so a pause freezes it), keeps no timers, reads no
 * clock and logs nothing (inputs and answers never reach a log).
 *
 * Task 8 adds the coop device (press / hold / membership), the persuasion vote and split clues
 * on top of `applyEffects` and `holds`.
 */

import { HINT_GAP_MS, LOCK_SUBMIT_GAP_MS, type TextLevel } from "@caysonverse/shared/escape/constants";
import type { EngineEvent, InspectViewPayload } from "@caysonverse/shared/escape/messages";
import { resolveText } from "./content";
import type { Cond, Effect, LockDef, RoomDef, StageDef } from "./types";

export type { EngineEvent, InspectViewPayload } from "@caysonverse/shared/escape/messages";

export interface EngineState {
  phase: "play" | "finale" | "escaped";
  flags: Set<string>;
  bag: string[];
  /**
   * Shared by the team. digits: the digits ("0000"); letters: one wheel index digit per wheel
   * ("0000"), so a letter wheel holds at most 10 letters.
   */
  lockInput: Map<string, string>;
  /** Sort boards: cardId → binId (one map for the room, so card ids are unique across its sort locks). */
  board: Map<string, string>;
  lastSubmitAt: Map<string, number>;
  wrongAttempts: number;
  hintsUsed: number;
  hintTier: Map<string, number>;
  lastHintAt: number;
  presses: Map<string, { sid: string; at: number }>;
  hold: { coopId: string; objectId: string; sid: string; since: number } | null;
  finaleStep: number;
  votes: Map<string, string>;
  cooldownUntil: number;
  firstTry: Map<string, boolean>;
}

export interface EngineCtx {
  /** Game time, ms. */
  now: number;
  /** Connected sessionIds, in the order they came in. */
  connected: readonly string[];
  names: ReadonlyMap<string, string>;
  maxHintTier: number;
}

export type EngineAction =
  | { t: "pickup"; sid: string; objectId: string }
  | { t: "combine"; sid: string; a: string; b: string }
  | { t: "input"; sid: string; lockId: string; value: string }
  | { t: "place"; sid: string; lockId: string; cardId: string; bin: string /* "" = take the card back */ }
  | { t: "submit"; sid: string; lockId: string }
  | { t: "hint"; sid: string }
  | { t: "press"; sid: string; objectId: string }
  | { t: "holdStart"; sid: string; objectId: string }
  | { t: "holdEnd"; sid: string; objectId: string }
  | { t: "holdCheck" }
  | { t: "vote"; sid: string; optionId: string }
  | { t: "membership" };

export function createEngineState(def: RoomDef): EngineState {
  const lockInput = new Map<string, string>();
  for (const l of def.locks) {
    if (l.kind === "digits") lockInput.set(l.id, "0".repeat(l.length));
    else if (l.kind === "letters") lockInput.set(l.id, "0".repeat(l.wheels.length));
  }
  return {
    phase: "play",
    flags: new Set(),
    bag: [],
    lockInput,
    board: new Map(),
    lastSubmitAt: new Map(),
    wrongAttempts: 0,
    hintsUsed: 0,
    hintTier: new Map(),
    lastHintAt: 0,
    presses: new Map(),
    hold: null,
    finaleStep: 0,
    votes: new Map(),
    cooldownUntil: 0,
    firstTry: new Map(),
  };
}

/** True when every `all` flag is set, no `none` flag is set and every `items` item is in the bag. No condition holds. */
export function holds(c: Cond | undefined, s: EngineState): boolean {
  if (!c) return true;
  if (c.all) for (const f of c.all) if (!s.flags.has(f)) return false;
  if (c.none) for (const f of c.none) if (s.flags.has(f)) return false;
  if (c.items) for (const i of c.items) if (!s.bag.includes(i)) return false;
  return true;
}

/** The first stage whose `doneWhen` flag is not set yet, or null when all are done. */
export function currentStage(def: RoomDef, s: EngineState): StageDef | null {
  return def.stages.find((st) => !s.flags.has(st.doneWhen)) ?? null;
}

/** Switches to the persuasion door the moment its conditions hold (once). */
function enterFinaleIfReady(def: RoomDef, s: EngineState, out: EngineEvent[]): void {
  if (s.phase === "play" && holds(def.finale.requires, s)) {
    s.phase = "finale";
    s.finaleStep = 0;
    s.votes.clear();
    out.push({ e: "finale", step: 0 });
  }
}

/** Runs effects in order; `say` becomes an event. Then the finale check (an effect can open the last door). */
export function applyEffects(def: RoomDef, s: EngineState, effects: readonly Effect[]): EngineEvent[] {
  const out: EngineEvent[] = [];
  for (const ef of effects) {
    if ("set" in ef) s.flags.add(ef.set);
    else if ("give" in ef) {
      if (!s.bag.includes(ef.give)) s.bag.push(ef.give);
    } else if ("take" in ef) s.bag = s.bag.filter((i) => i !== ef.take);
    else out.push({ e: "say", lineId: ef.say });
  }
  enterFinaleIfReady(def, s, out);
  return out;
}

const solvedFlag = (lockId: string) => `solved:${lockId}`;

/** The lock with this id if the team can use it now: it exists, its `requires` hold and it is not solved. */
function openLock(def: RoomDef, s: EngineState, lockId: string): LockDef | null {
  const lock = def.locks.find((l) => l.id === lockId);
  if (!lock || s.flags.has(solvedFlag(lockId)) || !holds(lock.requires, s)) return null;
  return lock;
}

function isDigit(code: number): boolean {
  return code >= 48 && code <= 57; // "0".."9" (ASCII only)
}

/** digits: exactly `length` ASCII digits. letters: one digit per wheel, each below that wheel's length. */
function validInput(lock: LockDef, value: string): boolean {
  if (lock.kind === "digits") {
    if (value.length !== lock.length) return false;
    for (let i = 0; i < value.length; i++) if (!isDigit(value.charCodeAt(i))) return false;
    return true;
  }
  if (lock.kind === "letters") {
    if (value.length !== lock.wheels.length) return false;
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (!isDigit(code) || code - 48 >= lock.wheels[i].length) return false;
    }
    return true;
  }
  return false;
}

function lockMatches(lock: LockDef, input: string): boolean {
  if (lock.kind === "digits") return input === lock.answer;
  if (lock.kind === "letters")
    return input.length === lock.wheels.length && [...input].every((d, i) => lock.wheels[i][+d] === lock.answer[i]);
  return false;
}

function pickup(def: RoomDef, s: EngineState, sid: string, objectId: string): EngineEvent[] {
  const p = def.objects.find((o) => o.id === objectId)?.pickup;
  if (!p || !holds(p.when, s) || s.flags.has(`picked:${p.item}`)) return [];
  if (!s.bag.includes(p.item)) s.bag.push(p.item);
  s.flags.add(`picked:${p.item}`);
  const out: EngineEvent[] = [{ e: "picked", item: p.item, by: sid }];
  enterFinaleIfReady(def, s, out);
  return out;
}

function combine(def: RoomDef, s: EngineState, sid: string, a: string, b: string): EngineEvent[] {
  if (a === b || !s.bag.includes(a) || !s.bag.includes(b)) return [];
  const combo = def.combos.find((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
  if (!combo) return [];
  s.bag = s.bag.filter((i) => i !== a && i !== b);
  if (!s.bag.includes(combo.out)) s.bag.push(combo.out);
  s.flags.add(`made:${combo.out}`);
  return [{ e: "combined", out: combo.out, by: sid }, ...applyEffects(def, s, combo.effects ?? [])];
}

function input(def: RoomDef, s: EngineState, lockId: string, value: unknown): EngineEvent[] {
  const lock = openLock(def, s, lockId);
  if (lock && typeof value === "string" && validInput(lock, value)) s.lockInput.set(lockId, value);
  return [];
}

function place(def: RoomDef, s: EngineState, lockId: string, cardId: string, bin: string): EngineEvent[] {
  const lock = openLock(def, s, lockId);
  if (!lock || lock.kind !== "sort") return [];
  if (lock.needsItem && !s.bag.includes(lock.needsItem)) return [];
  if (!lock.cards.some((c) => c.id === cardId)) return [];
  if (bin === "") s.board.delete(cardId);
  else if (lock.bins.some((b) => b.id === bin)) s.board.set(cardId, bin);
  return [];
}

function submit(def: RoomDef, s: EngineState, sid: string, lockId: string, now: number): EngineEvent[] {
  const lock = openLock(def, s, lockId);
  if (!lock) return [];
  if (lock.kind === "sort" && lock.needsItem && !s.bag.includes(lock.needsItem)) return [];
  // Two players pressing "열기" at the same moment count once (Review Focus 3).
  if (now - (s.lastSubmitAt.get(lockId) ?? -Infinity) < LOCK_SUBMIT_GAP_MS) return [];
  s.lastSubmitAt.set(lockId, now);
  if (lock.kind === "sort") {
    const unplaced = lock.cards.filter((c) => !s.board.get(c.id)).length;
    if (unplaced > 0) return [{ e: "wrong", lockId, unplaced }]; // not a wrong attempt
    const wrong = lock.cards.filter((c) => s.board.get(c.id) !== lock.answer[c.id]).length;
    if (wrong > 0) {
      s.wrongAttempts++;
      return [{ e: "wrong", lockId, wrongCount: wrong }];
    }
  } else if (!lockMatches(lock, s.lockInput.get(lockId) ?? "")) {
    s.wrongAttempts++;
    return [{ e: "wrong", lockId }];
  }
  s.flags.add(solvedFlag(lockId));
  return [{ e: "solved", lockId, by: sid }, ...applyEffects(def, s, lock.onSolve)];
}

function requestHint(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[] {
  const st = currentStage(def, s);
  if (!st) return [];
  const tier = s.hintTier.get(st.id) ?? 0;
  if (tier >= Math.min(3, ctx.maxHintTier)) return [{ e: "hintMax" }];
  const wait = tier > 0 ? s.lastHintAt + HINT_GAP_MS - ctx.now : 0;
  if (wait > 0) return [{ e: "hintWait", waitS: Math.ceil(wait / 1000) }];
  s.hintTier.set(st.id, tier + 1);
  s.hintsUsed++;
  s.lastHintAt = ctx.now;
  return [{ e: "hint", stageId: st.id, tier: tier + 1, text: st.hints[tier] }];
}

/** Applies one player action to the team state and returns what happened. Escaped → nothing happens. */
export function applyAction(def: RoomDef, s: EngineState, a: EngineAction, ctx: EngineCtx): EngineEvent[] {
  if (s.phase === "escaped") return [];
  switch (a.t) {
    case "pickup":
      return pickup(def, s, a.sid, a.objectId);
    case "combine":
      return combine(def, s, a.sid, a.a, a.b);
    case "input":
      return input(def, s, a.lockId, a.value);
    case "place":
      return place(def, s, a.lockId, a.cardId, a.bin);
    case "submit":
      return submit(def, s, a.sid, a.lockId, ctx.now);
    case "hint":
      return requestHint(def, s, ctx);
    // The coop device and the persuasion vote arrive with Task 8.
    case "press":
    case "holdStart":
    case "holdEnd":
    case "holdCheck":
    case "vote":
    case "membership":
      return [];
  }
}

/**
 * One object's close-up for one viewer, or null for an unknown object. Does not change state.
 * body = the first state whose `when` holds (else the base body); `reveal` only while the bag
 * holds the reveal item; `canPickup` only while a pickup would work; `lockId` = the object's first
 * lock that is visible (`requires`) and not solved. (`viewer` and `ctx` serve the split clues, Task 8.)
 */
export function inspectView(
  def: RoomDef,
  s: EngineState,
  objectId: string,
  viewer: string,
  ctx: EngineCtx,
  level: TextLevel,
): InspectViewPayload | null {
  const obj = def.objects.find((o) => o.id === objectId);
  if (!obj) return null;
  const ins = obj.inspect;
  const state = ins.states?.find((st) => holds(st.when, s));
  const view: InspectViewPayload = {
    objectId: obj.id,
    title: resolveText(ins.title, level),
    body: resolveText(state ? state.body : ins.body, level),
  };
  if (ins.back !== undefined) view.back = resolveText(ins.back, level);
  if (ins.image !== undefined) view.image = ins.image;
  if (ins.reveal && s.bag.includes(ins.reveal.item)) view.reveal = ins.reveal.text;
  const p = obj.pickup;
  if (p && holds(p.when, s) && !s.flags.has(`picked:${p.item}`)) view.canPickup = p.item;
  const lockId = obj.locks?.find((id) => openLock(def, s, id) !== null);
  if (lockId !== undefined) view.lockId = lockId;
  return view;
}
