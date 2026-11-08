/** How a failed model download is retried (LoadBoundary.tsx, final review m2): pure, so it is unit tested. */

/** Tries after the first failure. */
export const LOAD_RETRY_LIMIT = 3;

/** The wait before retry number `tries` (0 = the first retry): 4 s, 8 s, 16 s. */
export function retryDelayMs(tries: number): number {
  return 4000 * 2 ** Math.max(0, Math.min(tries, LOAD_RETRY_LIMIT));
}
