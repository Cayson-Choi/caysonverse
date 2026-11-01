/**
 * The team's stars after a room (AI 학교 탈출, Task 7). Pure.
 *
 * Not escaped → 0. Escaped only after "다시 도전" (overtime) → 1. Otherwise 3 when at least
 * 5 minutes were left, at most 1 hint was used and at most 3 wrong attempts were made; 2 when
 * at most 3 hints were used; else 1.
 */

const THREE_STAR_MIN_REMAINING_S = 300;
const THREE_STAR_MAX_HINTS = 1;
const THREE_STAR_MAX_WRONG = 3;
const TWO_STAR_MAX_HINTS = 3;

export function computeStars(r: {
  escaped: boolean;
  overtime: boolean;
  remainingS: number;
  hintsUsed: number;
  wrongAttempts: number;
}): 0 | 1 | 2 | 3 {
  if (!r.escaped) return 0;
  if (r.overtime) return 1;
  if (
    r.remainingS >= THREE_STAR_MIN_REMAINING_S &&
    r.hintsUsed <= THREE_STAR_MAX_HINTS &&
    r.wrongAttempts <= THREE_STAR_MAX_WRONG
  )
    return 3;
  if (r.hintsUsed <= TWO_STAR_MAX_HINTS) return 2;
  return 1;
}
