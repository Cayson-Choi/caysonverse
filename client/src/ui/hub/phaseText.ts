import type { ClassPhase } from "@caysonverse/shared/escape/constants";

/**
 * What the hall's banner says for the class's phase (AI 학교 탈출, Task 16). Pure; PhaseBanner.tsx
 * only draws it and keeps the 3-second "doors open" flash.
 */

/** How long "복도 문이 열렸어요!" stays after the class starts. */
export const OPENED_FLASH_MS = 3000;

const COPY = {
  lobby: "팀을 만들고 기다려 주세요. 선생님이 시작하면 복도 문이 열려요.",
  paused: "선생님이 잠시 멈췄어요",
  opened: "복도 문이 열렸어요!",
} as const;

export interface PhaseBannerInput {
  phase: ClassPhase;
  /** The class started in the last OPENED_FLASH_MS. */
  opened: boolean;
  isTeacher: boolean;
}

/**
 * The banner's line, or null. The start flash is for everyone; the waiting and paused lines speak
 * to students (the teacher caused both and has the panel).
 */
export function phaseBannerText(i: PhaseBannerInput): string | null {
  if (i.opened && i.phase === "running") return COPY.opened;
  if (i.isTeacher) return null;
  if (i.phase === "lobby") return COPY.lobby;
  if (i.phase === "paused") return COPY.paused;
  return null;
}

/**
 * The stack under the notice toast holds ONE line: the phase banner, or — when there is no banner —
 * the pad's guidance line. The pad lines for the lobby and for a paused class say what the banner
 * already says, so while the banner shows the pad line stays out (a phone has room for two lines at
 * most: the toast and this one).
 */
export function pickStackLine(banner: string | null, hint: string | null): "banner" | "hint" | null {
  if (banner !== null) return "banner";
  return hint !== null ? "hint" : null;
}

/** A start this screen saw happen: the phase went from the lobby to running (not a resume, not a late join). */
export function openedNow(prev: ClassPhase, next: ClassPhase): boolean {
  return prev === "lobby" && next === "running";
}
