/**
 * The classroom HUD's pure words and decisions (AI 학교 탈출, Task 17): the clock text, which cover
 * the screen wears, and the two sentences that carry a fixed Korean copy. No React, no DOM.
 */

import { ESCAPE_RETRY_EXTRA_S } from "@caysonverse/shared/escape/constants";
import type { EscapeView } from "../stores/escapeStore";

/** 900 → "15:00", 65 → "1:05"; a negative or broken number reads "0:00". */
export function formatTime(s: number): string {
  const total = Number.isFinite(s) ? Math.max(0, Math.floor(s)) : 0;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The clock turns red at this many seconds left, and under. */
export const LOW_TIME_S = 60;

export function isLowTime(timeLeftS: number): boolean {
  return timeLeftS <= LOW_TIME_S;
}

/** The cover over the classroom: the class ended, the teacher paused, the time is up, or the story intro plays. */
export type Overlay = "ended" | "paused" | "timeup" | "intro" | null;

/** Which cover the classroom wears. Priority: ended > paused > timeup > intro. */
export function escapeOverlay(v: EscapeView): Overlay {
  if (v.phase === "ended") return "ended";
  if (v.paused) return "paused";
  if (v.phase === "timeup") return "timeup";
  if (v.phase === "intro") return "intro";
  return null;
}

/** The time-up card's sentence ("다시 도전" gives ESCAPE_RETRY_EXTRA_S more, which the card names in minutes). */
export function timeupText(): string {
  const minutes = Math.round(ESCAPE_RETRY_EXTRA_S / 60);
  return `시간이 다 됐어요. 그래도 괜찮아요! ${minutes}분을 더 받아 이어서 풀어 볼까요?`;
}

/** The Hangul syllable block: its final sound decides 로 / 으로. */
const HANGUL_FIRST = 0xac00;
const HANGUL_LAST = 0xd7a3;
/** The final consonant ㄹ (index 8 of the 28 finals) takes 로, like no final at all. */
const FINAL_RIEUL = 8;

/** "상담실로 들어가는 중…" — the loading card's line (로 after a vowel or ㄹ, 으로 after another final). */
export function enteringText(roomLabel: string): string {
  const label = roomLabel.trim() === "" ? "교실" : roomLabel.trim();
  const code = label.charCodeAt(label.length - 1);
  const isHangul = code >= HANGUL_FIRST && code <= HANGUL_LAST;
  const final = isHangul ? (code - HANGUL_FIRST) % 28 : 0;
  const particle = final === 0 || final === FINAL_RIEUL ? "로" : "으로";
  return `${label}${particle} 들어가는 중…`;
}
