/**
 * Puzzle engine part 2 (AI 학교 탈출, Task 8): split clues (나눠 보기), the two-player switch
 * (동시 누르기), the lone player's long press (혼자 길게 누르기) and the unanimous vote at the
 * last door (설득 투표). engine.ts's `applyAction` and `inspectView` delegate here.
 *
 * Pure like engine.ts: game time comes in `ctx.now`, there are no timers (the room schedules
 * `holdCheck` SOLO_HOLD_MS after a `holdStart`), no clock and no logging.
 *
 * Membership (ruling E13): `ctx.connected` is the only record of who is in the room, and every
 * function here reads it fresh. `onMembership` re-derives everything that depends on it — the
 * hold, the presses, the votes — from the current list alone, so the room may call it on every
 * join, drop, reconnect and leave, in any order and any number of times: the same list twice
 * changes nothing, a dropped member's press and vote are gone for good (a reconnect votes again),
 * and a sessionId listed twice still counts once.
 */

import { COOP_WINDOW_MS, FINALE_COOLDOWN_MS, SOLO_HOLD_MS } from "@caysonverse/shared/escape/constants";
import type { EngineEvent, InspectViewPayload } from "@caysonverse/shared/escape/messages";
import { applyEffects, holds, type EngineCtx, type EngineState } from "./engine";
import type { CoopDef, ObjectDef, RoomDef } from "./types";

export type SplitGroup = "A" | "B";

/** Joins the owners' nicknames in a locked split half ("가람、다온님만 …"). */
const OWNER_SEPARATOR = "、";

/** The connected members in join order, each once. */
function membersOf(connected: readonly string[]): string[] {
  return [...new Set(connected)];
}

/**
 * Exactly one member is connected: the switch becomes a long press and the one member reads
 * both split halves. (The room's `solo` flag uses this too, so both always agree.)
 */
export function isSolo(connected: readonly string[]): boolean {
  return membersOf(connected).length === 1;
}

/** `sid` is the only connected member. */
function aloneWith(connected: readonly string[], sid: string): boolean {
  const members = membersOf(connected);
  return members.length === 1 && members[0] === sid;
}

/** Which split halves each member reads: alone → both; otherwise A, B, A, … in join order. */
export function splitGroups(connected: readonly string[]): Map<string, ReadonlyArray<SplitGroup>> {
  const members = membersOf(connected);
  const g = new Map<string, ReadonlyArray<SplitGroup>>();
  if (members.length === 1) g.set(members[0], ["A", "B"]);
  else members.forEach((sid, i) => g.set(sid, [i % 2 === 0 ? "A" : "B"]));
  return g;
}

/**
 * One split half for one viewer: its text if the viewer's share holds that half, otherwise the
 * locked sentence with `{owner}` filled in with the nicknames of the members who hold it. The
 * caller (inspectView) checks `split.when` first.
 */
export function splitView(
  split: NonNullable<ObjectDef["split"]>,
  viewer: string,
  ctx: EngineCtx,
): NonNullable<InspectViewPayload["split"]> {
  const groups = splitGroups(ctx.connected);
  if (groups.get(viewer)?.includes(split.group)) return { text: split.text };
  const owners: string[] = [];
  for (const [sid, share] of groups) {
    const name = ctx.names.get(sid);
    if (share.includes(split.group) && name !== undefined) owners.push(name);
  }
  // split/join rather than replace(): a nickname such as "$&" must stay exactly as typed.
  return { lockedText: split.lockedText.split("{owner}").join(owners.join(OWNER_SEPARATOR)) };
}

/** The coop is usable now: not done yet and its `requires` hold. */
function isOpen(coop: CoopDef, s: EngineState): boolean {
  return !s.flags.has(coop.doneFlag) && holds(coop.requires, s);
}

/** The usable coop this switch belongs to, or null. */
function openCoop(def: RoomDef, s: EngineState, objectId: string): CoopDef | null {
  const coop = def.coops.find((c) => c.switches.includes(objectId));
  return coop && isOpen(coop, s) ? coop : null;
}

/** Sets the done flag and runs onSolve (through applyEffects, so it can open the last door). */
function finishCoop(def: RoomDef, s: EngineState, coop: CoopDef): EngineEvent[] {
  for (const sw of coop.switches) s.presses.delete(sw);
  if (s.hold?.coopId === coop.id) s.hold = null;
  s.flags.add(coop.doneFlag);
  return [{ e: "coopDone", coopId: coop.id }, ...applyEffects(def, s, coop.onSolve)];
}

/**
 * "둘 이상이 2초 안에": completes once every switch of the coop holds a press from a different
 * connected member, the oldest at most COOP_WINDOW_MS old (2000 ms apart completes, 2001 does
 * not). One member counts on one switch only. Alone → ignored (long press instead).
 */
export function pressSwitch(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[] {
  const coop = openCoop(def, s, objectId);
  if (!coop) return [];
  const members = membersOf(ctx.connected);
  if (members.length <= 1 || !members.includes(sid)) return [];
  for (const sw of coop.switches) {
    const p = s.presses.get(sw);
    // stale, this member's press on another switch, or a member who has left
    if (p && (ctx.now - p.at > COOP_WINDOW_MS || (sw !== objectId && p.sid === sid) || !members.includes(p.sid)))
      s.presses.delete(sw);
  }
  s.presses.set(objectId, { sid, at: ctx.now });
  if (!coop.switches.every((sw) => s.presses.has(sw))) return [{ e: "coop", objectId, by: sid }];
  return finishCoop(def, s, coop);
}

/**
 * Ends the active hold without finishing it (nothing to do → []). Also for the room: a pause or
 * the time running out cancels a hold (Task 10), and this gives the clients the `on: false` event.
 */
export function cancelHold(s: EngineState): EngineEvent[] {
  const h = s.hold;
  if (!h) return [];
  s.hold = null;
  return [{ e: "hold", objectId: h.objectId, by: h.sid, on: false }];
}

/**
 * The lone member starts holding a switch of an open coop. A second start while a hold is
 * active (key repeat, the other switch) is ignored, so the timer never restarts.
 */
export function holdStart(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[] {
  const coop = openCoop(def, s, objectId);
  if (!coop || s.hold || !aloneWith(ctx.connected, sid)) return [];
  s.hold = { coopId: coop.id, objectId, sid, since: ctx.now };
  return [{ e: "hold", objectId, by: sid, on: true }];
}

/**
 * The active hold after SOLO_HOLD_MS → done. It is cancelled instead if its holder is no
 * longer the only member or its coop closed; a release (`released`) before the time cancels it.
 */
function settleHold(def: RoomDef, s: EngineState, ctx: EngineCtx, released: boolean): EngineEvent[] {
  const h = s.hold;
  if (!h) return [];
  const coop = def.coops.find((c) => c.id === h.coopId);
  if (!coop || !isOpen(coop, s) || !aloneWith(ctx.connected, h.sid)) return cancelHold(s);
  if (ctx.now - h.since >= SOLO_HOLD_MS) return finishCoop(def, s, coop);
  return released ? cancelHold(s) : [];
}

/** The holder lets go of the switch they hold: done at SOLO_HOLD_MS or later, otherwise cancelled. */
export function holdEnd(def: RoomDef, s: EngineState, sid: string, objectId: string, ctx: EngineCtx): EngineEvent[] {
  if (!s.hold || s.hold.sid !== sid || s.hold.objectId !== objectId) return [];
  return settleHold(def, s, ctx, true);
}

/** The room's timer: finishes a hold that is still active and has lasted SOLO_HOLD_MS. */
export function holdCheck(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[] {
  return settleHold(def, s, ctx, false);
}

/** Every connected member must pick the same option of the current step; then it is judged. */
export function castVote(def: RoomDef, s: EngineState, sid: string, optionId: string, ctx: EngineCtx): EngineEvent[] {
  if (s.phase !== "finale" || ctx.now < s.cooldownUntil) return [];
  const step = def.finale.steps[s.finaleStep];
  if (!step || !step.options.some((o) => o.id === optionId) || !membersOf(ctx.connected).includes(sid)) return [];
  s.votes.set(sid, optionId);
  return resolveVotes(def, s, ctx);
}

/**
 * Drops the votes of members who are not connected, then judges the step if every connected
 * member picked the same option: wrong → explanation + cooldown; right → next step or escaped.
 * The first outcome per principle is kept in `firstTry`.
 */
function resolveVotes(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[] {
  const members = membersOf(ctx.connected);
  for (const v of [...s.votes.keys()]) if (!members.includes(v)) s.votes.delete(v);
  const step = def.finale.steps[s.finaleStep];
  const picks = members.map((m) => s.votes.get(m));
  if (!step || picks.length === 0 || picks.some((p) => p === undefined) || new Set(picks).size !== 1) return [{ e: "votes" }];
  const chosen = picks[0]!;
  const right = chosen === step.correct;
  s.votes.clear();
  if (step.principleId && !s.firstTry.has(step.principleId)) s.firstTry.set(step.principleId, right);
  if (!right) {
    s.wrongAttempts++;
    s.cooldownUntil = ctx.now + FINALE_COOLDOWN_MS;
    return [{ e: "finaleWrong", stepId: step.id, optionId: chosen, explain: step.options.find((o) => o.id === chosen)?.explain ?? "" }];
  }
  s.finaleStep++;
  if (s.finaleStep < def.finale.steps.length) return [{ e: "finale", step: s.finaleStep }];
  s.phase = "escaped";
  s.flags.add("escaped");
  return [{ e: "escaped" }, ...def.escapeLines.map((lineId) => ({ e: "say" as const, lineId }))];
}

/**
 * Who is connected changed (or may have): cancel a hold unless its holder is the only member,
 * forget the presses of members who are gone, and in the finale judge again (without a dropped
 * member's vote the remaining votes may now agree). Safe to repeat (E13).
 */
export function onMembership(def: RoomDef, s: EngineState, ctx: EngineCtx): EngineEvent[] {
  const out: EngineEvent[] = [];
  if (s.hold && !aloneWith(ctx.connected, s.hold.sid)) out.push(...cancelHold(s));
  const members = membersOf(ctx.connected);
  for (const [sw, p] of s.presses) if (!members.includes(p.sid)) s.presses.delete(sw);
  if (s.phase === "finale") out.push(...resolveVotes(def, s, ctx));
  out.push({ e: "members" });
  return out;
}
