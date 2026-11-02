/**
 * The words and decisions of Bandit's hints, the last door and the summary card (AI 학교 탈출, Task 20):
 * who chose which card, what the hint button says, and the little Korean sentences the brief fixes.
 * Pure — no React, no DOM, no clock of its own (the caller passes `nowMs`).
 */

import { HINT_GAP_MS } from "@caysonverse/shared/escape/constants";
import type { EscapeEventPayload } from "@caysonverse/shared/escape/messages";

/** The line under the last door's cards. */
export const FINALE_GUIDE = "모두 같은 카드를 고르면 아리에게 말해요";
/** Asked before a hint is requested: a hint can lower the stars. */
export const HINT_CONFIRM_TEXT = "힌트를 쓰면 별이 줄 수 있어요. 받을까요?";

// ───────────────────────────────────────── the last door ─────────────────────────────────────────

/**
 * Which nicknames chose which option. Walks the members (so the names come in the order the members came in,
 * and a voter who has left counts for nothing); an option nobody chose has no key. The result has no
 * prototype: an option called "constructor" is an option, not a method.
 */
export function voteChips(
  votes: Readonly<Record<string, string>>,
  members: readonly { sid: string; nickname: string }[],
): Record<string, string[]> {
  const out: Record<string, string[]> = Object.create(null) as Record<string, string[]>;
  for (const m of members) {
    if (!Object.prototype.hasOwnProperty.call(votes, m.sid)) continue;
    const option = votes[m.sid];
    (out[option] ??= []).push(m.nickname);
  }
  return out;
}

/** How many of the members present have chosen a card. */
export function voteProgress(
  votes: Readonly<Record<string, string>>,
  members: readonly { sid: string; nickname: string }[],
): { chosen: number; total: number } {
  let chosen = 0;
  for (const m of members) if (Object.prototype.hasOwnProperty.call(votes, m.sid)) chosen++;
  return { chosen, total: members.length };
}

/** "30초 뒤에 다시 고를 수 있어요" — shown after a wrong card until the cooldown is over. */
export function cooldownText(seconds: number): string {
  return `${seconds}초 뒤에 다시 고를 수 있어요`;
}

/** What the team did on its first try at the principle, as far as THIS player watched the last door. */
export interface FirstTry {
  /** This player saw the last door start (the `finale` event of its first step). */
  seen: boolean;
  /** Wrong cards on the first step (the principle). */
  wrongOnFirstStep: number;
}

export const FIRST_TRY_START: FirstTry = Object.freeze({ seen: false, wrongOnFirstStep: 0 });

export function firstTryReduce(ft: FirstTry, ev: EscapeEventPayload, firstStepId: string): FirstTry {
  if (ev.e === "finale" && ev.step === 0 && !ft.seen) return { seen: true, wrongOnFirstStep: ft.wrongOnFirstStep };
  if (ev.e === "finaleWrong" && ev.stepId === firstStepId) {
    return { seen: ft.seen, wrongOnFirstStep: ft.wrongOnFirstStep + 1 };
  }
  return ft;
}

/** The card's line about the first try; null when this player did not watch the whole last door (a refresh, a late join). */
export function firstTryText(ft: FirstTry): string | null {
  if (!ft.seen) return null;
  return ft.wrongOnFirstStep === 0 ? "원칙을 한 번에 맞혔어요!" : "다시 생각해서 원칙을 맞혔어요!";
}

// ─────────────────────────────────────────── Bandit's hints ───────────────────────────────────────────

/** A stage has this many hints: direction, a concrete clue, almost the answer. */
export const HINT_TIERS = 3;

export interface HintState {
  /** The stage of the latest hint this client saw. */
  stageId: string | null;
  /** How many hints that stage has given. */
  tier: number;
  /** When (client clock, ms) the next hint of the stage may be asked for. */
  waitUntil: number;
  /** The stage has given all its hints. */
  maxed: boolean;
}

export const HINT_START: HintState = Object.freeze({ stageId: null, tier: 0, waitUntil: 0, maxed: false });

/**
 * The hint button's memory, kept from the room's events. The client does not know which stage the team is in
 * (the stage list names no conditions), so a solved lock or a finished coop switch — the ends of a stage —
 * opens the button again; the server's own answer (`hintWait`, `hintMax`) corrects anything this guesses wrong.
 */
export function hintReducer(s: HintState, ev: EscapeEventPayload, nowMs: number): HintState {
  switch (ev.e) {
    case "hint":
      return {
        stageId: typeof ev.stageId === "string" ? ev.stageId : null,
        tier: typeof ev.tier === "number" ? ev.tier : 1,
        waitUntil: nowMs + HINT_GAP_MS,
        maxed: typeof ev.tier === "number" && ev.tier >= HINT_TIERS,
      };
    case "hintWait": {
      const wait = Number.isFinite(ev.waitS) ? Math.max(0, ev.waitS) : 0;
      return { stageId: s.stageId, tier: Math.max(s.tier, 1), waitUntil: nowMs + wait * 1000, maxed: s.maxed };
    }
    case "hintMax":
      return s.maxed ? s : { ...s, maxed: true };
    case "solved":
    case "coopDone":
      return HINT_START;
    default:
      return s;
  }
}

/** Whole seconds until the next hint of the stage (rounded up), 0 when none was given or the wait is over. */
export function hintWaitS(s: HintState, nowMs: number): number {
  if (s.tier <= 0) return 0;
  return Math.max(0, Math.ceil((s.waitUntil - nowMs) / 1000));
}

/** "힌트 받기" | "다음 힌트까지 n초" | "힌트를 모두 받았어요". */
export function hintButtonState(v: { tierInStage: number; waitS: number; maxed: boolean }): { enabled: boolean; label: string } {
  if (v.maxed) return { enabled: false, label: "힌트를 모두 받았어요" };
  if (v.tierInStage > 0 && v.waitS > 0) return { enabled: false, label: `다음 힌트까지 ${v.waitS}초` };
  return { enabled: true, label: "힌트 받기" };
}

// ───────────────────────────────────────── numbers and time ─────────────────────────────────────────

const CIRCLED_ONE = 0x2460;
const CIRCLED_LAST = 20;

/** ① ② ③ … ⑳ for the hint list and the summary lines; a plain "21." beyond that. */
export function circled(n: number): string {
  if (Number.isInteger(n) && n >= 1 && n <= CIRCLED_LAST) return String.fromCodePoint(CIRCLED_ONE + n - 1);
  return `${n}.`;
}

/** "6분 12초", "1분", "45초" — how long the team took. */
export function elapsedText(seconds: number): string {
  const total = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m === 0) return `${s}초`;
  return s === 0 ? `${m}분` : `${m}분 ${s}초`;
}
